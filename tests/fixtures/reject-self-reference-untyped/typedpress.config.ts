import { defineConfig, mutation } from "typedpress";
// The recursive call needs the arrow's type before its body is compiled.
export const probe = mutation({}, () => { const fact = (n: number) => (n <= 1 ? 1 : n * fact(n - 1)); return fact(5); });

export default defineConfig({});
