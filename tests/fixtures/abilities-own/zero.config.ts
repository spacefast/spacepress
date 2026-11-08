import { abilities } from "php/wordpress";
import { action, collection, defineConfig, global, integer, job, media, text, userProjection, email } from "zero";

// Imports "php/wordpress" so zero.gen.ts carries the catalog. Every kind of ability the app registers: collection CRUD with revisions and media, an auth
// collection's create (with its `password` input), sync, an action with optional input, a global
// and an agent-visible job. tests/compiler_contracts.rs compares them with Register::operations().
const notes = collection({
  title: text().notNull(),
  body: text(),
  cover: media({ accept: "image" }),
}, { title: "title", revisions: true, sync: "content/notes/*.json" });
const members = userProjection({ email: email().notNull().unique().max(191), name: text().notNull() }, {});
const settings = global("settings", { tagline: text() });

export default defineConfig({
  name: "own",
  collections: { notes },
  users: { members },
  globals: { settings },
  actions: {
    greet: action({ input: { who: text().notNull(), times: integer() }, access: "anyone", handler: (i) => i.who }),
  },
  jobs: {
    reindex: job({ input: { from: integer().notNull() }, agents: true, handler: async () => {} }),
  },
});
