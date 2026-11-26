// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
//
// Content sync (design §5): `guides` is a post-backed collection synced with Markdown files, and
// `writers` gives it a uid'd reference target, so tests/wp/sync.test.ts covers bodies, references,
// drafts and trash against real WordPress.
import { collection, integer, richText, select, slug, table, text, ref } from "spacepress";
import { db, HttpError } from "spacepress/server";

export const writers = collection({
  name: text().max(80),
}, { title: "name", uid: true });

export const guides = collection({
  title: text().max(120),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  summary: text({ multiline: true }).optional(),
  level: select(["intro", "advanced"]).optional(),
  writerId: ref(writers).optional(),
  // Field access (lane B) applies to sync: editors never see `internal`, and may read but not change `review`.
  internal: text().access({ read: "admin", update: "admin" }).optional(),
  review: text().access({ update: "admin" }).optional(),
}, { title: "title", content: "body", sync: "content/guides/*.md", access: { create: "author" } }).on({
  // A delete veto. Sync's trash is an unpublish, so it never runs; a permanent delete does.
  async beforeDelete(row) {
    if (row.summary === "keep") throw new HttpError(409, "kept", "this guide is kept");
  },
  // A hook rewriting identity: the runtime refuses it after the hook and rolls the write back.
  async beforeUpdate(patch, existing) {
    if (patch.title === "steal uid") return { ...patch, uid: "zr_99999999999999999999" };
  },
  // A published guide moved to the trash is unpublished: this fails after the post is already in the
  // trash, so the request must roll the trash back.
  async afterUpdate(row, previous) {
    if (previous.summary === "regret" && previous.status === "published" && row.status !== "published") {
      throw new HttpError(409, "regretted", "this guide came back");
    }
    if (row.summary === "logged") await db.insert(guideHooks).values({ hook: "afterUpdate", title: row.title, status: row.status });
  },
  // Guides with `summary: "logged"` record each hook with the row it saw.
  async afterPublish(row) {
    if (row.summary === "logged") await db.insert(guideHooks).values({ hook: "afterPublish", title: row.title, status: row.status });
  },
});

export const guideHooks = table({
  hook: text(),
  title: text(),
  status: text(),
});

// Rows that depend on a guide: `cascade` removes them when the guide is deleted for good, and a
// sync trash, which is not a delete, keeps them.
export const guideNotes = table({
  guideId: ref(guides).onDelete("cascade"),
  note: text(),
});

// Content behind field access: `briefs` hides its body from everyone below admin; `memos` lets
// editors read the body but only admins change it.
export const briefs = collection({
  title: text(),
  body: richText().access({ read: "admin" }).optional(),
}, { title: "title", content: "body", sync: "content/briefs/*.md" });

export const memos = collection({
  title: text(),
  body: richText().access({ update: "admin" }).optional(),
}, { title: "title", content: "body", sync: "content/memos/*.md" });
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
