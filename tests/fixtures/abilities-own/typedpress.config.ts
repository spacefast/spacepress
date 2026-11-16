import { abilities } from "php/wordpress";
import { action, collection, defineConfig, global, integer, job, media, text, userProjection, email } from "typedpress";

// Imports "php/wordpress" so tp/_generated/db.d.ts carries the catalog. Every kind of ability the app registers: collection CRUD with revisions and media, an auth
// collection's create (with its `password` input), sync, an action with optional input, a global
// and an agent-visible job. tests/compiler_contracts.rs compares them with Register::operations().
export const notes = collection({
  title: text(),
  body: text().optional(),
  cover: media({ accept: "image" }).optional(),
}, { title: "title", revisions: true, sync: "content/notes/*.json" });
export const members = userProjection({ email: email().unique().max(191), name: text() }, {});
export const settings = global({ tagline: text().optional() });

export const greet = action({ input: { who: text(), times: integer().optional() }, access: "anyone", handler: (i) => i.who });

export const reindex = job({ input: { from: integer() }, agents: true, handler: async () => {} });

export default defineConfig({
  name: "own",
});
