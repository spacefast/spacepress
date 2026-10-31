// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
// Lane E (§6.2): members are WordPress users, plus a collection any signed-in viewer (guests
// included) may write and one that subscribers and up may write, for the guest role ladder.
import { collection, date, email, id, integer, select, text } from "zero";

export const members = collection("members", {
  id: id(),
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
  points: integer().notNull().default(0),
  tags: select({ options: ["early", "beta"], multiple: true }).notNull().default([]),
  handle: text().unique().max(40),
  joined: date().unique(),
  // Shown only to pro members: a live rule on the plan field, settled on the saved row's name too.
  perk: text().showIf({ plan: "pro" }),
  badge: text().showIf({ name: "Cy Edited" }),
  // A reference isn't a profile field: a rule on it is settled against the saved member.
  sponsorId: integer().references(() => guestbook.id),
  sponsored: text().showIf({ sponsorId: { isNotNull: true } }),
}, { auth: true, access: { read: "self", update: "self", create: "admin", delete: "admin" } });

export const guestbook = collection("guestbook", {
  id: id(),
  message: text().notNull(),
  memberId: integer().references(() => members.id),
}, { editor: false, access: { read: "anyone", create: "authenticated" } });

export const reviews = collection("reviews", {
  id: id(),
  body: text().notNull(),
}, { editor: false, access: { read: "anyone", create: "subscriber" } });

export const schema = { members, guestbook, reviews };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: any) => ({
  guestbook: { member: r.one.members({ from: r.guestbook.memberId, to: r.members.id }) },
  members: { entries: r.many.guestbook() },
});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
