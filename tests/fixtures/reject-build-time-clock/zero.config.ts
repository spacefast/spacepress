import { collection, id, defineConfig, table } from "zero";
const v = Date.now();
export default defineConfig({ tables: { a: table({ id: id() }) } });
