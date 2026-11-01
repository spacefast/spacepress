import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One critical section for the whole process, re-entrant along the async
 * call chain.
 *
 * The serializer puts happy-dom's globals on `globalThis` while it works, and
 * an authored module must never run while they are there: a file that reads
 * `typeof document` would otherwise compile differently depending on which
 * other compile happened to be in flight. Module execution and DOM
 * installation both take this section, so they never overlap. A call made
 * from inside the section (a nested `withBlockApi`, a `serializeBlocks` in a
 * test's `withBlockApi` callback) runs directly rather than deadlocking.
 */
const inside = new AsyncLocalStorage<true>();
let tail: Promise<void> = Promise.resolve();

export function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (inside.getStore() === true) return work();
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(() => inside.run(true, work)).finally(release);
}
