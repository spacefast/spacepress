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
  // Field access (lane B) applies to sync: editors never see `internal`, and may read but not change `review`.
  internal: text().access({ read: "admin", update: "admin" }),
  review: text().access({ update: "admin" }),
}, { title: "title", content: "body", sync: "content/guides/*.md", access: { create: "author" } });

// Content behind field access: `briefs` hides its body from everyone below admin; `memos` lets
// editors read the body but only admins change it.
export const briefs = collection("briefs", {
  id: id(),
  title: text().notNull(),
  body: richText().access({ read: "admin" }),
}, { title: "title", content: "body", sync: "content/briefs/*.md" });
export const memos = collection("memos", {
  id: id(),
  title: text().notNull(),
  body: richText().access({ update: "admin" }),
}, { title: "title", content: "body", sync: "content/memos/*.md" });

export const schema = { writers, guides, briefs, memos };
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
    // A hook rewriting identity: the runtime refuses it after the hook and rolls the write back.
    async beforeUpdate(patch, existing) {
      if (patch.title === "steal uid") return { ...patch, uid: "zr_99999999999999999999" };
    },
    // Fails after the post is already in the trash, so the request must roll the trash back.
    async afterDelete(row) {
      if (row.summary === "regret") throw new HttpError(409, "regretted", "this guide came back");
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
