import { collection, text, defineConfig, table } from "spacepress";
export const a = table({ code: text().unique().optional() });
export default defineConfig({});
