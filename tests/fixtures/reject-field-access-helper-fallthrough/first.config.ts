import { collection, text, defineConfig, table } from "first";
function maybe(authenticated: boolean, candidate: boolean) { switch (authenticated) { case candidate: return true; } }
export const notes = table({ secret: text().access({ read: ctx => maybe(ctx.user !== null, ctx.op === "read") }).optional() });
export default defineConfig({});
