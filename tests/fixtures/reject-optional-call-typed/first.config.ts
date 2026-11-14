import { action, defineConfig } from "first";

// Optional calls compile in imported JavaScript only; typed code checks the function first.
const pick = (f: (() => number) | undefined) => f?.() ?? 0;

export default defineConfig({
  actions: {
    pick: action({ input: {}, handler: () => ({ v: pick(undefined) }) }),
  },
});
