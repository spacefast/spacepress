import { collection, id, text, defineConfig } from "zero";
function maybe(authenticated: boolean) { switch (authenticated) { case true: return true; } }
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => maybe(ctx.user !== null) }) }, { editor: false });
export default defineConfig({ schema: { notes } });
