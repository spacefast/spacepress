import { collection, id, text, global, defineConfig, table } from "first";
const a = table({ id: id() });
const site = global("site", { title: text().notNull() });
export default defineConfig({ tables: { a }, globals: { site } });
