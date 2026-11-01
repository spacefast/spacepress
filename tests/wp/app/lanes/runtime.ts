// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane K1 (runtime gaps): `legs` is a post-backed localized child of the localized `tours` (lane
// H), for `with` resolving each parent row's children in that row's locale through Polylang.
// `bulkTourPrice` is one trusted update over two rows of a translation group (hooks once per row).
// `guest_carts` (cascade) and `guest_notes` (set null) are rows a member owns, for guest pruning.
// `big_counts` holds integers past 2^53 (BIGINT): compiled arithmetic on them must match JS.
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

export const bigCounts = collection("big_counts", { id: id(), n: integer().notNull() }, { editor: false, access: { read: "anyone", create: "editor" } });

export const schema = { legs, guestCarts, guestNotes, bigCounts };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: any) => ({
  tours: { legs: r.many.legs({ from: r.tours.id, to: r.legs.tourId }) },
});
export const actions = {
  // Arithmetic in compiled code on a stored integer and on an input one, past 2^53. The stored row
  // is still found by its exact value.
  bigMath: action({
    input: { id: integer().notNull(), m: integer().notNull() },
    access: "editor",
    agents: false,
    async handler({ id, m }) {
      const row = await db.query.bigCounts.findFirst({ where: { id } });
      if (!row) return null;
      const n = row.n;
      let k = n;
      const old = k++;
      const again = await db.query.bigCounts.findFirst({ where: { n } });
      return [old - 1, n + 1, n - 1, n * 1, -n, k, m + 1, m - n, n + m, String(n + 0), again ? again.id : null];
    },
  }),
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
