import { defineConfig, mutation } from "spacepress";

// `new Boolean(false)` is a wrapper object, and every object is truthy; SpacePress has primitives only.
export const wrap = mutation({}, () => (new Boolean(false) ? "yes" : "no"));

export default defineConfig({});
