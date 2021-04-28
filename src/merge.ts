import { asAsync, Input } from "./async";
import { deferred } from "./deferred";
import { defaultQueueMicrotask, QueueMicrotask } from "./microtask";
import { aggregateError } from "./aggregate-error";
import { isReuse } from "./reuse";

export interface MergeOptions {
  queueMicrotask?: QueueMicrotask;
  reuseInFlight?: boolean;
}

export interface AsyncIteratorSetResult<T> {
  done: boolean;
  value?: T;
  initialIteration: symbol;
  resolvedIteration?: symbol;
  iterator: AsyncIterator<T>;
  promise?: unknown;
}

export type LaneInput<T> = Input<Input<T>>;

type IterationFlag = symbol;

const NextMicrotask = Symbol();

export async function *merge<T>(source: LaneInput<T>, options: MergeOptions = {}): AsyncIterable<(T | undefined)[]> {
  const microtask = options.queueMicrotask || defaultQueueMicrotask;
  const states = new Map<AsyncIterator<T>, AsyncIteratorSetResult<T>>();
  const inFlight = new Map<AsyncIterator<T>, Promise<AsyncIteratorSetResult<T> | undefined>>();
  const iterators = new WeakMap<Input<T>, AsyncIterator<T>>();
  const lanes: AsyncIterator<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const sourceIterator: AsyncIterator<Input<T>> = asAsync(source)[Symbol.asyncIterator]();
  let active: IterationFlag | undefined = undefined;
  let lanesPromise: Promise<void> = Promise.resolve();
  let laneAvailable = deferred<AsyncIterator<T> | undefined>();
  const lanesComplete = deferred();
  const errorOccurred = deferred();
  const errors: unknown[] = [];
  let results: AsyncIteratorSetResult<T>[] = [];
  let currentMicrotaskPromise: Promise<unknown> | undefined;

  try {
    cycle: do {
      const iteration: IterationFlag = active = Symbol();

      lanesPromise = lanesPromise.then(() => nextLanes(iteration));

      if (!lanes.length) {
        await Promise.any<unknown>([
          laneAvailable.promise,
          lanesComplete.promise
        ]);
        if (valuesDone) {
          // Had no lanes
          break;
        }
      }

      const updated = await waitForResult(iteration);

      if (errors.length) {
        break;
      }

      for (const result of updated) {
        const { iterator, promise } = result;
        const currentPromise: unknown = inFlight.get(iterator);
        if (promise !== currentPromise) {
          onError(new Error("Unexpected promise state"));
          break cycle;
        }
        inFlight.set(iterator, undefined);
        states.set(iterator, {
          ...result,
          value: result.done ? states.get(iterator)?.value : result.value,
          resolvedIteration: iteration
        });
      }

      const finalResults = lanes.map(read);

      valuesDone = lanesDone && finalResults.every(result => result?.done);

      const onlyDone = !!updated.every(result => result.done);

      // Don't yield only done because the consumer already has received all these values
      if (onlyDone) {
        continue;
      }

      if (!valuesDone) {
        yield finalResults.map(result => result?.value);
      }

    } while (!valuesDone);
  } catch (error) {
    onError(error);
  } finally {
    active = undefined;
    await sourceIterator.return?.();
  }

  if (errors.length) {
    throw aggregateError(errors);
  }

  function read(iterator: AsyncIterator<T>): AsyncIteratorSetResult<T> | undefined {
    return states.get(iterator);
  }

  async function nextLanes(iteration: IterationFlag) {
    while (active === iteration && !lanesDone) {
      const result: IteratorResult<Input<T>> = await sourceIterator.next();
      if (!isIteratorYieldResult(result)) {
        lanesDone = true;
        if (!lanes.length) {
          valuesDone = true;
        }
        lanesComplete.resolve();
        await sourceIterator.return?.();
      } else if (result.value) {
        const sourceLane = result.value;
        const lane = getIterator(sourceLane);
        if (options.reuseInFlight || isReuse(sourceLane)) {
          iterators.set(sourceLane, lane);
        }
        lanes.push(lane);
        laneAvailable.resolve(lane);
        laneAvailable = deferred();
      }
    }

    function getIterator(sourceLane: Input<T>) {
      if (options.reuseInFlight || isReuse(sourceLane)) {
        const currentIterator = iterators.get(sourceLane);
        if (currentIterator) {
          const state = read(currentIterator);
          if (state?.done !== true) {
            // reuse
            return currentIterator;
          }
        }
      }
      return asAsync<T>(sourceLane)[Symbol.asyncIterator]();
    }

    function isIteratorYieldResult<T>(result: IteratorResult<T>): result is IteratorYieldResult<T> {
      return !result.done;
    }
  }

  async function waitForResult(iteration: IterationFlag, emptyDepth: number = 0): Promise<AsyncIteratorSetResult<T>[]> {
    if (iteration !== active) {
      // Early exit if we actually aren't iterating this any more
      // I don't think this can actually trigger, but lets keep it around
      return [];
    }

    if (lanesDone && !lanes.length) {
      // No lanes to do anything, exit
      return [];
    }

    if (errors.length) {
      // We have a problem, exit
      return [];
    }

    const pendingLanes = lanes
      .filter(iterator => !read(iterator)?.done);

    // Grab onto this promise early so we don't miss one
    const nextLane = laneAvailable.promise;

    if (!pendingLanes.length) {
      await nextLane;
      return waitForResult(iteration);
    }

    const currentResults = await wait();

    if (!currentResults.length) {
      if (emptyDepth > 10000) {
        throw new Error("Empty depth over 10000");
      }
      // We have a new lane available, lets loop around and initialise its promise
      return waitForResult(iteration, emptyDepth + 1);
    }

    return currentResults;

    async function wait(): Promise<AsyncIteratorSetResult<T>[]> {
      const promises = pendingLanes.map(next);
      const nextLane = laneAvailable.promise;

      currentMicrotaskPromise = currentMicrotaskPromise || new Promise<void>(microtask).then(() => NextMicrotask);

      const reason = await Promise.any<unknown>([
        currentMicrotaskPromise,
        Promise.all(promises),
        errorOccurred.promise,
        // We will be able to set up again next loop
        nextLane
      ]);

      if (reason === NextMicrotask) {
        currentMicrotaskPromise = undefined;
      }

      if (!results.length) {
        await Promise.any<unknown>([
          Promise.any(promises),
          nextLane,
          errorOccurred.promise
        ]);
      }

      if (errors.length) {
        return [];
      }
      if (!results.length) {
        return [];
      }
      // Clone so that it only uses the values we have now
      const cloned = [...results];
      // Clear to start again
      results = [];
      return cloned;
    }

    async function next(iterator: AsyncIterator<T>) {
      const current = inFlight.get(iterator);
      if (current) return current;
      const next = iterator.next()
        .then((result): AsyncIteratorSetResult<T> => ({
            value: result.value,
            done: !!result.done,
            initialIteration: iteration,
            iterator,
            promise: next
        }))
        .catch((localError): AsyncIteratorSetResult<T> => {
          onError(localError);
          return {
            value: undefined,
            done: true,
            initialIteration: iteration,
            iterator,
            promise: next
          };
        })
        .then((result) => {
          results.push(result);
          return result;
        });
      inFlight.set(iterator, next);
      return next;
    }
  }

  function onError(error: unknown) {
    errors.push(error);
    errorOccurred.resolve();
  }
}
