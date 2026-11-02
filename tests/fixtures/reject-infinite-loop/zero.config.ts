import { collection, id, defineConfig, table } from "zero";
let i = 0; while (true) { i++; }
export default defineConfig({ tables: { a: table({ id: id() }) } });
