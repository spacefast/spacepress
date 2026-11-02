import { collection, id, boolean, defineConfig, table } from "zero";
const a = table({ id: id(), done: boolean().max(3) });
export default defineConfig({ tables: { a } });
