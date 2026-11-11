// Minimal "first" for running a config's pure functions under Node.
// Builders record only what the differential test calls: `.validate(fn)` and `.access({...})`
// closures and collection `access` functions. Everything else is inert.
const chain = (meta = {}) =>
  new Proxy(function () {}, {
    get: (_, k) => (k === "$meta" ? meta : (...args) => chain(k === "validate" || k === "access" ? { ...meta, [k]: args[0] } : meta)),
    apply: () => chain(meta),
  });
const builder = () => chain();
export const collection = (cols, options = {}) => ({ cols, options });
export const table = (cols, options = {}) => ({ cols, options });
export const userProjection = (cols, options = {}) => ({ cols, options });
export const global = (name, fields, options = {}) => ({ name, fields, options });
export const id = builder, integer = builder, real = builder, text = builder, boolean = builder;
export const date = builder, timestamp = builder, json = builder, email = builder, url = builder;
export const slug = builder, richText = builder, media = builder, select = builder;
export const group = ({ fields }) => chain({ kind: "group", fields });
export const repeater = ({ fields }) => chain({ kind: "repeater", fields });
export const blocks = ({ layouts }) => chain({ kind: "blocks", layouts });
export const defineRelations = () => ({});
export const defineConfig = (c) => c;
export const action = (a) => a;
export const job = (j) => j;
// Lane D: once() receipts and pending enqueue keys, in memory for one Node run.
const receipts = new Map();
let rollbackOnly = false;
export const transaction = async (fn) => {
  const previousReceipts = new Map(receipts), previousPending = new Map(pending);
  rollbackOnly = false;
  try {
    const result = await fn();
    if (rollbackOnly) throw new Error("Internal server error");
    return result;
  } catch (error) {
    receipts.clear();
    pending.clear();
    for (const [key, value] of previousReceipts) receipts.set(key, value);
    for (const [key, value] of previousPending) pending.set(key, value);
    throw error;
  } finally {
    rollbackOnly = false;
  }
};
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
export const db = new Proxy({}, { get() { throw new Error("db isn't available in differential tests"); } });
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
