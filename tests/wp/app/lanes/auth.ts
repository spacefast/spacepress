// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
// Lane E (§6.2): members are WordPress users, plus a collection any signed-in viewer (guests
// included) may write and one that subscribers and up may write, for the guest role ladder.
import { blocks, boolean, collection, date, email, group, HttpError, id, integer, repeater, select, text, timestamp, type Hooks } from "zero";

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
  // Structured fields on the profile form (lane K2), written through Zero: a sub-field only admins
  // may set, a validated sub-field, a showIf on a scalar sibling, a timestamp in a repeater row.
  address: group({ fields: {
    city: text().max(40),
    source: text().notNull().default("signup").access({ update: "admin" }),
    channel: text().notNull().$default(() => "member").access({ update: "admin" }),
    since: timestamp().notNull().default("2026-10-25T00:30:00.123Z").access({ update: "admin" }),
    verified: boolean().notNull().default(false).access({ update: "admin" }),
    optional: boolean().default(true).access({ update: "admin" }),
    prefs: group({ fields: { bio: text() } }).access({ update: "admin" }),
    // Hidden (and so not posted by SCF) unless the city is Oslo.
    district: text().showIf({ city: "Oslo" }),
  } }),
  links: repeater({ fields: { label: text().notNull(), at: timestamp(), detail: text().notNull().showIf({ label: "visible" }), metadata: group({ fields: { bio: text() } }).notNull() } }).max(3),
  sections: blocks({ layouts: { bio: { body: text().notNull() }, quote: { text: text(), cite: text().showIf({ text: "visible" }) } } }).showIf({ plan: "pro" }),
  notes: group({ fields: { private: text().access({ read: "admin", update: "admin" }) } }),
  addressBy: integer(),
}, { auth: true, access: { read: "self", update: (ctx) => ctx.data?.address?.city === "Gated" ? { id: ctx.user?.id ?? -1, name: "Unlocked" } : { id: ctx.user?.id ?? -1 }, create: "admin", delete: "admin" } });

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
export const hooks = {
  members: {
    // Who last saved the address, as the hook saw ctx.user; a "Throw" city rolls the save back.
    beforeUpdate(patch, _existing, ctx) {
      if (patch.address !== undefined) {
        if (patch.address?.city === "Throw") throw new HttpError(409, "conflict", "address hook refused");
        patch.addressBy = ctx.user?.id ?? 0;
      }
    },
  },
} satisfies Hooks<{ members: typeof members }>;
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
