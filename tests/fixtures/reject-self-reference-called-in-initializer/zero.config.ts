import { action, defineConfig } from "zero";
// `g` captures `f` and runs before `f` is assigned: Node throws a ReferenceError.
export default defineConfig({
  actions: { probe: action({ handler: () => { const f = (() => { const g = () => f; g(); return () => 1; })(); return f(); } }) },
});
