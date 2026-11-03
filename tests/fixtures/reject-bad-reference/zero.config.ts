import { collection, id, text, integer, defineConfig, table } from "zero";
const a = table({ id: id(), name: text() });
const b = table({ id: id(), aName: integer().references(() => a.name) });
export default defineConfig({ tables: { a, b } });
