import { asyncIterable, source } from "iterable";
import { ok } from "assert";
import { merge } from "./merge";

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


async function run() {

  let currentValue = -1;

  const sources = [
    left,
    middle,
    right
  ];
  const targets = [
    source<number>(),
    source<number>(),
    source<number>()
  ];

  targets.forEach(target => target.hold());

  let layers = 0;

  type Layer = (IteratorResult<number> | undefined)[];

  const layerValues: Layer[] = [];

  for await (const layer of merge(asyncIterable(targets), undefined, () => pushNext([]))) {
    layers += 1;
    const currentLayer: Layer = [];
    for await (const value of layer) {
      currentLayer.push(value);
      pushNext(currentLayer);
    }
    layerValues.push(currentLayer);
    if (layerValues.length >= 3) {
      pushNext(currentLayer);
    }
  }

  console.log(JSON.stringify(layerValues));

  function pushNext(currentLayer: Layer) {
    const nextValue = currentValue + 1;
    if (!currentLayer.length && currentValue > -1) {
      return;
    }
    const includesNext = currentLayer.find(value => value && value.value === (nextValue - 1));
    if (currentLayer.length && !includesNext) {
      return;
    }
    const sourceIndex = sources.findIndex(source => source.includes(nextValue));
    if (sourceIndex === -1) {
      targets.forEach(target => target.close());
      return;
    }
    const source = sources[sourceIndex];
    ok(source[0] === nextValue);
    source.splice(0, 1);
    const target = targets[sourceIndex];
    currentValue = nextValue;
    target.push(nextValue);
    // console.log(source.length, target);
    if (source.length === 0) {
      target.close();
    }
  }

}

run()
  .then(() => console.log("Complete"))
  .catch(console.error);
