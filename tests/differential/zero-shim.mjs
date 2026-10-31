// Minimal "zero" for running a config's pure functions under Node.
// Builders record only what the differential test calls: `.validate(fn)` and `.access({...})`
// closures and collection `access` functions. Everything else is inert.
const chain = (meta = {}) =>
  new Proxy(function () {}, {
    get: (_, k) => (k === "$meta" ? meta : (...args) => chain(k === "validate" || k === "access" ? { ...meta, [k]: args[0] } : meta)),
    apply: () => chain(meta),
  });
const builder = () => chain();
export const collection = (name, cols, options = {}) => ({ name, cols, options });
export const global = (name, fields, options = {}) => ({ name, fields, options });
export const id = builder, integer = builder, real = builder, text = builder, boolean = builder;
export const date = builder, timestamp = builder, json = builder, email = builder, url = builder;
export const slug = builder, richText = builder, media = builder, select = builder;
export const group = builder, repeater = builder, blocks = builder;
export const defineRelations = () => ({});
export const defineConfig = (c) => c;
export const action = (a) => a;
export const job = (j) => j;
// Lane D: once() receipts and pending enqueue keys, in memory for one Node run.
const receipts = new Map();
export const once = async (key, fn) => {
  if (!receipts.has(key)) receipts.set(key, (await fn()) ?? null);
  return receipts.get(key);
};
const pending = new Map();
export const jobs = new Proxy({}, {
  get: (_, name) => ({
    enqueue: async (input, opts = {}) => {
      const id = crypto.randomUUID();
      if (opts.key === undefined) return { id };
      if (!pending.has(`${name}:${opts.key}`)) pending.set(`${name}:${opts.key}`, id);
      return { id: pending.get(`${name}:${opts.key}`) };
    },
  }),
});
export const env = (name) => process.env[name] ?? null;
export const db = new Proxy({}, { get() { throw new Error("db isn't available in differential tests"); } });
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
