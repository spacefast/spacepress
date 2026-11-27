import { defineConfig, table, f } from "spacepress";
export const a = table({ mood: f.select(["calm", "busy"]).searchable() });
export default defineConfig({});
