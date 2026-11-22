import { defineConfig, select, table } from "typedpress";
export const a = table({ mood: select(["calm", "busy"]).searchable() });
export default defineConfig({});
