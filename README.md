# Progressive Merge

Aim is to merge a growing list of values that can be loading in parallel with different resolution times

The `merge` function exported from this module accepts an [`AsyncIterable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/asyncIterator)
which produces zero or more `AsyncIterable` instances that produce the values we want to see in our merge

The merging `AsyncIterable` will produce a new iteration each time it has a new layer to be consumed

Each layer will contain for each `AsyncIterable` found, in the order they were found:

- The value given as the second argument to `merge`, representing an empty state, this means we haven't yet seen a value yet for this iterable
- An [`IteratorResult`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#The_iterator_protocol) for that iterable

As an initial example we can have two `AsyncIterable` instances that produce a single value each:

```js
import { asyncIterable, asyncExtendedIterable } from "iterable";
import { merge } from "@opennetwork/progressive-merge";

const left = asyncIterable([1]);
const right = asyncIterable([2]);

const producers = asyncIterable([left, right]);

log(merge(producers, undefined)).catch(console.error);

function log(merged) {
  return asyncExtendedIterable(merged)
    .map(layer => asyncExtendedIterable(layer).toArray())
    .toArray()
    .then(result => console.log(JSON.stringify(result, undefined, "  ")));
}
```

This will produce the output:

```json
[
  [
    {
      "value": 1,
      "done": false
    },
    {
      "value": 2,
      "done": false
    }
  ],
  [
    {
      "done": true
    },
    {
      "value": 2,
      "done": false
    }
  ],
  [
    {
      "done": true
    },
    {
      "done": true
    }
  ]
]
```

This gives us the information required to be able to reconstruct what each layer looks like.

Each use case is different, so the merge only provides what's needing to be known. Some use cases
may retain previously seen values for that iterables index, or it may ignore the value at that index for future iterations

The goal of this merge is not to _do_ the merge, but to give you information about the state of the merge

## Laziness 

The merge is operating in a lazy manner, if the external iterables aren't utilised, then no processing will be done internally,
this means we may have pending state waiting for the next iteration.

Internally a set of promises are held for each known iterable, including the primary iterable that was provided.

These promises may produce an error, which can result in all other promises being forgotten about, which can result in an 
uncaught error. Because of this the consumer of `merge` can pass a third argument with a callback that will be invoked
with each promise that is utilised within the `merge` function, this allows the consumer to settle these promises as they
see fit.


