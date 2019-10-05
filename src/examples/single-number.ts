import { asyncIterable, asyncExtendedIterable } from "iterable";
import { merge } from "../merge";

const left = asyncIterable([1]);
const right = asyncIterable([2]);

const producers = asyncIterable([left, right]);

log(merge(producers, undefined)).catch(console.error);

function log(merged: AsyncIterable<AsyncIterable<number>>) {
  return asyncExtendedIterable(merged)
    .map(layer => asyncExtendedIterable(layer).toArray())
    .toArray()
    .then(result => console.log(JSON.stringify(result, undefined, "  ")));
}
