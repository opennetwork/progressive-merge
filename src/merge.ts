export async function *merge<T>(lanes: AsyncIterable<AsyncIterable<T>>): AsyncIterable<AsyncIterable<T | undefined>> {
  type IteratorValue = [AsyncIterator<T>, IteratorResult<T>];

  const lanePromises = new WeakMap<AsyncIterator<T>, Promise<IteratorResult<T>>>();
  const laneIteratorStates = new WeakMap<AsyncIterator<T>, IteratorResult<T>>();
  const laneIterator = lanes[Symbol.asyncIterator]();

  let nextLanePromise: Promise<IteratorResult<AsyncIterable<T>>>;

  let currentIterators: AsyncIterator<T>[] = [];

  let allLanes = false;

  do {
    yield values(currentIterators);
  } while (!allLanes || currentIterators.length);

  async function *values(iterators: AsyncIterator<T>[]): AsyncIterable<T | undefined> {
    const trackingIterators = iterators.slice();
    let currentYieldedIndex = -1;
    do {
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

      // console.log(promises);

      if (!promises.length) {
        return; // Nothing more to do
      }

      const isNext = await Promise.race(promises);

      // console.log({ isNext });

      if (isNext) {
        const nextLane = await nextLanePromise;
        nextLanePromise = undefined;
        if (nextLane.done) {
          allLanes = true;
          // console.log("Continue", trackingIterators.length);
          continue;
        } else {
          currentIterators = currentIterators.concat(nextLane.value[Symbol.asyncIterator]());
          // console.log("Return");
          return;
        }
      }

      const [iterator, result] = await resultsPromise;
      const index = trackingIterators.indexOf(iterator);

      lanePromises.set(iterator, undefined);
      laneIteratorStates.set(iterator, result);

      // console.log(index, result);

      // Starting again in the next layer
      if (index === -1) {
        return;
      }

      // When we get a finished iterator, we start a new track
      if (result.done) {
        const currentIndex = currentIterators.indexOf(iterator);
        currentIterators.splice(currentIndex, 1);
        return;
      }

      // Remove from our remaining iterators for this layer, we can no longer accept a value for it
      trackingIterators.splice(0, index + 1);

      const yieldingIndex = iterators.indexOf(iterator);

      // Bring up to speed on where we are in our values
      do {
        const nextIndex = currentYieldedIndex += 1;
        const nextIterator = iterators[nextIndex];
        const nextIteratorState = laneIteratorStates.get(nextIterator);
        // Nothing in this layer
        if (!nextIteratorState || nextIteratorState.done) {
          continue;
        }
        yield nextIteratorState ? nextIteratorState.value : undefined;
      } while (currentYieldedIndex < yieldingIndex);
    } while (trackingIterators.length);
  }

  function iteratorResults(iterators: AsyncIterator<T>[]): Promise<IteratorValue> {
    const promises = iterators.map(iterator => {
      let promise = lanePromises.get(iterator);
      if (!promise) {
        promise = iterator.next();
        // console.log("New promise");
        promise.then(result => console.log({ result })).catch(error => console.error(error));
        lanePromises.set(iterator, promise);
      }
      return promise.then((result): IteratorValue => [iterator, result]);
    });
    // console.log(promises);
    return Promise.race(promises);
  }


}
