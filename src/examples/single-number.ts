import { asyncIterable, asyncExtendedIterable } from "iterable";
import { merge } from "../merge";

const left = asyncIterable([1, 2, 3, 4]);
const right = asyncIterable([5, 6, 7, 8]);

const producers = asyncIterable([left, right]);

log(merge(producers, {
  onInflight(index: number) {
    console.log({ onInflight: index });
  },
  onComplete(index: number) {
    console.log({ onComplete: index });
  },
  onAllInflight(count: number) {
    console.log({ onAllInflight: count });
  },
  onBatchComplete(slices: ReadonlyArray<ReadonlyArray<IteratorResult<number> | undefined>>) {
    console.log({ onBatchComplete: slices });
  },
  onIteratorResultPromise(promise: Promise<IteratorResult<number>>, meta) {
    console.log({ promise, meta });
  },
  collector: {
    queueMicrotask: callback => setTimeout(callback, 100)
  }
})).catch(console.error);

function log(merged: AsyncIterable<Iterable<IteratorResult<number> | undefined>>) {
  return asyncExtendedIterable(merged)
    .toArray()
    .then(result => console.log(JSON.stringify(result, undefined, "  ")));
}
