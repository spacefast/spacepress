import { table, text, defineConfig } from "first";
const stockItems = table({ title: text() }, { editor: false });
export default defineConfig({ tables: { stockItems } });
