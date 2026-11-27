// Fixture schema for the type tests (self-contained).
import {
  collection, f, global, table, taxonomy, type AnyCollection,
} from "spacepress";

export const UNITS = ["pcs", "g", "kg"] as const;

const timestamps = {
  createdAt: f.timestamp().defaultNow(),
  updatedAt: f.timestamp().defaultNow().onUpdate(() => new Date()),
};

export const locations = table({
  name: f.text(),
  kind: f.select(["fridge", "freezer", "pantry"]).default("pantry"),
});

export const items = table({
  name: f.text(),
  quantity: f.integer().default(1),
  unit: f.select(UNITS).default("pcs"),
  expiresOn: f.date().optional(),
  opened: f.boolean().default(false),
  locationId: f.ref(locations).optional(),
  tags: f.json<string[]>().default(() => []),
  meta: f.json().optional(),
  ...timestamps,
});

export const shoppingList = table({
  itemId: f.ref(items).unique().optional().onDelete("cascade"),
  name: f.text(),
  done: f.boolean().default(false),
});

// Aliasing: decouple TypeScript field/table names from physical SQL names with zero DDL.
export const errands = table({
  label: f.text().column("name").alias("name"),
}, { storageName: "chores" });

export const authors = collection({
  name: f.text().max(80),
  email: f.email().unique().max(191),
  bio: f.text({ multiline: true }).max(500).optional(),
  avatar: f.media({ accept: "image" }).optional(),
  userId: f.integer().optional(),
}, { storageName: "authors", label: "Authors", title: "name", access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export const posts = collection({
  title: f.text().min(1).max(120).pattern(/\S/),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  cover: f.media({ accept: "image" }).optional(),
  photos: f.media().many().max(20).optional(),
  tags: f.select(["news", "guide", "release"]).many().default([]),
  kind: f.select(["article", "note"]).default("article"),
  authorId: f.ref(authors).optional(),
  // A many-ref: the related posts' ids in write order; `with: { related: true }` loads the rows.
  related: f.ref((): AnyCollection => posts).many().optional().reverse("relatedFrom"),
  seo: f.group({
    metaTitle: f.text().max(70).optional(),
    noindex: f.boolean().default(false),
  }).optional(),
  gallery: f.repeater({ image: f.media({ accept: "image" }), caption: f.text().max(120).optional() }).max(12).optional(),
  sections: f.blocks({
    hero: { heading: f.text().max(80), image: f.media({ accept: "image" }).optional() },
    quote: { text: f.text({ multiline: true }), cite: f.text().max(80).optional() },
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
  postId: f.ref(posts).onDelete("cascade"),
  body: f.text({ multiline: true }).validate((v, ctx) => v.includes("http://") && ctx.user === null ? "No links" : true),
  approved: f.boolean().default(false),
}, { access: { read: (ctx) => ctx.user ? true : { approved: true }, create: "anyone" } });

export const settings = global({
  siteTitle: f.text().default("My blog").max(80),
  postsPerPage: f.integer().default(10).min(1).max(50),
  website: f.url().optional(),
  social: f.repeater({ label: f.text().max(40), href: f.url() }).optional(),
}, { label: "Site settings", access: { update: "admin" } });

export const topics = taxonomy({ color: f.text().optional() }, { hierarchical: true, on: [posts] });
export const labels = taxonomy();
export const notes = collection({ title: f.text(), labelIds: f.terms(labels).reverse("labelled") });

export const collections = { authors, posts, notes };
export const tables = { locations, items, shoppingList, comments };
export const users = {};
export const taxonomies = { topics, labels };
export const entities = { ...collections, ...tables, ...users, ...taxonomies };
