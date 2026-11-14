// `value instanceof RegExp` (and Map, Set, WeakMap, WeakSet, Date, URL, URLSearchParams,
// AbortController, AbortSignal) in imported JavaScript, which picomatch and files-sdk branch on.
// Every action runs under Node and as compiled PHP; the JSON results must be byte-identical.
import { action, defineConfig } from "first";
import { instances } from "./builtin-instanceof-helpers.mjs";

export default defineConfig({
  name: "language-builtin-instanceof",
  actions: {
    instances: action({ input: {}, handler: () => instances() }),
  },
});
