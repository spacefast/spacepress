import { collection, defineConfig, id, text, table } from "first";
const notes = table({ id: id(), kind: text(), x: text().showIf({ kind: { in: [] } }) });
export default defineConfig({ tables: { notes } });
