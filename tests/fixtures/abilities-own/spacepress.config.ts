import { abilities } from "php/wordpress";
import { collection, defineConfig, global, job, media, text, userProjection, email, mutation } from "spacepress";

// Imports "php/wordpress" so sp/_generated/db.d.ts carries the catalog. Every kind of ability the app registers: collection CRUD with revisions and media, an auth
// collection's create (with its `password` input), sync, an action with optional input, a global
// and an agent-visible job. tests/compiler_contracts.rs compares them with Register::operations().
export const notes = collection({
  title: text(),
  body: text().optional(),
  cover: media({ accept: "image" }).optional(),
}, { title: "title", revisions: true, sync: "content/notes/*.json" });
export const members = userProjection({ email: email().unique().max(191), name: text() }, {});
export const settings = global({ tagline: text().optional() });

export const greet = mutation({ access: "anyone" }, (i: { who: string; times?: number }) => i.who);

export const reindex = job({ agents: true }, async (_input: { from: number }) => {});

export default defineConfig({
  name: "own",
});
