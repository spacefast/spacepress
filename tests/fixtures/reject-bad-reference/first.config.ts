import { collection, text, integer, defineConfig, table } from "first";
const a = table({ name: text().optional() });
const b = table({ aName: integer().references(() => a.name).optional() });
export default defineConfig({ tables: { a, b } });
