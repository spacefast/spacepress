import { collection, defineConfig, table, f } from "spacepress";
export const a = table({ code: f.text().unique().optional() });
export default defineConfig({});
