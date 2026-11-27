import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ kind: f.text().optional(), x: f.text().showIf({ kind: { in: [] } }).optional() });
export default defineConfig({});
