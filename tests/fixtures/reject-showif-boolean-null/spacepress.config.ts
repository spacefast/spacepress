import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ active: f.boolean().optional(), x: f.text().showIf({ active: { in: [null, true] } }).optional() });
export default defineConfig({});
