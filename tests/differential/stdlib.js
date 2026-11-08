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
