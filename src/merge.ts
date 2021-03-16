import { Collector, CollectorOptions } from "microtask-collector";

export interface MergeLaneUpdate<T> {
  index: number;
  result: IteratorResult<T>;
}

export interface MergeCollectorOptions<T> extends Omit<CollectorOptions<MergeLaneUpdate<T>, ReadonlyArray<MergeLaneUpdate<T>>>, "map"> {

}

export interface MergeCollector<T> extends Collector<MergeLaneUpdate<T>, ReadonlyArray<MergeLaneUpdate<T>>> {

}

export interface IteratorResultPromiseMetadata<T> {
  index: number;
  iterator: AsyncIterator<T>;
  iterable: AsyncIterable<T>;
}

export interface MergeOptions<T> {
  // Allows for each individual error source to be
  onIteratorResultPromise?(promise: Promise<IteratorResult<T>>, meta: IteratorResultPromiseMetadata<T>): void;
  onInflight?(index: number): void;
  onComplete?(index: number): void;
  onError?(index: number, error: unknown): void;
  onAllInflight?(count: number): void;
  onBatchComplete?(slices: ReadonlyArray<ReadonlyArray<IteratorResult<T> | undefined>>): void;
  collector?: MergeCollector<T> | MergeCollectorOptions<T>;
}

export async function *merge<T>(lanes: AsyncIterable<AsyncIterable<T>>, options: MergeOptions<T> = {}): AsyncIterable<ReadonlyArray<IteratorResult<T> | undefined>> {

  const collector = createCollector();
  const generatePromise = generate();

  let receivedError: unknown = undefined;

  let laneCount: number | undefined = undefined;

  let slices: ReadonlyArray<IteratorResult<T> | undefined>[] = [];

  try {
    for await (const batch of collector) {
      if (receivedError) {
        await Promise.reject(receivedError);
      }

      yield *processBatch(batch);

      const slice = lastSlice();

      if (typeof laneCount === "number" && slice.length === laneCount) {
        const allDone = slice.every(result => result.done);
        if (allDone) {
          collector.close();
          break;
        }
      }

      // Reset slices
      slices = [slice];
    }
  } finally {
    await generatePromise;
  }

  if (receivedError) {
    return Promise.reject(receivedError);
  }

  function lastSlice() {
    return slices[slices.length - 1] ?? [];
  }

  function *processBatch(batch: Iterable<MergeLaneUpdate<T>>): Iterable<ReadonlyArray<IteratorResult<T> | undefined>> {
    let indexesChanged: number[] = [];
    let nextResults = [...lastSlice()];
    slices = [];
    for (const{ index, result } of batch) {
      if (indexesChanged.includes(index)) {
        yield pushSlice();
        nextResults = [...lastSlice()];
        indexesChanged = [];
      }
      nextResults[index] = result;
      indexesChanged.push(index);
    }
    yield pushSlice();
    if (options.onBatchComplete) {
      options.onBatchComplete(Object.freeze([...slices]));
    }

    function pushSlice() {
      const results = Object.freeze(nextResults);
      slices.push(results);
      return results;
    }
  }

  function handleError(error: unknown) {
    receivedError = receivedError ?? error ?? new Error("Promise rejected with no error");
  }

  async function generate() {
    let index = -1;
    const promises: Promise<void>[] = [];
    for await (const lane of lanes) {
      index += 1;
      const promise = generateLane(lane, index);
      if (options.onComplete) {
        promise.then(options.onComplete.bind(undefined, index));
      }
      if (options.onError) {
        promise.then(options.onError.bind(undefined, index));
      }
      promises.push(promise);
      if (options.onInflight) {
        options.onInflight(index);
      }
    }
    laneCount = promises.length;
    if (options.onAllInflight) {
      options.onAllInflight(laneCount);
    }
    if (laneCount > 0) {
      await Promise.all(
        promises.map(promise => promise.catch(handleError))
      );
    }
    // All done
    collector.close();
  }

  async function generateLane(lane: AsyncIterable<T>, index: number) {
    const iterator = lane[Symbol.asyncIterator]();
    let result: IteratorResult<T>;
    do {
      const promise = iterator.next();
      if (options.onIteratorResultPromise) {
        options.onIteratorResultPromise(promise, {
          index,
          iterable: lane,
          iterator
        });
      }
      result = await promise;
      collector.add({
        index,
        result
      });
    } while (!result.done);
  }

  function createCollector(): MergeCollector<T> {
    if (isMergeCollector(options.collector)) {
      return options.collector;
    }
    return new Collector({
      ...options.collector,
      map: input => Object.freeze(input)
    });
    function isMergeCollector<T>(value: unknown): value is MergeCollector<T> {
      if (value instanceof Collector) {
        return true; // For sure it is
      }
      function isMergeCollectorLike(value: unknown): value is { add: unknown, close: unknown, [Symbol.asyncIterator]: unknown } {
        return !!value;
      }
      return (
        isMergeCollectorLike(value) &&
        typeof value.add === "function" &&
        typeof value.close === "function" &&
        typeof value[Symbol.asyncIterator] === "function"
      );
    }
  }



}
