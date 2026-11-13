// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Localization (§7.3): `tours` is a post-backed localized collection (Polylang owns language +
// group) that also syncs with Markdown files (lane C), `phrases` a `table()` one (First's own
// translationGroup column).
import { action, collection, db, integer, richText, select, slug, text, table } from "first";

export const tours = collection({
  title: text().localized(),
  summary: text().localized().optional(),
  slug: slug({ source: "title" }).optional(),
  price: integer().optional(),
  tags: select(["tea", "coffee"]).many().default([]),
  body: richText().localized().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, sync: "content/tours/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

// Every tours afterUpdate leaves "<locale>:<price>", so per-row hooks during group sync are observable.
export const tourLog = table({ tourId: integer(), entry: text() }, { access: { read: "anyone" } });

export const phrases = table({
  text: text().localized(),
  weight: integer().optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const collections = { tours };
export const tables = { tourLog, phrases };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
export const actions = {
  refsTranslations: action({ input: { id: integer() }, access: "editor", handler: async (input) => {
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
