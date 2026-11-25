import { collection, text, defineConfig, table } from "spacepress";
export const notes = table({ secret: text().access({ read: ctx => { try { if (ctx.user === null) throw new Error("anonymous"); return true; } catch (error) {} } }).optional() });
export default defineConfig({});
