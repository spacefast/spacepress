// A small stand-in for @wordpress/interactivity, enough to drive a compiled store under Node. It
// keeps the runtime's rules about scope (wp-includes/js/dist/script-modules/interactivity):
// `getContext()` and `getElement()` read the scope of the directive that is running and throw
// when there is none (a timer or listener callback, or code after an `await`); `withScope(fn)`
// binds `fn` to the current scope; and an action or callback read from the store is that function
// bound to the scope it is read in. A plain one returns its value, a generator returns a Promise,
// stepped with each yielded value awaited and the scope set around each step.
export const stores = new Map();
const scopes = [];
const configs = new Map();
const scope = (method) => {
  const current = scopes.at(-1);
  if (!current) throw new Error(`Cannot call \`${method}()\` when there is no scope.`);
  return current;
};
export function setConfig(ns, value) { configs.set(ns, value); }
export const getContext = () => scope("getContext").context;
export const getElement = () => ({ ref: scope("getElement").ref });
export const getConfig = (ns) => configs.get(ns) ?? {};
export const withSyncEvent = (fn) => { fn.sync = true; return fn; };
export function withScope(fn) {
  const captured = scopes.at(-1);
  if (fn?.constructor?.name === "GeneratorFunction") {
    return async (...args) => {
      const gen = fn(...args);
      let value;
      let error;
      while (true) {
        scopes.push(captured);
        let it;
        try {
          it = error ? gen.throw(error) : gen.next(value);
          error = undefined;
        } finally {
          scopes.pop();
        }
        try { value = await it.value; } catch (e) { error = e; }
        if (it.done) {
          if (error) throw error;
          return value;
        }
      }
    };
  }
  return (...args) => {
    scopes.push(captured);
    try { return fn(...args); } finally { scopes.pop(); }
  };
}
export function store(ns, def) {
  const bound = (fns) => new Proxy(fns, { get: (target, key) => (typeof target[key] === "function" ? withScope(target[key]) : target[key]) });
  const s = { state: def.state ?? {}, actions: bound(def.actions ?? {}), callbacks: bound(def.callbacks ?? {}) };
  stores.set(ns, s);
  return s;
}
/** Runs `fn` with `context` (and `ref`) as the running directive's scope, as an event does: the
 * scope is set while `fn` runs, not while what it returns is awaited. */
export async function within(context, fn, ref = null) {
  scopes.push({ context, ref });
  let result;
  try { result = fn(); } finally { scopes.pop(); }
  return await result;
}
