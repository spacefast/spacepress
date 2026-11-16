import { collection, date, defineConfig, group, text, table } from "typedpress";
export const notes = table({ meta: group({ due: date().optional(), x: text().showIf({ due: "2026-10-29" }).optional() }).optional() });
export default defineConfig({});
