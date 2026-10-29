import { collection, id, text, defineConfig } from "zero";
function maybe(user: unknown) { if (user !== null) return true; }
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => maybe(ctx.user) }) }, { editor: false });
export default defineConfig({ schema: { notes } });
