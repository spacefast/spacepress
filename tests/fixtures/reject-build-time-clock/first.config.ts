import { collection, id, defineConfig, table } from "first";
const v = Date.now();
export default defineConfig({ tables: { a: table({ id: id() }) } });
