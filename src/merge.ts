import {
  QueueMicrotask,
  defaultQueueMicrotask,
  newQueueIfExists,
  shiftingQueueMicrotask,
  resetQueueIfExists
} from "./microtask";
import { batchIterators } from "./batch";


export type Lane<T> = AsyncIterator<ReadonlyArray<IteratorResult<T>>>;

export interface MergeOptions<T> {
  queueMicrotask?: QueueMicrotask;
}

export type MergeInput<T> = AsyncIterable<T> | Iterable<T>;
export type MergeLaneInput<T> = MergeInput<MergeInput<T>>;

interface ResultSet<T> {
  updated: boolean;
  results: T;
}

export async function *merge<T>(iterables: MergeLaneInput<T>, options: MergeOptions<T> = {}): AsyncIterable<ReadonlyArray<T | undefined>> {
  const microtask: QueueMicrotask = options.queueMicrotask || shiftingQueueMicrotask();
  const queues: QueueMicrotask[] = [
    microtask
  ];
  const laneTask = batchIterators(microtask, mapLanes());
  let lanes: Lane<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const laneValues = new WeakMap<Lane<T>, T>();
  do {
    const { updated, results } = await next();
    if (!updated) continue;
    yield results;
    queues.forEach(resetQueueIfExists);
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
      const results: ReadonlyArray<Lane<T>> = nextLanes.value;
      lanes = lanes.concat(results);
    }
  }

  async function nextResults(): Promise<ResultSet<ReadonlyArray<T | undefined>>> {
    const currentLanes = [...lanes];
    let updated = false;
    if (!currentLanes.length) return { updated, results: [] };
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
          // It will always be 1 or 0 for inner lanes, see atMost passed in mapLanes
          if (laneResult.value?.length === 1) {
            value = laneResult.value[0];
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

  async function *mapLanes() {
    for await (const lane of asAsync(iterables)) {
      const queue = newQueueIfExists(microtask);
      if (queue !== microtask) {
        queues.push(queue);
      }
      yield batchIterators(queue, asAsync(lane), 1);
    }
  }

  async function *asAsync<T>(iterables: MergeInput<T>): AsyncIterable<T> {
    yield* iterables;
  }

  function isDone() {
    return lanesDone && valuesDone;
  }
}
