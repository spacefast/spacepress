import { collection, text, defineConfig, table } from "spacepress";
export const a = table({ note: text().optional() }).on({ afterCreate(row) { const n = row.note.length; } });
export default defineConfig({});
