import { collection, json, defineConfig, table } from "typedpress";
export const a = table({ meta: json().optional() }).on({ afterCreate(row) { const x = row.id + row.meta; } });
export default defineConfig({});
