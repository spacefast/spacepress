import { collection, id, text, defineConfig, table } from "zero";
const notes = table({ id: id(), kind: text(), label: text().showIf({ kind: { in: [() => true] } }) });
export default defineConfig({ tables: { notes } });
