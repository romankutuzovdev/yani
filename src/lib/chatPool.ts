/** Parallel chat/LLM pool sized for ~100 simultaneous visitors on one Node host. */

type Waiter<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

type PoolState = {
  active: number;
  queue: Waiter<unknown>[];
};

const globalPool = globalThis as unknown as { __yaniChatPool?: PoolState };

function state(): PoolState {
  if (!globalPool.__yaniChatPool) {
    globalPool.__yaniChatPool = { active: 0, queue: [] };
  }
  return globalPool.__yaniChatPool;
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** How many LLM chats run at once. Default 100 for shared single-process host. */
export function chatConcurrency() {
  return clamp(Number(process.env.CHAT_CONCURRENCY ?? 100), 1, 128);
}

/** Active + waiting cap before visitors see a busy message. */
export function chatQueueMax() {
  const max = chatConcurrency();
  return clamp(Number(process.env.CHAT_QUEUE_MAX ?? 250), max, 400);
}

export class ChatBusyError extends Error {
  constructor(
    message = "Сейчас много запросов. Подождите немного и попробуйте снова.",
  ) {
    super(message);
    this.name = "ChatBusyError";
  }
}

function pump() {
  const pool = state();
  const limit = chatConcurrency();
  while (pool.active < limit && pool.queue.length) {
    const next = pool.queue.shift();
    if (!next) break;
    pool.active += 1;
    void Promise.resolve()
      .then(() => next.task())
      .then(next.resolve, next.reject)
      .finally(() => {
        pool.active -= 1;
        pump();
      });
  }
}

/**
 * Run LLM/chat work with a parallel pool (~100 by default).
 * Extra requests wait in queue; only when full — ChatBusyError.
 */
export function runWithChatLimit<T>(task: () => Promise<T>): Promise<T> {
  const pool = state();
  if (pool.active + pool.queue.length >= chatQueueMax()) {
    return Promise.reject(new ChatBusyError());
  }
  return new Promise<T>((resolve, reject) => {
    pool.queue.push({
      task: task as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    pump();
  });
}
