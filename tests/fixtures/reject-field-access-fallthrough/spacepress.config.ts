import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: ctx => { switch (ctx.op) { case "read": break; case "create": return true; case "update": return false; } } }).optional() });
export default defineConfig({});
