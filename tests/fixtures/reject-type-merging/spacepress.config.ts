import { defineConfig, mutation } from "spacepress";
interface Entry { id: number }
interface Entry { title: string }
export const example = mutation({}, () => { const value: Entry = { id: 1, title: "Hello" }; return value; });

export default defineConfig({});
