import { source, asyncExtendedIterable } from "iterable";
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

  const iterator = cycle()[Symbol.asyncIterator]();

  const targets = sequences.map((numbers, index) => {
    const target = source<number>(sourceCycle);
    target.hold();
    return target;

    // This will drain the iterator for the next value, or done
    async function sourceCycle(): Promise<number> {
      const next = await iterator.next();
      if (next.done) {
        return undefined;
      }
      if (next.value.index === index) {
        console.log("Received!", next.value.number);
        return next.value.number;
      } else {
        console.log("Pushed!", next.value.number);
        targets[next.value.index].push(next.value.number);
        return sourceCycle();
      }
    }
  });

  return targets.map(target => asyncExtendedIterable(target).filter(value => typeof value === "number").toIterable());

  async function *cycle(): AsyncIterable<{ index: number, number: number }> {
    const trackingNumbers: number[] = left.concat(middle).concat(right).sort((a, b) => a < b ? -1 : 1);
    const trackingSequences: number[][] = sequences.map(sequence => sequence.slice());
    let number: number;
    do {
      number = trackingNumbers.shift();
      ok(typeof number === "number");
      const matchingSequenceIndex = trackingSequences.findIndex(sequence => sequence.includes(number));
      if (matchingSequenceIndex === -1) {
        // Complete
        return;
      }
      ok(trackingSequences[matchingSequenceIndex][0] === number, "Expected sequences to be in order");
      ok(targets[matchingSequenceIndex]);
      // Can no longer be used
      trackingSequences[matchingSequenceIndex].shift();
      console.log("Yield", { index: matchingSequenceIndex, number });
      yield { index: matchingSequenceIndex, number };
      // We will no longer produce a value for this target
      if (trackingSequences[matchingSequenceIndex].length === 0) {
        targets[matchingSequenceIndex].close();
      }
    } while (trackingNumbers.length);
  }
}

const updates = producers();

Promise.all(updates.map(update => asyncExtendedIterable(update).forEach(output => console.log({ output }))))
  .then(() => console.log("Complete"))
  .catch(console.error);

