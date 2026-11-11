import { action, defineConfig } from "first";

// `new Boolean(false)` is a wrapper object, and every object is truthy; First has primitives only.
export default defineConfig({
  actions: {
    wrap: action({ input: {}, handler: () => (new Boolean(false) ? "yes" : "no") }),
  },
});
