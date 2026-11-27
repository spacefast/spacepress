import { abilities } from "spacepress/server/wp";
import { collection, defineConfig, extend, global, job, mutation, f } from "spacepress";

// Imports "spacepress/server/wp" so sp/_generated/db.d.ts carries the catalog. Every kind of ability the app registers: collection CRUD with revisions and media, an auth
// collection's create (with its `password` input), sync, an action with optional input, a global
// and an agent-visible job. tests/compiler_contracts.rs compares them with Register::operations().
export const notes = collection({
  title: f.text(),
  body: f.text().optional(),
  cover: f.media({ accept: "image" }).optional(),
}, { title: "title", revisions: true, sync: "content/notes/*.json" });
export const members = extend("users", { fields: { name: f.text() } });
export const settings = global({ tagline: f.text().optional() });

export const greet = mutation({ access: "anyone" }, (_ctx, i: { who: string; times?: number }) => i.who);

export const reindex = job({ agents: true }, async (_ctx, _input: { from: number }) => {});

export default defineConfig({
  name: "own",
});
