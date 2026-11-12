import { collection, text, defineConfig, table } from "first";
const notes = table({ kind: text().optional(), label: text().showIf({ kind: { in: [() => true] } }).optional() });
export default defineConfig({ tables: { notes } });
