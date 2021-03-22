import { deferred } from "./deferred";
import { QueueMicrotask } from "./microtask";

export function batchIterators<T>(microtask: QueueMicrotask, iterable: AsyncIterable<T>, atMost?: number): AsyncIterator<ReadonlyArray<T>> {
  const iterator = iterable[Symbol.asyncIterator]();
  let done = false,
    shouldTake = -1,
    currentPromise: Promise<void> | undefined = undefined,
    completed: T[] = [],
    iterationCompletion: Promise<void>,
    error: unknown = undefined;

  return cycle()[Symbol.asyncIterator]();

  async function *cycle() {
    try {
      do {
        // Early on in the cycle check for an error
        if (error) return Promise.reject(error);
        const { resolve: iterationComplete, promise } = deferred();
        iterationCompletion = promise;
        const takePromise = take(shouldTake += 1);
        await new Promise<void>(microtask);
        const currentComplete = [...completed];
        completed = [];
        iterationComplete();
        // Before yielding ensure we
        if (error) return Promise.reject(error);
        // Yield even if empty, this allows external tasks to process empty sets
        yield Object.freeze(currentComplete);
        await takePromise;
      } while ((!done || completed.length) && !error);
    } finally {
      await iterator.return?.();
      // This allows the promise to finalise and throw an error
      await currentPromise;
    }
  }

  async function take(currentShouldTake: number) {
    while (shouldTake === currentShouldTake && !hasEnough() && !done && !error) {
      currentPromise = currentPromise || iterator.next()
        .then(
          iteratorResult => {
            if (iteratorResult.done) {
              done = true;
            } else {
              completed.push(iteratorResult.value);
            }
          }
        )
        .catch(
          caught => {
            error = caught;
            done = true;
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
