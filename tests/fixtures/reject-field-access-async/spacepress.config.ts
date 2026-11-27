import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ x: f.text().access({ read: async () => true }).optional() });
export default defineConfig({});
