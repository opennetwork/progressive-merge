import { asAsync, Input } from "./async";
import { deferred } from "./deferred";
import { defaultQueueMicrotask, QueueMicrotask } from "./microtask";

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

export async function *merge<T>(source: LaneInput<T>, options: MergeOptions = {}): AsyncIterable<ReadonlyArray<T | undefined>> {
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

      const promise = waitForResult(iteration);
      await new Promise<void>(microtask);
      const updated = await promise;

      if (errors.length === 1) {
        return Promise.reject(errors[0]);
      } else if (errors.length) {
        // TODO flatten other AggregateErrors into this
        return Promise.reject(new AggregateError(errors));
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

      if (onlyDone) {
        continue; // Skip
      }

      if (!valuesDone) {
        // Don't yield all done because the consumer already has received all these values
        yield Object.freeze(finalResults.map(result => result?.value));
      }

    } while (!valuesDone);
  } finally {
    await sourceIterator.return?.();
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
    if (lanesDone && !lanes.length) {
      // No lanes to do anything, exit
      return [];
    }

    if (errors.length) {
      // We have a problem, exit
      return [];
    }

    // Grab onto this promise early so we don't miss one
    const nextLane = laneAvailable.promise;

    const results = await Promise.any<AsyncIteratorSetResult<T>[]>([
      wait(),
      nextLane.then(() => [])
    ]);

    if (iteration !== active) {
      // Early exit if we actually aren't iterating this any more
      // I don't think this can actually trigger, but lets keep it around
      return [];
    }

    if (!results.length) {
      // We have a new lane available, lets loop around and initialise its promise
      return waitForResult(iteration);
    }

    return results;

    async function wait(): Promise<AsyncIteratorSetResult<T>[]> {
      const pendingLanes = lanes
        .filter(iterator => !read(iterator)?.done);
      if (!pendingLanes.length) {
        await nextLane;
        return [];
      }
      const promises = pendingLanes
        .map(iterator => {
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
        });
      const results: AsyncIteratorSetResult<T>[] = [];
      await Promise.any(promises.map(promise => promise.then(result => {
        if (result) {
          results.push(result);
        }
      })));
      // Clone so that it only uses the values we have now
      return [...results];
    }
  }
}
