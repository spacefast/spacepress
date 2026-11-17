import { defineConfig, mutation } from "typedpress";

// Only the literal `__proto__: null` is supported; a variable may hold any prototype.
const base = { kind: "default" };
const derived = { __proto__: base, name: "x" };

export const read = mutation({}, () => derived.name);

export default defineConfig({});
