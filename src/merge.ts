export async function *merge<T, E>(lanes: AsyncIterable<AsyncIterable<T>>, empty: E, signalAllIterators: () => void): AsyncIterable<AsyncIterable<IteratorResult<T> | E>> {
  type IteratorValue = [AsyncIterator<T>, IteratorResult<T>];

  const lanePromises = new WeakMap<AsyncIterator<T>, Promise<IteratorResult<T>>>();
  const laneIteratorStates = new WeakMap<AsyncIterator<T>, IteratorResult<T>>();
  const laneIterator = lanes[Symbol.asyncIterator]();

  let nextLanePromise: Promise<IteratorResult<AsyncIterable<T>>>;

  let currentIterators: AsyncIterator<T>[] = [];

  const pending: IteratorValue[] = [];

  let allLanes = false;

  do {
    yield values(currentIterators);
  } while (!allLanes || currentIterators.filter(iterator => !!iterator).length || pending.length);

  // Notification of complete
  if (currentIterators.length) {
    yield yieldValues(currentIterators, -1, currentIterators.length - 1);
  }

  async function *yieldValues(iterators: AsyncIterator<T>[], currentYieldedIndex: number, yieldingIndex: number): AsyncIterable<IteratorResult<T> | E> {
    let currentTrackingYieldedIndex = currentYieldedIndex;
    do {
      const nextIndex = currentTrackingYieldedIndex += 1;
      const nextIterator = iterators[nextIndex];
      if (!nextIterator) {
        // If the next iterator is undefined, it means it was completed
        yield { done: true, value: undefined };
      } else {
        const nextIteratorState = laneIteratorStates.get(nextIterator);
        if (!nextIteratorState) {
          yield empty;
        } else {
          yield nextIteratorState;
        }
      }
    } while (currentTrackingYieldedIndex < yieldingIndex);
  }

  async function *values(iterators: AsyncIterator<T>[]): AsyncIterable<IteratorResult<T> | E> {
    const trackingIterators = iterators.slice();
    let currentYieldedIndex = -1;
    do {
      const nextResult = await getNextResult();

      if (!nextResult) {
        if (currentYieldedIndex === -1) {
          // Restart
          return yield* values(currentIterators);
        }
        return; // Signal to loop externally
      }

      const [iterator, result] = nextResult;

      const index = trackingIterators.indexOf(iterator);

      console.log({ result, index });

      lanePromises.set(iterator, undefined);
      laneIteratorStates.set(iterator, result);

      // Starting again in the next layer
      if (index === -1) {
        pending.push([iterator, result]);
        return;
      }

      // When we get a finished iterator, we start a new track
      if (result.done) {
        const currentIndex = currentIterators.indexOf(iterator);
        currentIterators[currentIndex] = undefined;
        return;
      }

      // Remove from our remaining iterators for this layer, we can no longer accept a value for it
      trackingIterators.splice(0, index + 1);

      const yieldingIndex = iterators.indexOf(iterator);
      yield* yieldValues(iterators, currentYieldedIndex, yieldingIndex);
      currentYieldedIndex = yieldingIndex;
    } while (trackingIterators.length);

    if (currentYieldedIndex < (iterators.length - 1)) {
      yield* yieldValues(iterators, currentYieldedIndex, iterators.length - 1);
    }

    async function getNextResult(): Promise<IteratorValue> {

      if (pending.length) {
        return pending.shift();
      }

      if (!allLanes && !nextLanePromise) {
        nextLanePromise = laneIterator.next();
      }

      const resultsPromise = iterators.length ? iteratorResults(iterators) : undefined;

      const promises = [];

      if (nextLanePromise) {
        promises.push(nextLanePromise.then(() => true));
      }

      if (resultsPromise) {
        promises.push(resultsPromise.then(() => false));
      }

      if (!promises.length) {
        return undefined; // Nothing more to do
      }

      const isNext = await Promise.race(promises);

      if (isNext) {
        const nextLane = await nextLanePromise;
        nextLanePromise = undefined;
        if (nextLane.done) {
          allLanes = true;
          if (signalAllIterators) {
            signalAllIterators();
          }
          return getNextResult();
        } else {
          currentIterators = currentIterators.concat(nextLane.value[Symbol.asyncIterator]());
          return undefined;
        }
      }

      console.log("Results");
      return resultsPromise;
    }
  }

  function iteratorResults(iterators: AsyncIterator<T>[]): Promise<IteratorValue> {
    const promises = iterators
      .filter(iterator => !!iterator)
      .map(iterator => {
        let promise = lanePromises.get(iterator);
        if (!promise) {
          promise = iterator.next();
          lanePromises.set(iterator, promise);
        }
        return promise.then((result): IteratorValue => [iterator, result]);
      });
    return Promise.race(promises);
  }


}
