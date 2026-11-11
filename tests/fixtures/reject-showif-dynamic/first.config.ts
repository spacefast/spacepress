import { collection, id, text, defineConfig, table } from "first";
const notes = table({ id: id(), kind: text(), label: text().showIf({ kind: { in: [() => true] } }) });
export default defineConfig({ tables: { notes } });
