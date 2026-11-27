import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ kind: f.text().optional(), label: f.text().showIf({ kind: { in: [() => true] } }).optional() });
export default defineConfig({});
