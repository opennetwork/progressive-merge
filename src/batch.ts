import { deferred } from "./deferred";
import { QueueMicrotask } from "./microtask";

export function batchIterators<T>(microtask: QueueMicrotask, iterable: AsyncIterable<T>, atMost?: number): AsyncIterator<ReadonlyArray<T>> {
  const iterator = iterable[Symbol.asyncIterator]();
  let done = false,
    shouldTake = -1,
    currentPromise: Promise<void> | undefined = undefined,
    completed: T[] = [],
    error: unknown = undefined;

  return cycle()[Symbol.asyncIterator]();

  async function *cycle() {
    let iterationCompletion: Promise<void>;
    let onChange: () => void;
    try {
      do {
        // Early on in the cycle check for an error
        if (error) return Promise.reject(error);
        const { resolve: onChangeInit, promise: change } = deferred();
        onChange = onChangeInit;
        const { resolve: iterationComplete, promise: iterationCompletionInit } = deferred();
        iterationCompletion = iterationCompletionInit;
        const takePromise = take(shouldTake += 1);
        await new Promise<void>(microtask);
        iterationComplete();
        // Reject early if it is present
        if (error) return Promise.reject(error);
        if (!completed.length) {
          // We have an empty initial microtask, we will have completed later on
          yield Object.freeze([]);
        }
        // Wait for at least once result, once we get another result
        // we will be able to start batching based on microtask again
        //
        // Any time the promise takes longer than the microtask this will happen
        await change;
        const currentComplete = [...completed];
        completed = [];
        // Before yielding ensure we
        if (error) return Promise.reject(error);
        if (currentComplete.length) {
          // We would have yielded empty after the microtask was completed
          yield Object.freeze(currentComplete);
        }
        await takePromise;
      } while ((!done || completed.length) && !error);
    } finally {
      await iterator.return?.();
      // This allows the promise to finalise and throw an error
      await currentPromise;
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
          )
          .then(onChange);
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
  }

  function hasEnough() {
    if (typeof atMost !== "number") {
      return false;
    }
    return completed.length >= atMost;
  }
}
