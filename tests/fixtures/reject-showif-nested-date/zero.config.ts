import { collection, date, defineConfig, group, id, text } from "zero";
const notes = collection("notes", { id: id(), meta: group({ fields: { due: date(), x: text().showIf({ due: "2026-10-29" }) } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
