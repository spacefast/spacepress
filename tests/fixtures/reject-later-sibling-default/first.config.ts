import { action, defineConfig } from "first";

function pick({ b = a, a }: { a: number; b?: number }): number {
  return a + b;
}

export default defineConfig({
  actions: {
    sum: action({ access: "anyone", handler: () => pick({ a: 2 }) }),
  },
});
