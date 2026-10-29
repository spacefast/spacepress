import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => { try { if (ctx.user === null) throw new Error("anonymous"); return true; } catch (error) {} } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
