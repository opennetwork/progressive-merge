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
  const inFlight = new Map<AsyncIterator<T>, Promise<AsyncIteratorSetResult<T>>>();
  const lanes: AsyncIterator<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const sourceIterator = asAsync(source)[Symbol.asyncIterator]();
  let active: IterationFlag | undefined = undefined;
  let lanesPromise: Promise<void> = Promise.resolve();
  let laneAvailable = deferred<AsyncIterator<T>>();

  do {
    const iteration: IterationFlag = active = Symbol();

    lanesPromise = lanesPromise.then(() => nextLanes(iteration));

    if (!lanes.length) {
      await laneAvailable.promise;
    }

    const promise = waitForResult(iteration);
    await new Promise<void>(microtask);
    const updated = await promise;

    for (const result of updated) {
      const { iterator } = result;
      inFlight.set(iterator, undefined);
      states.set(iterator, {
        ...result,
        value: result.done ? states.get(iterator)?.value : result.value,
        resolvedIteration: iteration
      });
    }

    const onlyDone = !!updated.every(result => result.done);

    if (onlyDone) {
      continue; // Skip
    }

    const finalResults = lanes.map(read);
    valuesDone = lanesDone && finalResults.every(result => result?.done);

    if (!valuesDone) {
      // Don't yield all done because the consumer already has received all these values
      yield Object.freeze(finalResults.map(result => result?.value));
    }
  } while (!valuesDone);

  function read(iterator: AsyncIterator<T>): AsyncIteratorSetResult<T> | undefined {
    return states.get(iterator);
  }

  async function nextLanes(iteration: IterationFlag) {
    while (active === iteration) {
      const nextLane = await sourceIterator.next();
      if (nextLane.done) {
        lanesDone = true;
        if (!lanes.length) {
          valuesDone = true;
        }
        break;
      } else if (nextLane.value) {
        const lane = asAsync<T>(nextLane.value)[Symbol.asyncIterator]();
        lanes.push(lane);
        laneAvailable.resolve(lane);
        laneAvailable = deferred();
      }
    }
  }

  async function waitForResult(iteration: IterationFlag): Promise<AsyncIteratorSetResult<T>[]> {
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
            }));
          inFlight.set(iterator, next);
          return next;
        });
      const results: AsyncIteratorSetResult<T>[] = [];
      promises.forEach(promise => promise.then(result => results.push(result)));
      await Promise.any(promises);
      // Clone so that it only uses the values we have now
      return [...results];
    }
  }
}
