import { action, defineConfig } from "first";

// Destructured elements bind left to right, so a default may read an earlier sibling.
function pick({ a, b = a }: { a: number; b?: number }): number {
  return a + b;
}
function pair([a = 1, b = a]: number[]): number {
  return a + b;
}

export const sum = action({ access: "anyone", handler: () => pick({ a: 2 }) + pair([3]) });

export default defineConfig({});
