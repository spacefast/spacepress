import { collection, id, defineConfig, table } from "first";
let i = 0; while (true) { i++; }
export default defineConfig({ tables: { a: table({ id: id() }) } });
