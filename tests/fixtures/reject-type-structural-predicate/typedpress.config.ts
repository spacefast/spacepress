import { defineConfig, mutation } from "typedpress";
type Check<T> = T extends { length: number } ? "sized" : "other";
export const example = mutation({}, () => { const value: Check<string> = "sized"; return value; });

export default defineConfig({});
