import { collection, defineConfig, text, table } from "spacepress";
export const notes = table({ x: text().access({ read: async () => true }).optional() });
export default defineConfig({});
