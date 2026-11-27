import { defineConfig, table, f } from "spacepress";
export const notes = table({ tags: f.json().$type<string[]>() });
export default defineConfig({});
