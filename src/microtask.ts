
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
export const RESET_QUEUE = Symbol("Reset Queue");

export function shiftingQueueMicrotask(macrotaskLimit = 5): QueueMicrotask {
  let thisMacrotask = 0;
  const queue: QueueMicrotask & {
    [NEW_QUEUE]?: unknown,
    [RESET_QUEUE]?: unknown
  } = (fn) => {
    if (thisMacrotask >= macrotaskLimit) {
      setImmediate(fn);
    } else {
      thisMacrotask += 1;
      queueMicrotask(fn);
    }
  };
  queue[RESET_QUEUE] = () => {
    thisMacrotask = 0;
  };
  queue[NEW_QUEUE] = shiftingQueueMicrotask.bind(undefined, macrotaskLimit);
  return queue;
}

export function resetQueueIfExists(queue: QueueMicrotask): void {
  if (isResetQueueFn(queue)) {
    queue[RESET_QUEUE]();
  }
  function isResetQueueFn(queue: QueueMicrotask): queue is QueueMicrotask & { [RESET_QUEUE](): QueueMicrotask } {
    function isResetQueueFnLike(queue: unknown): queue is { [RESET_QUEUE]: unknown } {
      return !!queue;
    }
    return (
      isResetQueueFnLike(queue) &&
      typeof queue[RESET_QUEUE] === "function"
    );
  }
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
