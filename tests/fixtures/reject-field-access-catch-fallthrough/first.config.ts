import { collection, id, text, defineConfig, table } from "first";
const notes = table({ id: id(), secret: text().access({ read: ctx => { try { if (ctx.user === null) throw new Error("anonymous"); return true; } catch (error) {} } }) });
export default defineConfig({ tables: { notes } });
