import { merge } from "../merge";

async function* generatorOne() {
  let remaining = 10;
  while (remaining >= 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    yield remaining;
    remaining -= 1;
  }
}

async function* generatorTwo() {
  let remaining = 10;
  while (remaining <= 20) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    yield remaining;
    remaining += 1;
  }
}

async function run() {
  const one = generatorOne();
  const two = generatorTwo();
  for await (const result of merge([
    one,
    one,
    two,
    one,
    one,
    one,
    two
  ], { reuseInFlight: true })) {
    console.log(result.join(","));
  }
}

run().catch(console.error);
