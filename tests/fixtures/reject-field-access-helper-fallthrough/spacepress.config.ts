import { collection, defineConfig, table, f } from "spacepress";
function maybe(authenticated: boolean, candidate: boolean) { switch (authenticated) { case candidate: return true; } }
export const notes = table({ secret: f.text().access({ read: ctx => maybe(ctx.user !== null, ctx.op === "read") }).optional() });
export default defineConfig({});
