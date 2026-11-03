import { collection, id, text, defineConfig, table } from "zero";
const notes = table({ id: id(), secret: text().access({ read: () => { return; } }) });
export default defineConfig({ tables: { notes } });
