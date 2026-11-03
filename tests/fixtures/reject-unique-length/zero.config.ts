import { collection, id, text, defineConfig, table } from "zero";
const a = table({ id: id(), code: text().unique() });
export default defineConfig({ tables: { a } });
