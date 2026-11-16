import { action, defineConfig } from "typedpress";

// `new Boolean(false)` is a wrapper object, and every object is truthy; TypedPress has primitives only.
export const wrap = action({ input: {}, handler: () => (new Boolean(false) ? "yes" : "no") });

export default defineConfig({});
