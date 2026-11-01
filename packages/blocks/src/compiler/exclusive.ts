import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One critical section for the whole process, re-entrant along the async
 * call chain of the section that currently holds it.
 *
 * The serializer puts happy-dom's globals on `globalThis` while it works, and
 * an authored module must never run while they are there: a file that reads
 * `typeof document` would otherwise compile differently depending on which
 * other compile happened to be in flight. Module execution and DOM
 * installation both take this section, so they never overlap. A call made
 * from inside the section (a nested `withBlockApi`, a `serializeBlocks` in a
 * test's `withBlockApi` callback) runs directly rather than deadlocking.
 *
 * Re-entry is decided by ownership, not by inherited context: each section
 * gets a fresh token, and only work whose context still carries the token of
 * the section that currently holds the lock runs directly. A callback that
 * outlived its section (a promise it created and left behind) carries a stale
 * token and queues like any outsider. The holder also waits for every direct
 * re-entrant call it started before it releases, so nothing it began can run
 * on after the lock has passed to someone else.
 */
interface Holder {
  readonly token: object;
  /** Re-entrant work started inside this section and still running. */
  readonly pending: Set<Promise<unknown>>;
}

const context = new AsyncLocalStorage<object>();
let holder: Holder | null = null;
let tail: Promise<void> = Promise.resolve();

export function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const current = holder;
  if (current !== null && context.getStore() === current.token) {
    const nested = work();
    current.pending.add(nested);
    void nested.finally(() => current.pending.delete(nested)).catch(() => {});
    return nested;
  }
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(async () => {
    const mine: Holder = { token: {}, pending: new Set() };
    holder = mine;
    try {
      return await context.run(mine.token, work);
    } finally {
      // Every direct re-entrant call this section started finishes before the lock passes on.
      while (mine.pending.size > 0) await Promise.allSettled([...mine.pending]);
      holder = null;
      release();
    }
  });
}
