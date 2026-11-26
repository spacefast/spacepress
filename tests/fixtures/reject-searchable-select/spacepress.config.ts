import { defineConfig, select, table } from "spacepress";
export const a = table({ mood: select(["calm", "busy"]).searchable() });
export default defineConfig({});
