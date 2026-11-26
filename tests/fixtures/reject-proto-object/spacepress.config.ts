import { defineConfig, mutation } from "spacepress";

// Only `__proto__: null` is supported; an object value would install a prototype.
const defaults = { __proto__: { kind: "default" }, name: "x" };

export const read = mutation({}, () => defaults.name);

export default defineConfig({});
