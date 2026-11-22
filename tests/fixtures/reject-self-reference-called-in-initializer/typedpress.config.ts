import { defineConfig, mutation } from "typedpress";
// `g` captures `f` and runs before `f` is assigned: Node throws a ReferenceError.
export const probe = mutation({}, () => { const f = (() => { const g = () => f; g(); return () => 1; })(); return f(); });

export default defineConfig({});
