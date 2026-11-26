// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
//
// Lane K1 (runtime gaps): `legs` is a post-backed localized child of the localized `tours` (lane
// H), for `with` resolving each parent row's children in that row's locale through Polylang.
// `bulkTourPrice` is one trusted update over two rows of a translation group (hooks once per row).
// `guest_carts` (cascade) and `guest_notes` (set null) are rows a member owns, for guest pruning.
// `big_counts` holds integers past 2^53 (BIGINT): compiled arithmetic on them must match JS.
import { collection, integer, text, table, ref, mutation } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { tours } from "./locales.ts";
import { members } from "./auth.ts";

export const legs = collection({
  title: text().localized(),
  tourId: ref(() => tours).optional().onDelete("cascade"),
}, { title: "title", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const guestCarts = table({
  memberId: ref(() => members).onDelete("cascade"),
}, { access: { read: "anyone", create: "authenticated" } });

export const guestNotes = table({
  body: text(),
  memberId: ref(() => members).optional(),
}, { access: { read: "anyone", create: "authenticated" } });

export const bigCounts = table({ n: integer() }, { access: { read: "anyone", create: "editor" } });

export const nativeHandler = mutation({ access: "anyone", agents: false }, (input: { title: string; count: number }) => {
  if (!Number.isInteger(input.count)) throw new HttpError(422, "invalid_input", "count must be an integer", "/count");
  input.title = input.title.trim();
  input.count += 1;
  return { title: input.title, count: input.count };
});

// Arithmetic in compiled code on a stored integer and on an input one, past 2^53. The stored row
// is still found by its exact value.
export const bigMath = mutation({ access: "editor", agents: false }, async ({ id, m }: { id: number; m: number }) => {
  if (!Number.isInteger(id)) throw new HttpError(422, "invalid_input", "id must be an integer", "/id");
  if (!Number.isInteger(m)) throw new HttpError(422, "invalid_input", "m must be an integer", "/m");
  const row = await db.query.bigCounts.findFirst({ where: { id } });
  if (!row) return null;
  const n = row.n;
  let k = n;
  const old = k++;
  const again = await db.query.bigCounts.findFirst({ where: { n } });
  return [old - 1, n + 1, n - 1, n * 1, -n, k, m + 1, m - n, n + m, String(n + 0), again ? again.id : null];
});

export const bulkTourPrice = mutation({ access: "editor", agents: false }, async ({ a, b, price }: { a: number; b: number; price: number }) => {
  if (!Number.isInteger(a)) throw new HttpError(422, "invalid_input", "a must be an integer", "/a");
  if (!Number.isInteger(b)) throw new HttpError(422, "invalid_input", "b must be an integer", "/b");
  if (!Number.isInteger(price)) throw new HttpError(422, "invalid_input", "price must be an integer", "/price");
  const rows = await db.update(tours).set({ price }).where({ id: { in: [a, b] } }).returning();
  return rows.length;
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
