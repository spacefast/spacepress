// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Localization (§7.3): `guides` is a post-backed localized collection (Polylang owns language +
// group), `phrases` an `editor: false` one (Zero's own translationGroup column).
import { collection, id, integer, select, slug, text } from "zero";

export const guides = collection("guides", {
  id: id(),
  title: text().notNull().localized(),
  summary: text().localized(),
  slug: slug({ source: "title" }),
  price: integer(),
  tags: select({ options: ["tea", "coffee"], multiple: true }).notNull().default([]),
}, { drafts: true, revisions: true, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const phrases = collection("phrases", {
  id: id(),
  text: text().notNull().localized(),
  weight: integer(),
}, { editor: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const schema = { guides, phrases };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = { locales: { default: "en", all: ["en", "de", "fr"] } };
