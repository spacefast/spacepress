import { collection, date, defineConfig, group, id, text, table } from "zero";
const notes = table({ id: id(), meta: group({ fields: { due: date(), x: text().showIf({ due: "2026-10-29" }) } }) });
export default defineConfig({ tables: { notes } });
