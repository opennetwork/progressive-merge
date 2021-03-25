import {
  QueueMicrotask,
  newQueueIfExists,
  resetQueueIfExists,
  defaultQueueMicrotask
} from "./microtask";
import { batchIterators } from "./batch";
import internal from "stream";

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
  const microtask: QueueMicrotask = options.queueMicrotask || defaultQueueMicrotask;
  const queues: QueueMicrotask[] = [
    microtask
  ];
  const laneTask = batchIterators(microtask, mapLanes());
  let lanes: Lane<T>[] = [];
  let lanesDone = false;
  let valuesDone = false;
  const laneValues = new WeakMap<Lane<T>, T>();
  type LanePromise = Promise<IteratorResult<ReadonlyArray<IteratorResult<T>>>>;
  const lanePromise = new WeakMap<Lane<T>, LanePromise>();
  const individualLanesDone = new WeakMap<Lane<T>, boolean>();
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

    interface LaneIteratorResult {
      lane: Lane<T>;
      done: boolean;
      value?: T;
      updated?: boolean;
    }

    const currentLanes = [...lanes];
    if (!currentLanes.length) return { updated: false, results: [] };
    const results: LaneIteratorResult[] = [];
    const promises = currentLanes
      // Don't fetch from done lanes
      .filter(lane => !individualLanesDone.get(lane))
      .map(
        async (lane) => {
          const laneResult = await getLaneNext(lane);
          let value: T | undefined = laneValues.get(lane);
          if (laneResult.done) {
            return results.push({
              lane,
              done: true,
              value,
            });
          }
          const updated = laneResult.value?.length === 1;
          // It will always be 1 or 0 for inner lanes, see atMost passed in mapLanes
          if (updated) {
            value = laneResult.value[0];
          }
          results.push({
            lane,
            done: false,
            value,
            updated
          });
        }
      );

    // Wait for our microtask, past this, we will wait for at least one promise to
    // have a result, then yield our results
    // All in flight promises will be utilised next cycle
    await new Promise<void>(microtask);
    await Promise.any(promises);

    const partialResults = [...results];
    const laneResults = partialResults.reduce((map, result) => {
      return map.set(result.lane, result);
    }, new Map<Lane<T>, LaneIteratorResult>());

    const finalResults = currentLanes.map((lane): LaneIteratorResult => laneResults.get(lane) ?? { done: individualLanesDone.get(lane) ?? false, value: laneValues.get(lane), lane });
    const finalValues = Object.freeze(finalResults.map(result => result.value));
    const updated = !!results.find(result => result.updated);
    valuesDone = lanesDone && finalResults.every(result => result.done);

    for (const lane of laneResults.keys()) {
      // Used up, we will reset next time it is requested
      lanePromise.delete(lane);
    }

    for (const { value, lane } of finalResults.filter(result => result.updated)) {
      // Set our updated values
      laneValues.set(lane, value);
    }

    for (const { lane } of finalResults.filter(result => result.done)) {
      individualLanesDone.set(lane, true);
      lanePromise.delete(lane);
    }

    return {
      updated,
      results: finalValues
    };

    function getLaneNext(lane: Lane<T>): LanePromise {
      const previous = lanePromise.get(lane);
      if (previous) {
        return previous;
      }
      const next = lane.next();
      lanePromise.set(lane, next);
      return next;
    }
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
