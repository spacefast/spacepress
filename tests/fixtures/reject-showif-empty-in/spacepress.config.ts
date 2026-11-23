import { collection, defineConfig, text, table } from "spacepress";
export const notes = table({ kind: text().optional(), x: text().showIf({ kind: { in: [] } }).optional() });
export default defineConfig({});
