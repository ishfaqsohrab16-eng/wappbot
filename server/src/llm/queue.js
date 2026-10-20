import { QueueFullError, AbortedError } from "../util/errors.js";

/**
 * In-process concurrency limiter shared by web chat, WhatsApp bot and STT callers.
 * acquire() resolves to a release() function. Waiters can be cancelled via AbortSignal.
 */
export function createQueue({ concurrency, maxQueue, name = "queue" }) {
  let active = 0;
  const waiting = [];

  function next() {
    while (active < concurrency && waiting.length) {
      const w = waiting.shift();
      w.cleanup();
      active++;
      w.resolve(makeRelease());
    }
  }

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      next();
    };
  }

  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    if (active < concurrency) {
      active++;
      return Promise.resolve(makeRelease());
    }
    if (waiting.length >= maxQueue) return Promise.reject(new QueueFullError());
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = waiting.indexOf(w);
        if (i >= 0) waiting.splice(i, 1);
        reject(new AbortedError());
      };
      const w = {
        resolve,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(w);
    });
  }

  /** Run fn while holding a slot. */
  async function run(fn, signal) {
    const release = await acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    name,
    acquire,
    run,
    isFull: () => active >= concurrency && waiting.length >= maxQueue,
    stats: () => ({ active, waiting: waiting.length, concurrency, maxQueue }),
  };
}
