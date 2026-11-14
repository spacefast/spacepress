// Fixture schema for the type tests (self-contained). `locations`/`items`/`shoppingList` mirror the
// pantry example (custom tables: `table()`); `authors`/`posts`/`comments`/`settings` mirror the
// blog example (design §1.9) and carry the v1 additions.
import {
  blocks, boolean, collection, date, email, global, group, integer, json, media,
  repeater, richText, select, slug, text, timestamp, url,
  table, ref, type AnyCollection,
} from "first";

export const UNITS = ["pcs", "g", "kg"] as const;

const timestamps = {
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
};

export const locations = table({
  name: text(),
  kind: select(["fridge", "freezer", "pantry"]).default("pantry"),
});

export const items = table({
  name: text(),
  quantity: integer().default(1),
  unit: select(UNITS).default("pcs"),
  expiresOn: date().optional(),
  opened: boolean().default(false),
  locationId: ref(locations).optional(),
  tags: json<string[]>().$default(() => []),
  meta: json().optional(),
  ...timestamps,
});

export const shoppingList = table({
  itemId: ref(items).unique().optional().onDelete("cascade"),
  name: text(),
  done: boolean().default(false),
});

// Renames (spec §2.5, §2.6): a field and a table declare the names they were stored under.
export const errands = table({
  label: text().was("name"),
}, { was: "chores" });

export const authors = collection({
  name: text().max(80),
  email: email().unique().max(191),
  bio: text({ multiline: true }).max(500).optional(),
  avatar: media({ accept: "image" }).optional(),
  userId: integer().optional(),
}, { storageName: "authors", label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  title: text().min(1).max(120).pattern(/\S/),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  cover: media({ accept: "image" }).optional(),
  photos: media().many().max(20).optional(),
  tags: select(["news", "guide", "release"]).many().default([]),
  kind: select(["article", "note"]).default("article"),
  authorId: ref(authors).optional(),
  // A many-ref: the related posts' ids in write order; `with: { related: true }` loads the rows.
  related: ref((): AnyCollection => posts).many().optional().reverse("relatedFrom"),
  seo: group({
    metaTitle: text().max(70).optional(),
    noindex: boolean().default(false),
  }).optional(),
  gallery: repeater({ image: media({ accept: "image" }), caption: text().max(120).optional() }).max(12).optional(),
  sections: blocks({
    hero: { heading: text().max(80), image: media({ accept: "image" }).optional() },
    quote: { text: text({ multiline: true }), cite: text().max(80).optional() },
  }).optional(),
  ...timestamps,
}, {
  title: "title",
  content: "body",
  access: {
    read: (ctx) => ctx.user && ctx.user.role !== "subscriber" ? true : { status: "published" },
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { author: { userId: ctx.user?.id ?? -1 } },
    delete: "editor",
  },
});

export const comments = table({
  postId: ref(posts).onDelete("cascade"),
  body: text({ multiline: true }).validate((v, ctx) => v.includes("http://") && ctx.user === null ? "No links" : true),
  approved: boolean().default(false),
}, { access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone" } });

export const settings = global("settings", {
  siteTitle: text().default("My blog").max(80),
  postsPerPage: integer().default(10).min(1).max(50),
  website: url().optional(),
  social: repeater({ label: text().max(40), href: url() }).optional(),
}, { label: "Site settings", access: { update: "admin" } });

export const collections = { authors, posts };
export const tables = { locations, items, shoppingList, comments };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
