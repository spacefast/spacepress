import { action, defineConfig } from "first";
// `g` captures `f` and runs before `f` is assigned: Node throws a ReferenceError.
export const probe = action({ handler: () => { const f = (() => { const g = () => f; g(); return () => 1; })(); return f(); } });

export default defineConfig({});
