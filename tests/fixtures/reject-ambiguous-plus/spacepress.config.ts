import { collection, json, defineConfig, table } from "spacepress";
export const a = table({ meta: json().optional() }).on({ afterCreate(row) { const x = row.id + row.meta; } });
export default defineConfig({});
