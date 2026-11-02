import { collection, id, text, defineConfig, table } from "zero";
function maybe(authenticated: boolean, candidate: boolean) { switch (authenticated) { case candidate: return true; } }
const notes = table({ id: id(), secret: text().access({ read: ctx => maybe(ctx.user !== null, ctx.op === "read") }) });
export default defineConfig({ tables: { notes } });
