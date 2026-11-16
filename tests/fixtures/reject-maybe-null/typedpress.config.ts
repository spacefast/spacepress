import { collection, text, defineConfig, table } from "typedpress";
export const a = table({ note: text().optional() }).on({ afterCreate(row) { const n = row.note.length; } });
export default defineConfig({});
