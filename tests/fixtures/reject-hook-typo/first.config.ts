import { collection, id, text, defineConfig, table } from "first";
const a = table({ id: id(), name: text().notNull() });
export default defineConfig({ tables: { a }, hooks: { a: { beforeCreat(d) {} } } });
