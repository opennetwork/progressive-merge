import { asyncExtendedIterable } from "iterable";
import { ok } from "assert";

const left = [1, 3, 5, 8, 9];
const middle = [4, 6, 7];
const right = [0, 2];

const mergedLayers = [
  [undefined, undefined, 0],
  [1, undefined, 0],
  [1, 4, 0], // <- It appears we jumped the queue, but this is back filling to be complete that layer, the next layer can start loading in parallel
  [undefined, undefined, 2],
  [3, undefined, 2],
  [3, 6, 2], // <- "right" is now in a done state, so it will not appear in future layers
  [5, undefined],
  [5, 7], // <- "middle" is now in a done state, so it will not appear in a future layer
  [8],
  [9] // <- "left" is now in a done state, along with all other iterables, meaning the merge is complete
];

function producers(): AsyncIterable<number>[] {
  const left = [1, 3, 5, 8, 9];
  const middle = [4, 6, 7];
  const right = [0, 2];
  const sequences = [left, middle, right];
  const source = asyncExtendedIterable(left.concat(middle).concat(right).sort((a, b) => a < b ? -1 : 1));
  return sequences.map(sequence => source.filter(value => sequence.includes(value)).toIterable());
}

const updates = producers();

Promise.all(updates.map(update => asyncExtendedIterable(update).forEach(output => console.log({ output }))))
  .then(() => console.log("Complete"))
  .catch(console.error);

