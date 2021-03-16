export async function *latest<T>(merge: AsyncIterable<ReadonlyArray<IteratorResult<T> | undefined>>): AsyncIterable<ReadonlyArray<T | undefined>> {

  let previousSlice: (T | undefined)[] = [];

  for await (const slice of merge) {
    // If we have only undefined, equal values, or done, then we have no update in this slice
    const sliceEmpty = slice.every((update, index) => !update || update.done || Object.is(update.value, previousSlice[index]));
    if (sliceEmpty) continue;
    const currentSlice = slice.map((update, index) => {
      if (!update || update.done) return previousSlice[index];
      return update.value;
    });
    yield currentSlice;
    previousSlice = currentSlice;
  }

}
