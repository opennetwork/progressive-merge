export async function *merge<T, E>(lanes: AsyncIterable<AsyncIterable<T>>, empty: E, onPromise?: (promise: Promise<unknown>) => void, onAllIterators?: () => void): AsyncIterable<AsyncIterable<IteratorResult<T> | E>> {

  // We need to be able to keep track on what we're waiting for, and what we know
  // These are weak because we can remove the reference in currentIterators, when we don't have a reference
  // any more it means that our state is { done: true }
  const lanePromises = new WeakMap<AsyncIterator<T>, Promise<IteratorValue>>();
  const laneIteratorStates = new WeakMap<AsyncIterator<T>, IteratorResult<T>>();

  // This is our source of lanes, we will hold this reference to a single iterator throughout this merge
  const laneIterator = lanes[Symbol.asyncIterator]();

  // This is the promise that is assigned using `laneIterator.next`, we will use it
  // to know we are waiting for another lane, it could be put to the side if
  // a lane produces a new value before we have a new lane
  let nextLanePromise: Promise<IteratorResult<AsyncIterable<T>>>;

  // These are our iterators for each lane, the index of an
  // iterator is its index matching when it was found, it will match the index of our
  // output value for each one of these iterators
  const currentIterators: AsyncIterator<T>[] = [];

  // These are iterator values that can't fit in the current iteration, but still are waiting to be utilised
  const pending: IteratorValue[] = [];

  // This lets us know if we have triggered onAllIterators and means we're only waiting on new values
  // from then on
  //
  // We know also if we have more lanes to find, we have more work to do
  let allLanes = false;

  do {
    yield values(currentIterators);
  }
  // These are our checks to see if we have more work to do at the top level
  while (
    // If we have more lanes to get, we have more work
    !allLanes ||
    // If we have remaining iterators, we have more work
    // An iterator will be undefined once we have no more work for it
    currentIterators.filter(iterator => !!iterator).length ||
    // We have some pending output, we have more work
    pending.length
  );

  // This provides a way to yield a slice of known iterator states
  function *yieldValues(iterators: AsyncIterator<T>[], currentYieldedIndex: number, yieldingIndex: number): Iterable<IteratorResult<T> | E> {
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
          // If we have no state, we don't know what this is, so use the provided empty value
          yield empty;
        } else {
          // This is our happy state, where we know the state of an iterator and can directly provide its value
          // this will most of the time look like { done: false, value: T }
          //
          // It will be { done: true } if the iterator was completed in this cycle, else { done: true } will be
          // handled by setting the iterators index in currentIterators to undefined
          yield nextIteratorState;
        }
      }

    }
    // We will keep doing this cycle until we're at the index we needed to output
    while (currentTrackingYieldedIndex < yieldingIndex);
  }

  async function *values(iterators: AsyncIterator<T>[]): AsyncIterable<IteratorResult<T> | E> {
    // We'll keep a list of iterators we haven't seen a value for yet
    const trackingIterators = iterators.slice();
    // This will keep track where we are up to in our output for this cycle, we can only go forward
    let currentYieldedIndex = -1;
    do {

      // This will be undefined if we don't have anything to do in this cycle and instead should output the remaining
      // values
      const nextResult = await getNextResult();

      if (!nextResult) {
        if (currentYieldedIndex === -1) {
          // We can restart because we never saw a value before
          // This can only happen for !nextResult because all other instances we would of had some change to the state
          return yield* values(currentIterators);
        }
        // Break the generation loop, which will output the remaining values
        break;
      }

      const [iterator, result] = nextResult;

      // If this index is -1, we know we have seen the value before
      const index = trackingIterators.indexOf(iterator);

      // We have used the promise for this iterator, meaning we don't need to check it again
      // a new promise will be created when we next ask for it
      lanePromises.set(iterator, undefined);

      // This means we saw this value before, by adding it to pending we can re-run this process in a new loop
      if (index === -1) {
        pending.push([iterator, result]);
        break;
      }

      // This will set the current state for the iterator, by the time we get here, the previous state will have been used
      laneIteratorStates.set(iterator, result);

      // When we get a finished iterator, we need to loop around again
      // TODO we could finish the rest of the loop for a complete iterator, but adds a little more complexity
      // instead we will produce a new layer and next loop we continue as normal
      if (result.done) {
        const currentIndex = currentIterators.indexOf(iterator);
        currentIterators[currentIndex] = undefined;
        break;
      }

      // Remove from our remaining iterators for this layer, we can no longer accept a value for any before this index
      trackingIterators.splice(0, index + 1);

      // We want to yield up to the index of our current iterator, this will include our new value
      const yieldingIndex = iterators.indexOf(iterator);
      yield* yieldValues(iterators, currentYieldedIndex, yieldingIndex);
      currentYieldedIndex = yieldingIndex;

    }
    // Continue until we have nothing left to track
    while (trackingIterators.length);

    // We may have not yielded our entire state for this layer, so if we have any remaining, yield it
    const maximumYieldingIndex = iterators.length - 1;
    if (currentYieldedIndex < maximumYieldingIndex) {
      yield* yieldValues(iterators, currentYieldedIndex, maximumYieldingIndex);
    }

    async function getNextResult(): Promise<IteratorValue> {

      // If we have any values that we haven't utilised yet, use them first
      // This will always be an array with a single value, or no values
      // but it makes it a clean way to manage this
      if (pending.length) {
        return pending.shift();
      }

      // If we haven't finished with our lanes, and are no waiting for a new one
      // set up to wait again
      if (!allLanes && !nextLanePromise) {
        nextLanePromise = laneIterator.next();

        if (onPromise) {
          // Notify externally so that errors can be settled
          onPromise(nextLanePromise);
        }
      }

      const resultsPromise = iteratorResults(iterators);

      const promises = [];

      if (nextLanePromise) {
        promises.push(nextLanePromise.then(() => true));
      }

      if (resultsPromise) {
        promises.push(resultsPromise.then(() => false));
      }

      // If we don't have a promise for either, then as with the iterators, we could never have a winner
      // in our race, so lets signal that we can't do anything with our currents state
      if (!promises.length) {
        return undefined;
      }

      const isNext = await Promise.race(promises);

      if (!isNext) {
        // If we don't have a new lane, we will always have a new result for an iterator
        // this is because the race is either going to return true or false
        return resultsPromise;
      }

      const nextLane = await nextLanePromise;

      // Record that we are no longer waiting for a new lane
      nextLanePromise = undefined;

      if (nextLane.done) {
        // Record we have no more lanes to find
        allLanes = true;
        if (onAllIterators) {
          // Signal externally that we no longer will be waiting for lanes
          // this can be useful if the consumer wants to only start producing values once there is something utilising
          // its iterators
          onAllIterators();
        }
        // Loop around to figure out what the next bit of work is
        return getNextResult();
      } else {
        // Record our new iterator, and start again
        currentIterators.push(nextLane.value[Symbol.asyncIterator]());
        // Return undefined which signals that we can't do anything with our currents state
        // and that we should reset, this triggers the currentIterators.length check of the external do/while
        return undefined;
      }


    }
  }

  // We will use this type to tie results to an iterator
  type IteratorValue = [AsyncIterator<T>, IteratorResult<T>];

  function iteratorResults(iterators: AsyncIterator<T>[]): undefined | Promise<IteratorValue> {
    const promises = iterators
      .filter(iterator => !!iterator)
      .map(iterator => {
        let promise = lanePromises.get(iterator);

        if (promise) {
          // We already had a promise, lets wait for it again
          return promise;
        }

        // We have no promise for this iterator, so lets get the next promise
        // We will modify this promise inline so that is always tied directly to an iterator
        promise = iterator
          .next()
          .then((result): IteratorValue => [iterator, result]);

        if (onPromise) {
          // Notify externally so that errors can be settled
          onPromise(promise);
        }

        // Record that we have a promise for this iterator
        lanePromises.set(iterator, promise);

        return promise;
      });

    // Only if we have an iterator to get result for will we wait for a new result,
    // else it will be a race between no one with no winners, resulting in a never resolving promise
    // returning undefined here will result in the returned value to be never used in the values function
    if (promises.length === 0) {
      return undefined;
    }

    // If we have 1 promise, let it resolve on its own, no need to race anyone
    if (promises.length === 1) {
      return promises[0];
    }

    // We're going to try both methods at the same time
    const allPromise = Promise.all(promises),
      racePromise = Promise.race(promises);

    // Utilise https://developer.mozilla.org/en-US/docs/Glossary/IIFE
    // so that we can produce an intermediate promised' function that does a bit more
    return (async function allOrRace() {

      // TODO find out if this is worth doing
      // it appears this works, as I have seen cases where all is favoured and used
      const isAll = await Promise.race([
        allPromise.then(() => true),
        racePromise.then(() => false)
      ]);

      if (!isAll) {
        // We didn't finish all our promises, but someone won the race!
        return racePromise;
      }

      const all = await allPromise;

      // If we know the state of all our iterables, we can prefer the iterables that are
      // done so we can remove them from our layers
      const done = all.find(result => result[1].done);

      if (done) {
        return done;
      }

      // If we didn't find any done, utilise the race promise, which will know which one should have won
      // its state will be already complete
      return racePromise;
    })();

  }

}
