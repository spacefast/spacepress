import { collection, id, text, defineConfig, table } from "zero";
const notes = table({ id: id(), secret: text().access({ read: ctx => { switch (ctx.op) { case "read": break; case "create": return true; case "update": return false; } } }) });
export default defineConfig({ tables: { notes } });
