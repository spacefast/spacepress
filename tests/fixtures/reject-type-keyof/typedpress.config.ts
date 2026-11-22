import { defineConfig, mutation } from "typedpress";
type Keys = keyof { id: number; title: string };
export const example = mutation({}, () => { const key: Keys = "other"; return key; });

export default defineConfig({});
