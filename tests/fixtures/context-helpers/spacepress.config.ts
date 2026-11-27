import { defineConfig, mutation } from "spacepress";
import { caller, label, notes, read, role, same, write } from "./sp/helpers";

export const whoami = mutation({ access: "anyone" }, async (ctx) => ({ label: label(caller(same(ctx))), role: role(ctx), anonymous: read(ctx, "user"), viaIndex: ctx["user"] === null }));

export const note = mutation({ access: "anyone" }, async (ctx, input: { body: string }) => await write(ctx, input.body));

export default defineConfig({});
