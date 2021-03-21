import { merge } from "../merge";
import { latest } from "../latest";

async function doTask(maxInterval = 1000) {
  // Do some task for given time
  const taskTime = Math.round(Math.random() * maxInterval);
  console.log({ taskTime, maxInterval });
  await new Promise(resolve => setTimeout(resolve, taskTime));
}

async function *doTasks(maxCount = 100, task: () => Promise<void>) {
  let tasksRemaining = 1 + Math.floor(Math.random() * maxCount);
  do {
    tasksRemaining -= 1;
    const start = Date.now();
    console.log("start task");
    await task();
    console.log("complete task");
    const complete = Date.now();
    const taskTime = complete - start;
    yield [tasksRemaining, taskTime];
  } while (tasksRemaining > 0);
}

async function *primary() {
  yield* doTasks(3, myPrimaryTask);

  async function myPrimaryTask() {
    await doTask(250);
  }
}

async function *secondary() {
  yield* doTasks(3, mySecondaryTask);

  async function mySecondaryTask() {
    await doTask(250);
  }
}

async function run() {
  for await (const slice of merge([primary(), secondary()], { queueMicrotask(fn: () => void) {
    setTimeout(fn, 500);
    }})) {
    console.log(slice);
  }
}

await run();
