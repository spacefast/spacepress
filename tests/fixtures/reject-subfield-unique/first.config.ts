import { collection, text, group, defineConfig, table } from "first";
const a = table({ meta: group({ code: text().unique().optional() }).optional() });
export default defineConfig({ tables: { a } });
