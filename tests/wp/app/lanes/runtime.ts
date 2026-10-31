// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane K1 (runtime gaps): `legs` is a post-backed localized child of the localized `tours` (lane
// H), for `with` resolving each parent row's children in that row's locale through Polylang.
// `bulkTourPrice` is one trusted update over two rows of a translation group (hooks once per row).
// `guest_carts` (cascade) and `guest_notes` (set null) are rows a member owns, for guest pruning.
import { action, collection, db, id, integer, text } from "zero";
import { tours } from "./locales.ts";
import { members } from "./auth.ts";

export const legs = collection("legs", {
  id: id(),
  title: text().notNull().localized(),
  tourId: integer().references(() => tours.id, { onDelete: "cascade" }),
}, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const guestCarts = collection("guest_carts", {
  id: id(),
  memberId: integer().notNull().references(() => members.id, { onDelete: "cascade" }),
}, { editor: false, access: { read: "anyone", create: "authenticated" } });

export const guestNotes = collection("guest_notes", {
  id: id(),
  body: text().notNull(),
  memberId: integer().references(() => members.id, { onDelete: "set null" }),
}, { editor: false, access: { read: "anyone", create: "authenticated" } });

export const schema = { legs, guestCarts, guestNotes };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: any) => ({
  tours: { legs: r.many.legs({ from: r.tours.id, to: r.legs.tourId }) },
});
export const actions = {
  bulkTourPrice: action({
    input: { a: integer().notNull(), b: integer().notNull(), price: integer().notNull() },
    access: "editor",
    agents: false,
    async handler({ a, b, price }) {
      const rows = await db.update(tours).set({ price }).where({ id: { in: [a, b] } }).returning();
      return rows.length;
    },
  }),
};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
