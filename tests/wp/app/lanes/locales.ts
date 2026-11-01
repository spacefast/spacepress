// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Localization (§7.3): `tours` is a post-backed localized collection (Polylang owns language +
// group) that also syncs with Markdown files (lane C), `phrases` an `editor: false` one (Zero's own
// translationGroup column).
import { action, collection, db, id, integer, richText, select, slug, text } from "zero";

export const tours = collection("tours", {
  id: id(),
  title: text().notNull().localized(),
  summary: text().localized(),
  slug: slug({ source: "title" }),
  price: integer(),
  tags: select({ options: ["tea", "coffee"], multiple: true }).notNull().default([]),
  body: richText().localized(),
}, { title: "title", content: "body", drafts: true, revisions: true, sync: "content/tours/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Every tours afterUpdate leaves "<locale>:<price>", so per-row hooks during group sync are observable.
export const tourLog = collection("tour_log", { id: id(), tourId: integer().notNull(), entry: text().notNull() }, { editor: false, access: { read: "anyone" } });

export const phrases = collection("phrases", {
  id: id(),
  text: text().notNull().localized(),
  weight: integer(),
}, { editor: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const schema = { tours, tourLog, phrases };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {
  refsTranslations: action({ input: { id: integer().notNull() }, access: "editor", handler: async (input) => {
    const row = await db.query.tours.findFirst({ where: { id: input.id }, locale: "*" });
    return row ? Object.keys(row.translations).sort() : [];
  } }),
};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {
  tours: {
    // A translation titled "Bump…" rewrites the price it is given: group sync must refuse, not split the group.
    async beforeUpdate(patch, existing) {
      const price = patch.price;
      if (existing.title.startsWith("Bump") && price != null) patch.price = price + 1;
    },
    async afterUpdate(row, previous, ctx) {
      if (!Object.hasOwn(row.translations, row.locale)) throw new Error("translations missing in hook");
      await db.insert(tourLog).values({ tourId: row.id, entry: `${row.locale}:${row.price}${ctx.user ? " by " + ctx.user.name : ""}` });
    },
  },
};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = { locales: { default: "en", all: ["en", "de", "fr"] } };
