import { asAsync, Input } from "./async";
import { deferred } from "./deferred";
import { defaultQueueMicrotask, QueueMicrotask } from "./microtask";
import { aggregateError } from "./aggregate-error";

export interface MergeOptions {
  queueMicrotask?: QueueMicrotask;
}

export interface AsyncIteratorSetResult<T> {
  done: boolean;
  value?: T;
  initialIteration: symbol;
  resolvedIteration?: symbol;
  iterator: AsyncIterator<T>;
}

export type LaneInput<T> = Input<Input<T>>;

type IterationFlag = symbol;

export async function *merge<T>(source: LaneInput<T>, options: MergeOptions = {}): AsyncIterable<(T | undefined)[]> {
  const microtask = options.queueMicrotask || defaultQueueMicrotask;
  const states = new Map<AsyncIterator<T>, AsyncIteratorSetResult<T>>();
  const inFlight = new Map<AsyncIterator<T>, Promise<AsyncIteratorSetResult<T> | undefined>>();
  const lanes: AsyncIterator<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const sourceIterator = asAsync(source)[Symbol.asyncIterator]();
  let active: IterationFlag | undefined = undefined;
  let lanesPromise: Promise<void> = Promise.resolve();
  let laneAvailable = deferred<AsyncIterator<T> | undefined>();
  const lanesComplete = deferred();
  const errors: unknown[] = [];

  try {
    do {
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
        const { iterator } = result;
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
    errors.push(error);
  } finally {
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
      const nextLane = await sourceIterator.next();
      if (nextLane.done) {
        lanesDone = true;
        if (!lanes.length) {
          valuesDone = true;
        }
        lanesComplete.resolve();
        await sourceIterator.return?.();
      } else if (nextLane.value) {
        const lane = asAsync<T>(nextLane.value)[Symbol.asyncIterator]();
        lanes.push(lane);
        laneAvailable.resolve(lane);
        laneAvailable = deferred();
      }
    }
  }

  async function waitForResult(iteration: IterationFlag): Promise<AsyncIteratorSetResult<T>[]> {

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

    const results = await Promise.any<AsyncIteratorSetResult<T>[]>([
      wait(),
      nextLane.then(() => [])
    ]);

    if (!results.length) {
      // We have a new lane available, lets loop around and initialise its promise
      return waitForResult(iteration);
    }

    return results;

    async function wait(): Promise<AsyncIteratorSetResult<T>[]> {
      let active = true;
      const results: AsyncIteratorSetResult<T>[] = [];
      const promises = pendingLanes
        .map(iterator => next(iterator).then(result => {
          // What happens if we dont check this? Does this array keep adding if we have a lot of iterators?
          if (active) {
            results.push(result);
          }
        }));
      await Promise.any<unknown>([
        new Promise<void>(microtask),
        Promise.all(promises)
      ]);
      if (!results.length) {
        await Promise.any(promises);
      }
      active = false;
      // Clone so that it only uses the values we have now
      return [...results];
    }

    async function next(iterator: AsyncIterator<T>) {
      const current = inFlight.get(iterator);
      if (current) return current;
      const next = iterator.next()
        .then((result): AsyncIteratorSetResult<T> => ({
          value: result.value,
          done: !!result.done,
          initialIteration: iteration,
          iterator
        }))
        .catch(localError => {
          errors.push(localError);
          return undefined;
        });
      inFlight.set(iterator, next);
      return next;
    }
  }
}
