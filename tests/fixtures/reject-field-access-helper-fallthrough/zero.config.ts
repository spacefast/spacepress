import { collection, id, text, defineConfig } from "zero";
function maybe(authenticated: boolean, candidate: boolean) { switch (authenticated) { case candidate: return true; } }
const notes = collection("notes", { id: id(), secret: text().access({ read: ctx => maybe(ctx.user !== null, ctx.op === "read") }) }, { editor: false });
export default defineConfig({ schema: { notes } });
