import { defineConfig, mutation } from "typedpress";

function pick({ b = a, a }: { a: number; b?: number }): number {
  return a + b;
}

export const sum = mutation({ access: "anyone" }, () => pick({ a: 2 }));

export default defineConfig({});
