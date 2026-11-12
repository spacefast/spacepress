import { collection, text, defineConfig, table } from "first";
const notes = table({ secret: text().access({ read: ctx => { switch (ctx.op) { case "read": break; case "create": return true; case "update": return false; } } }).optional() });
export default defineConfig({ tables: { notes } });
