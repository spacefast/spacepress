import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => { if (ctx.user !== null) return true; } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
