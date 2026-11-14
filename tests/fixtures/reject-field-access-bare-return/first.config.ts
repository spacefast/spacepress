import { collection, text, defineConfig, table } from "first";
export const notes = table({ secret: text().access({ read: () => { return; } }).optional() });
export default defineConfig({});
