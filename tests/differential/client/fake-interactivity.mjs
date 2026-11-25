// A small stand-in for @wordpress/interactivity, enough to drive a compiled store under Node:
// store() keeps the definition, getContext() returns the current element's context, and actions
// run the way the runtime runs them. A plain function returns its value at once. A generator
// returns a promise: it is stepped with each yielded promise awaited (a rejection is thrown into
// it), and every step runs in the scope the action was called in.
export const stores = new Map();
let current = null;
const configs = new Map();
const started = new Set();
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
function run(fn, args) {
  const scope = current;
  const result = fn(...args);
  if (!result || typeof result.next !== "function") return result;
  const step = (method, value) => {
    const previous = current;
    current = scope;
    try { return result[method](value); } finally { current = previous; }
  };
  const finished = (async () => {
    // Up to its first `yield`, a generator runs before the call returns.
    let at = step("next");
    while (!at.done) {
      let value;
      let failed = false;
      try { value = await at.value; } catch (error) { value = error; failed = true; }
      at = step(failed ? "throw" : "next", value);
    }
    return at.value;
  })();
  started.add(finished);
  const forget = () => { started.delete(finished); };
  finished.then(forget, forget);
  return finished;
}
/** Resolves once every action that was started, awaited or not, has finished. */
export async function settled() {
  while (started.size > 0) await Promise.allSettled([...started]);
}
/** Runs `fn` with `context` (and `ref`) as the current element. */
export async function within(context, fn, ref = null) {
  const previous = current;
  current = { context, ref };
  try { return await fn(); } finally { current = previous; }
}
