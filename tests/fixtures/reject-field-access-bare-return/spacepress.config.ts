import { collection, text, defineConfig, table } from "spacepress";
export const notes = table({ secret: text().access({ read: () => { return; } }).optional() });
export default defineConfig({});
