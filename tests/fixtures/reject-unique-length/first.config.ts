import { collection, text, defineConfig, table } from "first";
export const a = table({ code: text().unique().optional() });
export default defineConfig({});
