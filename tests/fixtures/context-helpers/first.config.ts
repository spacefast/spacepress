import { defineConfig, action, text } from "first";
import { caller, label, notes, read, role, same, write } from "./first/helpers";

export default defineConfig({
  tables: { notes },
  actions: {
    whoami: action({
      input: {},
      access: "anyone",
      handler: async (_input, ctx) => ({ label: label(caller(same(ctx))), role: role(ctx), anonymous: read(ctx, "user"), viaIndex: ctx["user"] === null }),
    }),
    note: action({ input: { body: text() }, access: "anyone", handler: async (input, ctx) => await write(ctx, input.body) }),
  },
});
