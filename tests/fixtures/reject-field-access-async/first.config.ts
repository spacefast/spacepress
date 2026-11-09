import { collection, defineConfig, id, text, table } from "first";
const notes = table({ id: id(), x: text().access({ read: async () => true }) });
export default defineConfig({ tables: { notes } });
