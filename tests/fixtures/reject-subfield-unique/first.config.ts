import { collection, text, group, defineConfig, table } from "first";
export const a = table({ meta: group({ code: text().unique().optional() }).optional() });
export default defineConfig({});
