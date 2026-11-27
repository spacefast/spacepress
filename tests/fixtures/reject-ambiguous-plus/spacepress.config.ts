import { defineConfig, table, f } from "spacepress";
export const a = table({ meta: f.json().optional() }).on({ afterCreate({ row }) { const x = row.id + row.meta; } });
export default defineConfig({});
