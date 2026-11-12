import { collection, defineConfig, text, table } from "first";
const notes = table({ x: text().access({ read: async () => true }).optional() });
export default defineConfig({ tables: { notes } });
