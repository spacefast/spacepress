import { action, defineConfig } from "zero";

// Only `__proto__: null` is supported; an object value would install a prototype.
const defaults = { __proto__: { kind: "default" }, name: "x" };

export default defineConfig({
  actions: {
    read: action({ input: {}, handler: () => defaults.name }),
  },
});
