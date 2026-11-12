import { boolean, collection, defineConfig, text, table } from "first";
const notes = table({ active: boolean().optional(), x: text().showIf({ active: { in: [null, true] } }).optional() });
export default defineConfig({ tables: { notes } });
