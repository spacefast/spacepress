import { defineConfig, table, f } from "spacepress";
export const notes = table({ tags: f.json<string[]>().$default(() => []) });
export default defineConfig({});
