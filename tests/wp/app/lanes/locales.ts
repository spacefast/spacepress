// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Localization (§7.3): `guides` is a post-backed localized collection (Polylang owns language +
// group), `phrases` an `editor: false` one (Zero's own translationGroup column).
import { collection, db, id, integer, select, slug, text } from "zero";

export const guides = collection("guides", {
  id: id(),
  title: text().notNull().localized(),
  summary: text().localized(),
  slug: slug({ source: "title" }),
  price: integer(),
  tags: select({ options: ["tea", "coffee"], multiple: true }).notNull().default([]),
}, { drafts: true, revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Every guides afterUpdate leaves "<locale>:<price>", so per-row hooks during group sync are observable.
export const guideLog = collection("guide_log", { id: id(), guideId: integer().notNull(), entry: text().notNull() }, { editor: false, access: { read: "anyone" } });

export const phrases = collection("phrases", {
  id: id(),
  text: text().notNull().localized(),
  weight: integer(),
}, { editor: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const schema = { guides, guideLog, phrases };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  guides: {
    // A translation titled "Bump…" rewrites the price it is given: group sync must refuse, not split the group.
    async beforeUpdate(patch, existing) {
      const price = patch.price;
      if (existing.title.startsWith("Bump") && price != null) patch.price = price + 1;
    },
    async afterUpdate(row) {
      await db.insert(guideLog).values({ guideId: row.id, entry: `${row.locale}:${row.price}` });
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = { locales: { default: "en", all: ["en", "de", "fr"] } };
