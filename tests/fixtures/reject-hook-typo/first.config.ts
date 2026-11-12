import { collection, text, defineConfig, table } from "first";
const a = table({ name: text() });
export default defineConfig({ tables: { a }, hooks: { a: { beforeCreat(d) {} } } });
