import { collection, text, defineConfig, table } from "first";
const a = table({ code: text().unique().optional() });
export default defineConfig({ tables: { a } });
