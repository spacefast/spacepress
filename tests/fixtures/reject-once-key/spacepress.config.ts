import { defineConfig, table, mutation, f } from "spacepress";
export const notes = table({ x: f.text().optional() });
export const bad = mutation({}, async ({ once }) => await once(42, () => true));

export default defineConfig({});
