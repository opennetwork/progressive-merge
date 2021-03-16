export async function *latest<T>(merge: AsyncIterable<ReadonlyArray<IteratorResult<T> | undefined>>): AsyncIterable<ReadonlyArray<T | undefined>> {

  let previousSlice: (T | undefined)[] = [];

  for await (const slice of merge) {
    const currentSlice = slice.map((update, index) => {
      if (!update || update.done) return previousSlice[index];
      return update.value;
    });
    const complete = slice.every(update => update && update.done);
    // This is the final slice, no external update required
    if (complete) break;
    yield currentSlice;
    previousSlice = currentSlice;
  }

}
