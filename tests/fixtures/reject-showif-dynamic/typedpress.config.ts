import { collection, text, defineConfig, table } from "typedpress";
export const notes = table({ kind: text().optional(), label: text().showIf({ kind: { in: [() => true] } }).optional() });
export default defineConfig({});
