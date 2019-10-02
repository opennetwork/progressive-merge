# Progressive Merge

Aim is to merge a growing list of values that can be loading in parallel with different resolution 
times

## Example

We have three iterables, with each producing a number, if we were to represent them as arrays
they would look like this:

```js
const left = [1, 3, 5, 8, 9];
const middle = [4, 6, 7];
const right = [0, 2];
```

We would expect the merge to result in an iterable that looks like this:

```js
const mergedLayers = [
  [undefined, undefined, 0],
  [1, undefined, 0],
  [1, undefined, 2],
  [3, undefined, 2],
  [3, 4, 2],
  [3, 4], // <- "right" is now in a done state, so it will not appear in future layers
  [5, 4],
  [5, 6],
  [5, 7],
  [8, 7], // <- "middle" is now in a done state, so it will not appear in a future layer
  [8],
  [9] // <- "left" is now in a done state, along with all other iterables, meaning the merge is complete
];
```

In the example the iterables can only return their value if the previous value has been returned

A consumer of this merge can skip ahead in layers if it wants to see whats next, each layer is separated from the next as it is possible
for a consumer to cache these values in its own way, which gives better observability as to whats happening within

We need to be able to document the generation behaviour in code, this will give us a solid foundation to reference
when developing this behaviour

Here is what I used to produce a consistent sequence:

```ts
import { asyncExtendedIterable } from "iterable";

function producers(): AsyncIterable<number>[] {
  const left = [1, 3, 5, 8, 9];
  const middle = [4, 6, 7];
  const right = [0, 2];
  const sequences = [left, middle, right];
  const source = asyncExtendedIterable(left.concat(middle).concat(right).sort((a, b) => a < b ? -1 : 1));
  return sequences.map(sequence => source.filter(value => sequence.includes(value)).toIterable());
}
```




