import { defineConfig, mutation } from "typedpress";

// `new Boolean(false)` is a wrapper object, and every object is truthy; TypedPress has primitives only.
export const wrap = mutation({}, () => (new Boolean(false) ? "yes" : "no"));

export default defineConfig({});
