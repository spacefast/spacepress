// Plain JavaScript reached from cases.ts: checked dynamic dispatch for Map/Set,
// their iterators, and array-pattern destructuring through the iterator protocol.
export function jsCollections() {
  const store = new Map();
  const listeners = new Set();
  store.set("a/1", { n: 1 }).set("b/2", { n: 2 }).set("a/3", { n: 3 });
  listeners.add(store).add(store);
  const prefixed = [...store.entries()].filter(([key]) => key.startsWith("a/")).map(([key, value]) => key + value.n);
  const pairs = [];
  for (const [index, key] of ["p", "q"].entries()) pairs.push(index + key);
  const [first, ...others] = store.keys();
  const [only] = new Set(["x", "y"]);
  const deleted = [store.delete("a/1"), store.delete("a/1")];
  const visited = [];
  store.forEach((value, key, self) => { visited.push(`${key}:${value.n}:${self === store}`); });
  const it = store.values();
  const step = it.next();
  return [prefixed, pairs, first, others, only, deleted, visited, step.value.n, step.done, [...it].length, listeners.size, Array.from(store.keys(), (k, i) => i + k)];
}

// AbortController/AbortSignal: abort dispatches synchronously in registration order; once and
// removal; AbortSignal.any follows its first source; timers are cleared before the handler ends.
export function jsAbort() {
  const order = [];
  const c = new AbortController();
  const before = [c.signal.aborted, c.signal.reason === undefined];
  c.signal.addEventListener("abort", (event) => { order.push(`1:${event.type}:${event.target === c.signal}`); });
  c.signal.onabort = () => { order.push("on"); };
  c.signal.addEventListener("abort", () => { order.push(2); }, { once: true });
  const dup = () => { order.push(3); };
  c.signal.addEventListener("abort", dup);
  c.signal.addEventListener("abort", dup);
  c.signal.addEventListener("abort", () => { order.push(4); });
  c.signal.removeEventListener("abort", dup);
  const a = new AbortController();
  const b = new AbortController();
  const any = AbortSignal.any([a.signal, b.signal]);
  any.addEventListener("abort", () => { order.push(`any:${any.reason.message}`); });
  b.abort(new Error("from b"));
  a.abort(new Error("from a"));
  c.abort(new Error("stop"));
  c.abort(new Error("again"));
  let thrown = "none";
  try { c.signal.throwIfAborted(); } catch (e) { thrown = e.message; }
  const plain = new AbortController();
  plain.abort();
  const pre = AbortSignal.abort(new Error("pre"));
  const handle = setTimeout(() => { order.push("never"); }, 50);
  clearTimeout(handle);
  const timeout = AbortSignal.timeout(10);
  const feature = typeof AbortSignal.any === "function";
  return [before, order, c.signal.reason.message, thrown, plain.signal.reason.name, plain.signal.reason.message, pre.aborted, pre.reason.message, any.aborted, timeout.aborted, feature, typeof handle];
}

export function jsPendingTimer() {
  setTimeout(() => {}, 5);
  return "returned";
}
