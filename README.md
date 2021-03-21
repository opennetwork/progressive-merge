# Progressive Merge

Take a set of async iterations and turn them into an array of the latest values for that iterator. 

This is the general function signature to achieve this:

```typescript
export async function *merge<T>(iterables: AsyncIterable<AsyncIterable<T>>): AsyncIterable<ReadonlyArray<T | undefined>> {
```

This allows us to take multiple functions producing values and group an update set together.

```typescript
import { merge } from "@opennetwork/progressive-merge";

for await (const set of merge([[1, 2, 3, 4], [5, 6, 7, 8, 9]])) {
    console.log(set);
}
```

The above logs:

```
[ 1, 5 ]
[ 2, 6 ]
[ 3, 7 ]
[ 4, 8 ]
[ 4, 9 ]
```


