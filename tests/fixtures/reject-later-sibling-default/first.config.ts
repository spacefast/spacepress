import { action, defineConfig } from "first";

function pick({ b = a, a }: { a: number; b?: number }): number {
  return a + b;
}

export const sum = action({ access: "anyone", handler: () => pick({ a: 2 }) });

export default defineConfig({});
