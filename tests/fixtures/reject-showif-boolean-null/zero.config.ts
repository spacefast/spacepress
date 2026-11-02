import { boolean, collection, defineConfig, id, text, table } from "zero";
const notes = table({ id: id(), active: boolean(), x: text().showIf({ active: { in: [null, true] } }) });
export default defineConfig({ tables: { notes } });
