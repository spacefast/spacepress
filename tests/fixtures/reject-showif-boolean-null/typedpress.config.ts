import { boolean, collection, defineConfig, text, table } from "typedpress";
export const notes = table({ active: boolean().optional(), x: text().showIf({ active: { in: [null, true] } }).optional() });
export default defineConfig({});
