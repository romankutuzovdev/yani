import { AsyncLocalStorage } from "async_hooks";

type QueueState = {
  tail: Promise<void>;
  /** Last reserved start slot, in milliseconds. */
  lastSlot: number;
};

const storage = new AsyncLocalStorage<true>();

const globalQueue = globalThis as unknown as { __yaniMilliQueue?: QueueState };

function state(): QueueState {
  if (!globalQueue.__yaniMilliQueue) {
    globalQueue.__yaniMilliQueue = { tail: Promise.resolve(), lastSlot: 0 };
  }
  return globalQueue.__yaniMilliQueue;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run work one request at a time.
 * Calls that arrive in the same millisecond get the next free millisecond slot
 * and wait for earlier work to finish, so SQLite is not hit all at once.
 */
export function enqueueMilli<T>(task: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return task();

  const queue = state();
  const slot = Math.max(Date.now(), queue.lastSlot + 1);
  queue.lastSlot = slot;

  const scheduled = queue.tail.then(async () => {
    const wait = slot - Date.now();
    if (wait > 0) await delay(wait);
    return storage.run(true, task);
  });
  queue.tail = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}
