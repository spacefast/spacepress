import { defineConfig, table, f } from "spacepress";
export const notes = table({ kind: f.text({ enum: ["a", "b"] }) });
export default defineConfig({});
