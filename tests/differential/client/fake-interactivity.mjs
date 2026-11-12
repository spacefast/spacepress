// A small stand-in for @wordpress/interactivity, enough to drive a compiled store under Node:
// store() keeps the definition, getContext() returns the current element's context, and actions
// run the way the runtime runs them (generators stepped with each yielded promise awaited).
export const stores = new Map();
let current = null;
const configs = new Map();
export function setConfig(ns, value) { configs.set(ns, value); }
export function store(ns, def) {
  const state = def.state ?? {};
  const s = { state, actions: {}, callbacks: {} };
  for (const kind of ["actions", "callbacks"]) {
    for (const [name, fn] of Object.entries(def[kind] ?? {})) {
      s[kind][name] = (...args) => run(fn, args);
    }
  }
  stores.set(ns, s);
  return s;
}
export const getContext = () => current.context;
export const getElement = () => ({ ref: current.ref });
export const getConfig = (ns) => configs.get(ns) ?? {};
export const withSyncEvent = (fn) => fn;
async function run(fn, args) {
  const result = fn(...args);
  if (result && typeof result.next === "function") {
    let step = result.next();
    while (!step.done) step = result.next(await step.value);
    return step.value;
  }
  return result;
}
/** Runs `fn` with `context` (and `ref`) as the current element. */
export async function within(context, fn, ref = null) {
  const previous = current;
  current = { context, ref };
  try { return await fn(); } finally { current = previous; }
}
