// Minimal "zero" for running a config's pure actions under Node.
// Builders return inert objects; only `action` and `defineConfig` matter here.
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
export const collection = (name, cols) => ({ name, cols });
export const id = chain, integer = chain, real = chain, text = chain, boolean = chain;
export const date = chain, timestamp = chain, json = chain;
export const defineRelations = () => ({});
export const defineConfig = (c) => c;
export const action = (a) => a;
export const db = new Proxy({}, { get() { throw new Error("db isn't available in differential tests"); } });
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
