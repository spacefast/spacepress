import { collection, defineConfig, table, f } from "spacepress";
export const a = table({ meta: f.group({ code: f.text().unique().optional() }).optional() });
export default defineConfig({});
