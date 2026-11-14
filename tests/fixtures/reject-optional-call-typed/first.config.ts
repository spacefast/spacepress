import { action, defineConfig } from "first";

// Optional calls compile in imported JavaScript only; typed code checks the function first.
const choose = (f: (() => number) | undefined) => f?.() ?? 0;

export const pick = action({ input: {}, handler: () => ({ v: choose(undefined) }) });

export default defineConfig({});
