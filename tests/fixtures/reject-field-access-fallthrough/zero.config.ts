import { collection, id, text, defineConfig } from "zero";
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => { switch (ctx.op) { case "read": break; case "create": return true; case "update": return false; } } }) }, { editor: false });
export default defineConfig({ schema: { notes } });
