import { defineConfig, mutation } from "typedpress";
type Keys = keyof Record<string, number>;
export const example = mutation({}, () => { const key: Keys = "anything"; return key; });

export default defineConfig({});
