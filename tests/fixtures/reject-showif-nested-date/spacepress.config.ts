import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ meta: f.group({ due: f.date().optional(), x: f.text().showIf({ due: "2026-10-29" }).optional() }).optional() });
export default defineConfig({});
