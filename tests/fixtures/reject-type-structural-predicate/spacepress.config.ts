import { defineConfig, mutation } from "spacepress";
type Check<T> = T extends { length: number } ? "sized" : "other";
export const example = mutation({}, () => { const value: Check<string> = "sized"; return value; });

export default defineConfig({});
