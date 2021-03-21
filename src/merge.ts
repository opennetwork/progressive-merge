import { deferred } from "./deferred";

interface QueueMicrotask {
  (callback: () => void): void;
}

export type Lane<T> = AsyncIterator<ReadonlyArray<IteratorResult<T>>>;

export interface MergeOptions<T> {
  queueMicrotask?: QueueMicrotask;
}

type MergeInput<T> = AsyncIterable<T> | Iterable<T>;
type MergeLaneInput<T> = MergeInput<MergeInput<T>>;

interface ResultSet<T> {
  updated: boolean;
  results: T;
}

export async function *merge<T>(iterables: MergeLaneInput<T>, options: MergeOptions<T> = {}): AsyncIterable<ReadonlyArray<T | undefined>> {
  const microtask: QueueMicrotask = options.queueMicrotask || defaultQueueMicrotask;
  const laneTask = microtaskIteratorResultSet(microtask, mapLanes());
  let lanes: Lane<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const laneValues = new WeakMap<Lane<T>, T>();
  do {
    const { updated, results } = await next();
    if (updated) {
      yield results;
    }
  } while (!isDone());

  async function next() {
    const [results] = await Promise.all([
      nextResults(),
      nextLanes()
    ]);
    return results;
  }

  async function nextLanes() {
    while (!lanesDone) {
      const nextLanes = await laneTask.next();
      if (nextLanes.done) {
        lanesDone = true;
        if (!lanes.length) {
          valuesDone = true;
        }
        break;
      }
      const results: ReadonlyArray<IteratorResult<Lane<T>>> = nextLanes.value;
      lanes = lanes.concat(mapAndFilterResults(results));
    }
  }

  async function nextResults(): Promise<ResultSet<ReadonlyArray<T | undefined>>> {
    const currentLanes = [...lanes];
    if (!currentLanes.length) return { updated: false, results: [] };
    let updated = false;
    const results = await Promise.all(
      currentLanes.map(
        async (lane) => {
          const laneResult = await lane.next();
          let value: T | undefined = laneValues.get(lane);
          if (laneResult.done) {
            return {
              lane,
              done: true,
              value
            };
          }
          const results = mapAndFilterResults<T>(laneResult.value);
          // It will always be 1 or 0 for inner lanes, see atMost passed in mapLanes
          if (results.length === 1) {
            value = results[0];
            laneValues.set(lane, value);
            updated = true;
          }
          return {
            lane,
            done: false,
            value
          };
        }
      )
    );
    valuesDone = results.every(result => result.done);
    return {
      updated,
      results: Object.freeze(results.map(result => result.value))
    };
  }

  function mapAndFilterResults<T>(results: ReadonlyArray<IteratorResult<T>>): T[] {
    return results
      .map((result): T | undefined => result.value)
      .filter((result): result is T => !!result);
  }

  async function *mapLanes() {
    for await (const lane of asAsync(iterables)) {
      yield microtaskIteratorResultSet(microtask, asAsync(lane), 1);
    }
  }

  async function *asAsync<T>(iterables: MergeInput<T>): AsyncIterable<T> {
    yield* iterables;
  }

  function isDone() {
    return lanesDone && valuesDone;
  }
}

export function defaultQueueMicrotask(fn: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
  } else if (typeof setImmediate === "function") {
    setImmediate(fn);
  } else {
    setTimeout(fn, 0);
  }
}

function microtaskIteratorResultSet<T>(microtask: QueueMicrotask, iterable: AsyncIterable<T>, atMost?: number): AsyncIterator<ReadonlyArray<IteratorResult<T>>> {
  const iterator = iterable[Symbol.asyncIterator]();
  let done = false,
    shouldTake = -1,
    currentPromise: Promise<IteratorResult<T>> | undefined = undefined,
    completed: IteratorResult<T>[] = [],
    iterationCompletion: Promise<void>;

  return cycle()[Symbol.asyncIterator]();

  async function *cycle() {
    try {
      do {
        const { resolve: iterationComplete, promise } = deferred();
        iterationCompletion = promise;
        const takePromise = take(shouldTake += 1);
        await new Promise<void>(microtask);
        const currentComplete = [...completed];
        completed = [];
        iterationComplete();
        // Yield even if empty, this allows external tasks to process empty sets
        yield Object.freeze(currentComplete);
        await takePromise;
      } while (!done || completed.length);
    } finally {
      await iterator.return?.();
      // This allows the promise to finalise and throw an error
      await currentPromise;
    }
  }

  async function take(currentShouldTake: number) {
    while (shouldTake === currentShouldTake && !hasEnough() && !done) {
      currentPromise = currentPromise || iterator.next().then(
        iteratorResult => {
          completed.push(iteratorResult);
          if (iteratorResult.done) {
            done = true;
          }
          return iteratorResult;
        }
      );
      const currentPromiseResolved = await Promise.any<boolean>([
        currentPromise.then(() => true),
        iterationCompletion.then(() => false)
      ]);
      if (!currentPromiseResolved) {
        break; // We completed our iteration
      }
      currentPromise = undefined;
    }
  }

  function hasEnough() {
    if (typeof atMost !== "number") {
      return false;
    }
    return completed.length >= atMost;
  }
}
