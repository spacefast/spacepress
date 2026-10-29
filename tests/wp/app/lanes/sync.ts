// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Content sync (design §5): `guides` is a post-backed collection synced with Markdown files, and
// `writers` gives it a uid'd reference target, so tests/wp/sync.test.ts covers bodies, references,
// drafts and trash against real WordPress.
import { collection, id, integer, richText, select, slug, text, HttpError } from "zero";

export const writers = collection("writers", {
  id: id(),
  name: text().notNull().max(80),
}, { title: "name", uid: true });

export const guides = collection("guides", {
  id: id(),
  title: text().notNull().max(120),
  slug: slug({ source: "title" }),
  body: richText(),
  summary: text({ multiline: true }),
  level: select({ options: ["intro", "advanced"] }),
  writerId: integer().references(() => writers.id, { onDelete: "set null" }),
}, { title: "title", content: "body", sync: "content/guides/*.md" });

export const schema = { writers, guides };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  guides: {
    // A delete veto: sync trash must run the delete lifecycle and roll back with it.
    async beforeDelete(row) {
      if (row.summary === "keep") throw new HttpError(409, "kept", "this guide is kept");
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
