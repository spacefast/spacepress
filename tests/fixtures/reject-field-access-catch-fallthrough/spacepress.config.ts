import { collection, defineConfig, table, f } from "spacepress";
export const notes = table({ secret: f.text().access({ read: ctx => { try { if (ctx.user === null) throw new Error("anonymous"); return true; } catch (error) {} } }).optional() });
export default defineConfig({});
