import { defineConfig, mutation } from "spacepress";

// Optional calls compile in imported JavaScript only; typed code checks the function first.
const choose = (f: (() => number) | undefined) => f?.() ?? 0;

export const pick = mutation({}, () => ({ v: choose(undefined) }));

export default defineConfig({});
