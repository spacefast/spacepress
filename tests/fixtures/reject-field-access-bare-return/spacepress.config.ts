import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: () => { return; } }).optional() });
export default defineConfig({});
