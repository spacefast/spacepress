import { action, defineConfig } from "first";

// Only the literal `__proto__: null` is supported; a variable may hold any prototype.
const base = { kind: "default" };
const derived = { __proto__: base, name: "x" };

export const read = action({ input: {}, handler: () => derived.name });

export default defineConfig({});
