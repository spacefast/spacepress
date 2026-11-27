import { defineConfig, table, f } from "spacepress";
export const a = table({ note: f.text().optional() }).on({ afterCreate({ row }) { const n = row.note.length; } });
export default defineConfig({});
