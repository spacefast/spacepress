import { defineConfig, mutation } from "spacepress";
type Keys = keyof Record<string, number>;
export const example = mutation({}, () => { const key: Keys = "anything"; return key; });

export default defineConfig({});
