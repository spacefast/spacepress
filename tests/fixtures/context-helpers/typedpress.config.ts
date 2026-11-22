import { defineConfig, mutation } from "typedpress";
import { caller, label, notes, read, role, same, write } from "./tp/helpers";

export const whoami = mutation({ access: "anyone" }, async (_input: {}, ctx) => ({ label: label(caller(same(ctx))), role: role(ctx), anonymous: read(ctx, "user"), viaIndex: ctx["user"] === null }));

export const note = mutation({ access: "anyone" }, async (input: { body: string }, ctx) => await write(ctx, input.body));

export default defineConfig({});
