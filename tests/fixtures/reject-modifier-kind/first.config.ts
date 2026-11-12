import { collection, boolean, defineConfig, table } from "first";
const a = table({ done: boolean().max(3).optional() });
export default defineConfig({ tables: { a } });
