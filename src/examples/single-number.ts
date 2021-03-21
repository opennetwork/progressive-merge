import { merge } from "../merge";

for await (const set of merge([[1, 2, 3, 4], [5, 6, 7, 8, 9]])) {
  console.log(set);
}
