// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane K1 (runtime gaps): `legs` is a post-backed localized child of the localized `tours` (lane
// H), for `with` resolving each parent row's children in that row's locale through Polylang.
import { collection, id, integer, text } from "zero";
import { tours } from "./locales.ts";

export const legs = collection("legs", {
  id: id(),
  title: text().notNull().localized(),
  tourId: integer().references(() => tours.id, { onDelete: "cascade" }),
}, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const schema = { legs };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: any) => ({
  tours: { legs: r.many.legs({ from: r.tours.id, to: r.legs.tourId }) },
});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
