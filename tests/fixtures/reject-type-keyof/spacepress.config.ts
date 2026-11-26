import { defineConfig, mutation } from "spacepress";
type Keys = keyof { id: number; title: string };
export const example = mutation({}, () => { const key: Keys = "other"; return key; });

export default defineConfig({});
