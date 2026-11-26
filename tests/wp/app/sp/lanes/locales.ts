// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
//
// Localization (§7.3): `tours` is a post-backed localized collection (Polylang owns language +
// group) that also syncs with Markdown files (lane C), `phrases` a `table()` one (SpacePress's own
// translationGroup column).
import { collection, db, integer, richText, select, slug, text, table, mutation, HttpError } from "spacepress";

export const tours = collection({
  title: text().localized(),
  summary: text().localized().optional(),
  slug: slug({ source: "title" }).optional(),
  price: integer().optional(),
  tags: select(["tea", "coffee"]).many().default([]),
  body: richText().localized().optional(),
}, { title: "title", content: "body", drafts: true, revisions: true, sync: "content/tours/*.md", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } }).on({
  // A translation titled "Bump…" rewrites the price it is given: group sync must refuse, not split the group.
  async beforeUpdate(patch, existing) {
    const price = patch.price;
    if (existing.title.startsWith("Bump") && price != null) patch.price = price + 1;
  },
  async afterUpdate(row, previous, ctx) {
    if (!Object.hasOwn(row.translations, row.locale)) throw new Error("translations missing in hook");
    await db.insert(tourLog).values({ tourId: row.id, entry: `${row.locale}:${row.price}${ctx.user ? " by " + ctx.user.name : ""}` });
  },
});

// Every tours afterUpdate leaves "<locale>:<price>", so per-row hooks during group sync are observable.
export const tourLog = table({ tourId: integer(), entry: text() }, { access: { read: "anyone" } });

export const phrases = table({
  text: text().localized(),
  weight: integer().optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const refsTranslations = mutation({ access: "editor" }, async (input: { id: number }) => {
  if (!Number.isInteger(input.id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  const row = await db.query.tours.findFirst({ where: { id: input.id }, locale: "*" });
  return row ? Object.keys(row.translations).sort() : [];
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = { locales: { default: "en", all: ["en", "de", "fr"] } };
