import { collection, id, text, defineConfig, table } from "first";
const a = table({ id: id(), code: text().unique() });
export default defineConfig({ tables: { a } });
