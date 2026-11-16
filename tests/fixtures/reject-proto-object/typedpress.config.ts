import { action, defineConfig } from "typedpress";

// Only `__proto__: null` is supported; an object value would install a prototype.
const defaults = { __proto__: { kind: "default" }, name: "x" };

export const read = action({ input: {}, handler: () => defaults.name });

export default defineConfig({});
