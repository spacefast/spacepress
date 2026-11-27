// Minimal "first" for running a config's pure functions under Node.
// Builders record only what the differential test calls: `.validate(fn)` and `.access({...})`
// closures and collection `access` functions. Everything else is inert.
const chain = (meta = {}) =>
  new Proxy(function () {}, {
    get: (_, k) => (k === "$meta" ? meta : (...args) => chain(k === "validate" || k === "access" ? { ...meta, [k]: args[0] } : meta)),
    apply: () => chain(meta),
  });
const builder = () => chain();
// Each registered value carries `$first`, so run-node.mjs finds a config's kinds and actions
// among its exports, as the compiler registers them (docs/spec/spec.md §1.1).
const kind = (cols, options = {}) => ({ $first: "kind", cols, options, on() { return this; } });
export const collection = kind, table = kind, extend = (_target, options = {}) => kind(options.fields ?? {}, options);
export const global = (fields, options = {}) => ({ $first: "global", fields, options });
export const f = {
  integer: builder,
  number: builder,
  text: builder,
  boolean: builder,
  date: builder,
  timestamp: builder,
  json: builder,
  email: builder,
  url: builder,
  slug: builder,
  richText: builder,
  media: builder,
  file: builder,
  select: builder,
  ref: builder,
  terms: builder,
  group: (fields) => chain({ kind: "group", fields }),
  repeater: (fields) => chain({ kind: "repeater", fields }),
  blocks: (layouts) => chain({ kind: "blocks", layouts }),
};
export const defineConfig = (c) => c;
// Lane D: once() receipts and pending enqueue keys, in memory for one Node run.
const receipts = new Map();
let rollbackOnly = false;
export const once = async (key, fn) => {
  try {
    if (receipts.has(key)) return structuredClone(receipts.get(key));
    const result = (await fn()) ?? null;
    receipts.set(key, structuredClone(result));
    return result;
  } catch (error) {
    rollbackOnly = true;
    throw error;
  }
};
// A query or mutation keeps its handler; a job is queued through its own export.
const fn = (options, handler) => Object.assign((input) => handler({ user: null, once }, input), { ...options, handler, $first: "action" });
export const query = fn, mutation = fn;
const pending = new Map();
export const job = (options, handler) => {
  const value = { ...options, handler, $first: "job" };
  value.enqueue = async (input, opts = {}) => {
    const id = crypto.randomUUID();
    if (opts.key === undefined) return { id };
    if (!pending.has(value)) pending.set(value, new Map());
    const keys = pending.get(value);
    if (!keys.has(opts.key)) keys.set(opts.key, id);
    return { id: keys.get(opts.key) };
  };
  return value;
};
export const cron = (schedule, handler) => ({ schedule, handler, $first: "job" });
export const transaction = async (fn) => {
  const previousReceipts = new Map(receipts);
  const previousPending = new Map([...pending].map(([job, keys]) => [job, new Map(keys)]));
  rollbackOnly = false;
  try {
    const result = await fn();
    if (rollbackOnly) throw new Error("Internal server error");
    return result;
  } catch (error) {
    receipts.clear();
    pending.clear();
    for (const [key, value] of previousReceipts) receipts.set(key, value);
    for (const [job, keys] of previousPending) pending.set(job, keys);
    throw error;
  } finally {
    rollbackOnly = false;
  }
};
export const db = new Proxy({}, { get() { throw new Error("db isn't available in differential tests"); } });
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
