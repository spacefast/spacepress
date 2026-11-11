import { collection, id, defineConfig, table } from "first";
let count = 0;
const a = table({ id: id() });
export default defineConfig({ tables: { a }, hooks: { a: { afterCreate(row) { count = count + 1; } } } });
