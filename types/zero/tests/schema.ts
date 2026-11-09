// Fixture schema for the type tests (self-contained). `locations`/`items`/`shoppingList` mirror the
// pantry example (custom tables: `table()`); `authors`/`posts`/`comments`/`settings` mirror the
// blog example (design §1.9) and carry the v1 additions.
import {
  blocks, boolean, collection, date, defineRelations, email, global, group, id, integer, json, media,
  repeater, richText, select, slug, text, timestamp, url,
  table,
} from "zero";

export const UNITS = ["pcs", "g", "kg"] as const;

const timestamps = {
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
};

export const locations = table({
  id: id(),
  name: text().notNull(),
  kind: text({ enum: ["fridge", "freezer", "pantry"] }).notNull().default("pantry"),
});

export const items = table({
  id: id(),
  name: text().notNull(),
  quantity: integer().notNull().default(1),
  unit: text({ enum: UNITS }).notNull().default("pcs"),
  expiresOn: date(),
  opened: boolean().notNull().default(false),
  locationId: integer().references(() => locations.id, { onDelete: "set null" }),
  tags: json().$type<string[]>().notNull().$default(() => []),
  meta: json(),
  ...timestamps,
});

export const shoppingList = table({
  id: id(),
  itemId: integer().references(() => items.id, { onDelete: "cascade" }).unique(),
  name: text().notNull(),
  done: boolean().notNull().default(false),
});

// Renames (spec §2.5, §2.6): a field and a table declare the names they were stored under.
export const errands = table({
  id: id(),
  label: text().notNull().was("name"),
}, { was: "chores" });

export const authors = collection({
  id: id(),
  name: text().notNull().max(80),
  email: email().notNull().unique().max(191),
  bio: text({ multiline: true }).max(500),
  avatar: media({ accept: "image" }),
  userId: integer(),
}, { storageName: "authors", label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  id: id(),
  title: text().notNull().min(1).max(120).pattern(/\S/),
  slug: slug({ source: "title" }),
  body: richText(),
  cover: media({ accept: "image" }),
  photos: media({ multiple: true }).max(20),
  tags: select({ options: ["news", "guide", "release"], multiple: true }).notNull().default([]),
  kind: select({ options: ["article", "note"] }).notNull().default("article"),
  authorId: integer().references(() => authors.id, { onDelete: "set null" }),
  seo: group({ fields: {
    metaTitle: text().max(70),
    noindex: boolean().notNull().default(false),
  } }),
  gallery: repeater({ fields: { image: media({ accept: "image" }).notNull(), caption: text().max(120) } }).max(12),
  sections: blocks({ layouts: {
    hero: { heading: text().notNull().max(80), image: media({ accept: "image" }) },
    quote: { text: text({ multiline: true }).notNull(), cite: text().max(80) },
  } }),
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
  id: id(),
  postId: integer().notNull().references(() => posts.id, { onDelete: "cascade" }),
  body: text({ multiline: true }).notNull().validate((v, ctx) => v.includes("http://") && ctx.user === null ? "No links" : true),
  approved: boolean().notNull().default(false),
}, { access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone" } });

export const settings = global("settings", {
  siteTitle: text().notNull().default("My blog").max(80),
  postsPerPage: integer().notNull().default(10).min(1).max(50),
  website: url(),
  social: repeater({ fields: { label: text().notNull().max(40), href: url().notNull() } }),
}, { label: "Site settings", access: { update: "admin" } });

export const collections = { authors, posts };
export const tables = { locations, items, shoppingList, comments };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };

export const relations = defineRelations(entities, (r) => ({
  items: { location: r.one.locations({ from: r.items.locationId, to: r.locations.id }) },
  locations: { items: r.many.items() },
  shoppingList: {
    item: r.one.items({ from: r.shoppingList.itemId, to: r.items.id, optional: false }),
  },
  posts: { author: r.one.authors({ from: r.posts.authorId, to: r.authors.id }), comments: r.many.comments() },
  authors: { posts: r.many.posts() },
  comments: { post: r.one.posts({ from: r.comments.postId, to: r.posts.id, optional: false }) },
}));
