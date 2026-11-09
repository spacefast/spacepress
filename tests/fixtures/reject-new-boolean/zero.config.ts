import { action, defineConfig } from "zero";

// `new Boolean(false)` is a wrapper object, and every object is truthy; Zero has primitives only.
export default defineConfig({
  actions: {
    wrap: action({ input: {}, handler: () => (new Boolean(false) ? "yes" : "no") }),
  },
});
