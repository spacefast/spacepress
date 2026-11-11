import { action, defineConfig } from "first";
// A `let` may be reassigned before the closure runs, so its self-call sees the declared type, which allows null.
export default defineConfig({
  actions: { probe: action({ handler: () => { let f: ((n: number) => number) | null = (n: number): number => (n <= 0 ? 0 : f(n - 1)); return f(3); } }) },
});
