import { collection, id, text, defineConfig, table } from "first";
const notes = table({ id: id(), secret: text().access({ read: () => { return; } }) });
export default defineConfig({ tables: { notes } });
