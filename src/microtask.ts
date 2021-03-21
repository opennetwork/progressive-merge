
export function defaultQueueMicrotask(fn: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(fn);
  } else if (typeof setImmediate === "function") {
    setImmediate(fn);
  } else {
    setTimeout(fn, 0);
  }
}

export interface QueueMicrotask {
  (callback: () => void): void;
}

export const NEW_QUEUE = Symbol("New Queue");

export function shiftingQueueMicrotask(macrotaskLimit = 5): QueueMicrotask {
  let thisMacrotask = 0;
  const queue: QueueMicrotask & { [NEW_QUEUE]?: unknown } = (fn) => {
    if (thisMacrotask >= macrotaskLimit) {
      const initial = macrotaskLimit;
      setImmediate(() => {
        // Only reset it once, we may have a few callbacks at once.
        if (macrotaskLimit === initial) {
          macrotaskLimit = 0;
        }
        fn();
      });
    } else {
      thisMacrotask += 1;
      queueMicrotask(fn);
    }
  };
  queue[NEW_QUEUE] = shiftingQueueMicrotask.bind(undefined, macrotaskLimit);
  return queue;
}

export function newQueueIfExists(queue: QueueMicrotask): QueueMicrotask {
  return isNewQueueFn(queue) ? queue[NEW_QUEUE]() : queue;

  function isNewQueueFn(queue: QueueMicrotask): queue is QueueMicrotask & { [NEW_QUEUE](): QueueMicrotask } {
    function isNewQueueFnLike(queue: unknown): queue is { [NEW_QUEUE]: unknown } {
      return !!queue;
    }
    return (
      isNewQueueFnLike(queue) &&
      typeof queue[NEW_QUEUE] === "function"
    );
  }
}
