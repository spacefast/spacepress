// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
// Lane E (§6.2): members are WordPress users, plus a collection any signed-in viewer (guests
// included) may write and one that subscribers and up may write, for the guest role ladder.
import { blocks, boolean, collection, date, db, email, group, HttpError, integer, repeater, select, text, timestamp, userProjection, table, ref } from "spacepress";

export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
  points: integer().default(0),
  tags: select(["early", "beta"]).many().default([]),
  handle: text().unique().max(40).optional(),
  joined: date().unique().optional(),
  // Shown only to pro members: a live rule on the plan field, settled on the saved row's name too.
  perk: text().showIf({ plan: "pro" }).optional(),
  badge: text().showIf({ name: "Cy Edited" }).optional(),
  // A reference isn't a profile field: a rule on it is settled against the saved member.
  sponsorId: ref(() => guestbook).optional().onDelete("restrict"),
  sponsored: text().showIf({ sponsorId: { isNotNull: true } }).optional(),
  // Structured fields on the profile form (lane K2), written through SpacePress: a sub-field only admins
  // may set, a validated sub-field, a showIf on a scalar sibling, a timestamp in a repeater row.
  address: group({
    city: text().max(40).optional(),
    source: text().default("signup").access({ update: "admin" }),
    defaults: group({ clock: group({ at: timestamp().optional() }).optional() }).default({ clock: { at: "2026-10-25T00:30:00.123Z" } }).access({ update: "admin" }).optional(),
    channel: text().$default(() => "member").access({ update: "admin" }),
    since: timestamp().default("2026-10-25T00:30:00.123Z").access({ update: "admin" }),
    verified: boolean().default(false).access({ update: "admin" }),
    optional: boolean().default(true).access({ update: "admin" }).optional(),
    prefs: group({ bio: text().optional() }).access({ update: "admin" }).optional(),
    // Hidden (and so not posted by SCF) unless the city is Oslo.
    district: text().showIf({ city: "Oslo" }).optional(),
  }).optional(),
  links: repeater({ label: text(), at: timestamp().optional(), detail: text().showIf({ label: "visible" }), metadata: group({ bio: text().optional() }) }).max(3).optional(),
  sections: blocks({ bio: { body: text() }, quote: { text: text().optional(), cite: text().showIf({ text: "visible" }).optional() } }).showIf({ plan: "pro" }).optional(),
  notes: group({ private: text().access({ read: "admin", update: "admin" }).optional() }).optional(),
  addressBy: integer().optional(),
}, { access: { read: "self", update: (ctx) => ctx.data?.address?.city === "Gated" ? { id: ctx.user?.id ?? -1, name: "Unlocked" } : { id: ctx.user?.id ?? -1 }, create: "admin", delete: "admin" } }).on({
  // Who last saved the address, as the hook saw ctx.user; a "Throw" city rolls the save back.
  beforeUpdate(patch, _existing, ctx) {
    if (patch.address !== undefined) {
      if (patch.address?.city === "Throw") throw new HttpError(409, "conflict", "address hook refused");
      patch.addressBy = ctx.user?.id ?? 0;
      if (patch.address?.city === "Hooked") patch.name = "Name from hook";
    }
  },
  async afterUpdate(row) {
    await db.insert(memberUpdates).values({ memberId: row.id, name: row.name, city: row.address?.city ?? null });
  },
});

export const guestbook = table({
  message: text(),
  memberId: ref(members).optional().onDelete("restrict"),
}, { access: { read: "anyone", create: "authenticated" } });

export const reviews = table({
  body: text(),
}, { access: { read: "anyone", create: "subscriber" } });

export const memberUpdates = table({
  memberId: integer(), name: text(), city: text().optional(),
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
