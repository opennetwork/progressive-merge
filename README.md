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
  [1, 4, 0], // <- It appears we jumped the queue, but this is back filling to be complete that layer, the next layer can start loading in parallel
  [undefined, undefined, 2],
  [3, undefined, 2],
  [3, 6, 2], // <- "right" is now in a done state, so it will not appear in future layers
  [5, undefined],
  [5, 7], // <- "middle" is now in a done state, so it will not appear in a future layer
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
import { source } from "iterable";

async function producers(): [AsyncIterable<number>, AsyncIterable<number>, AsyncIterable<number>] {
    const left = [1, 3, 5, 8, 9];
    const middle = [4, 6, 7];
    const right = [0, 2];
    const allNumbersSorted = left.concat(middle).concat(right).sort();
    const numberPromises = 
    const sequence = [left, middle, right];
    const targets = sources.map(numbers => {
      const target = source();
      target.hold();
      return target;
    });
    
    
    
    
    
}
```




