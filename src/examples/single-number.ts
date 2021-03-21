import { asyncIterable, asyncExtendedIterable } from "iterable";
import { merge } from "../merge";
import { latest } from "../latest";

const left = asyncIterable([1, 2, 3, 4]);
const right = asyncIterable([5, 6, 7, 8]);

const producers = asyncIterable([left, right]);

log(merge(producers, {
  queueMicrotask: callback => setTimeout(callback, 100)
})).catch(console.error);

function log(merged: AsyncIterable<ReadonlyArray<number | undefined>>) {
  return asyncExtendedIterable(merged)
    .toArray()
    .then(result => console.log(JSON.stringify(result, undefined, "  ")));
}
