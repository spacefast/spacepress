import { collection, text, defineConfig, table } from "first";
const notes = table({ secret: text().access({ read: () => { return; } }).optional() });
export default defineConfig({ tables: { notes } });
