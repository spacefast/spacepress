// Positive checks: inferred types are exactly what the 1.0 spec says.
import { defineConfig, f, job, mutation, type AccessCtx, type BlockValue, type InferInsertModel, type InferSelectModel, type MutationCtx, type User, type ValidateCtx } from "spacepress";
import { db } from "spacepress/server";
import { authors, comments, items, locations, notes, posts, settings, shoppingList } from "./schema";

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
export declare function expectType<T extends true>(): void;

type Item = InferSelectModel<typeof items>;
type Location = InferSelectModel<typeof locations>;
type ItemInsert = InferInsertModel<typeof items>;
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];

// Select types
expectType<Equal<Item["id"], number>>();
expectType<Equal<Item["unit"], "pcs" | "g" | "kg">>();
expectType<Equal<Location["kind"], "fridge" | "freezer" | "pantry">>();
expectType<Equal<Item["expiresOn"], string | null>>();
expectType<Equal<Item["createdAt"], string>>();
expectType<Equal<Item["opened"], boolean>>();
expectType<Equal<Item["tags"], string[]>>();
expectType<Equal<Item["meta"], unknown>>();
expectType<Equal<Item["locationId"], number | null>>();
expectType<Equal<Item, (typeof items)["$inferSelect"]>>();

// Insert types: only NOT NULL columns without a default are required
expectType<Equal<RequiredKeys<ItemInsert>, "name">>();
expectType<Equal<keyof ItemInsert, keyof Item>>();

// Field builders
type Post = InferSelectModel<typeof posts>;
type Author = InferSelectModel<typeof authors>;
type Comment = InferSelectModel<typeof comments>;
expectType<Equal<Author["email"], string>>();
expectType<Equal<Author["bio"], string | null>>();
expectType<Equal<Author["avatar"], number | null>>();
expectType<Equal<Post["slug"], string | null>>();
expectType<Equal<Post["body"], string | null>>();
expectType<Equal<Post["photos"], number[] | null>>();
expectType<Equal<Post["tags"], ("news" | "guide" | "release")[]>>();
expectType<Equal<Post["kind"], "article" | "note">>();
expectType<Equal<Post["seo"], { metaTitle: string | null; noindex: boolean } | null>>();
expectType<Equal<Post["gallery"], { image: number; caption: string | null }[] | null>>();
expectType<
  Equal<Post["sections"], ({ layout: "hero"; heading: string; image: number | null } | { layout: "quote"; text: string; cite: string | null })[] | null>
>();
type Hero = Extract<BlockValue<{ hero: { heading: ReturnType<typeof f.text> } }>, { layout: "hero" }>;
expectType<Equal<Hero, { layout: "hero"; heading: string }>>();

// Collections gain status/publishedAt; tables don't.
expectType<Equal<Post["status"], "draft" | "published" | "scheduled">>();
expectType<Equal<Post["publishedAt"], string | null>>();
expectType<Equal<Author["status"], "draft" | "published" | "scheduled">>();
expectType<Equal<keyof Comment, "id" | "postId" | "body" | "approved" | "author" | "createdAt" | "updatedAt" | "deletedAt" | "deletedBy">>();
expectType<Equal<"status" extends keyof Item ? true : false, false>>();
// title is required; slug({ source }) derives, so it's optional; status defaults to published.
expectType<Equal<RequiredKeys<InferInsertModel<typeof posts>>, "title">>();

// Globals read every field (defaults applied), update any subset.
expectType<Equal<(typeof settings)["$inferSelect"], { siteTitle: string; postsPerPage: number; website: string | null; social: { label: string; href: string }[] | null }>>();
expectType<Equal<(typeof settings)["$inferUpdate"]["postsPerPage"], number | undefined>>();

async function queries() {
  // A loaded `f.ref()` field holds the row in place of its id; without `with` it holds the id.
  const withLocation = await db.items.list({ with: { locationId: true } });
  expectType<Equal<(typeof withLocation)[number]["locationId"], Location | null>>();
  const plain = await db.items.get(1);
  expectType<Equal<NonNullable<typeof plain>["locationId"], number | null>>();

  // A many-ref holds its ids; `with` loads the rows in their place; filters take `has` or the rows'.
  const post = await db.posts.get({ related: { has: 3 } });
  expectType<Equal<NonNullable<typeof post>["related"], number[] | null>>();
  const withRelated = await db.posts.get(
    { related: { title: "x" }, relatedFrom: { status: "published" } },
    { with: { related: { columns: { title: true }, limit: 3 }, relatedFrom: true } },
  );
  expectType<Equal<NonNullable<typeof withRelated>["related"], { title: string }[]>>();
  expectType<Equal<NonNullable<typeof withRelated>["relatedFrom"][number]["related"], number[] | null>>();
  await db.posts.update(1, { related: [1, 2] });

  // A term row: its own fields and the authored ones; `with` both ways.
  const topic = await db.topics.get({ posts: { title: "x" } }, { with: { posts: { columns: { title: true } } } });
  expectType<Equal<NonNullable<typeof topic>["name"], string>>();
  expectType<Equal<NonNullable<typeof topic>["slug"], string>>();
  expectType<Equal<NonNullable<typeof topic>["parent"], number | null>>();
  expectType<Equal<NonNullable<typeof topic>["count"], number>>();
  expectType<Equal<NonNullable<typeof topic>["url"], string | null>>();
  expectType<Equal<NonNullable<typeof topic>["color"], string | null>>();
  expectType<Equal<NonNullable<typeof topic>["posts"], { title: string }[]>>();
  const label = await db.labels.get(1);
  expectType<Equal<"parent" extends keyof NonNullable<typeof label> ? true : false, false>>();
  // The item field is the term ids; `with` puts the term rows in their place.
  const tagged = await db.notes.get({ labelIds: { has: 2 } });
  expectType<Equal<NonNullable<typeof tagged>["labelIds"], number[]>>();
  const withTerms = await db.notes.get(1, { with: { labelIds: { columns: { name: true } } } });
  expectType<Equal<NonNullable<typeof withTerms>["labelIds"], { name: string }[]>>();
  await db.notes.create({ title: "n" });
  await db.notes.update(1, { labelIds: [1, 2] });

  // A required ref -> not nullable once loaded.
  const comment = await db.comments.get(1, { with: { postId: true } });
  expectType<Equal<NonNullable<typeof comment>["postId"]["id"], number>>();

  // columns pick + nested with
  const loc = await db.locations.get(1, {
    columns: { name: true },
    with: { items: { columns: { id: true }, with: { locationId: true }, limit: 5 } },
  });
  expectType<Equal<typeof loc, { name: string; items: { id: number; locationId: Location | null }[] } | null>>();

  // columns omit
  const lists = await db.shoppingList.list({
    columns: { done: false },
    where: { itemId: { locationId: { kind: "fridge" } }, OR: [{ done: true }, { itemId: 3 }, { itemId: { in: [1, 2] } }] },
    orderBy: { name: "asc" },
  });
  expectType<Equal<keyof (typeof lists)[number], "id" | "itemId" | "name" | "author" | "createdAt" | "updatedAt" | "deletedAt" | "deletedBy">>();

  const inserted = await db.items.create({ name: "a" });
  expectType<Equal<typeof inserted, Item>>();
  const updated = await db.items.update(1, { quantity: 2 });
  expectType<Equal<typeof updated, Item>>();
  await db.shoppingList.delete(1);

  // `has` on list columns; JSON-valued columns compare whole values; system reads see every status.
  const news = await db.system.posts.list({
    where: { tags: { has: "news" }, photos: { isNull: true }, seo: { isNotNull: true }, status: { in: ["draft", "scheduled"] } },
    orderBy: { publishedAt: "desc" },
    with: { authorId: true },
  });
  expectType<Equal<(typeof news)[number]["authorId"], Author | null>>();
  await db.posts.update(1, { status: "published", sections: [{ layout: "quote", text: "hi" }] });

  // Flattened globals on db.
  const s = await db.settings.get();
  expectType<Equal<typeof s.postsPerPage, number>>();
  await db.settings.update({ postsPerPage: 20 });
}

// Access rule functions see a typed ctx; read/update may return filters (with relation keys).
type PostAccess = NonNullable<NonNullable<Parameters<typeof import("spacepress").collection>[1]>["access"]>;
declare const accessCtx: AccessCtx<Partial<InferInsertModel<typeof posts>>>;
expectType<Equal<typeof accessCtx.user, User | null>>();
expectType<Equal<typeof accessCtx.op, "read" | "create" | "update" | "delete" | "restore" | "purge">>();
expectType<Equal<NonNullable<typeof accessCtx.data>["status"], "draft" | "published" | "scheduled" | undefined>>();
void (0 as unknown as PostAccess);
declare const vctx: ValidateCtx;
expectType<Equal<typeof vctx.user, User | null>>();

export const sendWelcome = job({}, async (ctx, input: { email: string; name?: string }) => {
  expectType<Equal<typeof input.name, string | undefined>>();
  void [input.email, ctx.attempt, ctx.jobId];
});
expectType<Equal<Parameters<typeof sendWelcome.enqueue>[0], { email: string; name?: string }>>();

// Hooks are declared on the kind; each handler takes an object ctx typed by its own kind.
posts.on({
  async beforeCreate({ data, user, db: hdb }) {
    if (data.authorId == null && user) {
      const author = await hdb.authors.get({ userId: user.id });
      if (author) data.authorId = author.id;
    }
  },
  afterUpdate({ row, previous, user }) {
    expectType<Equal<[typeof row, typeof previous], [Post, Post]>>();
    if (previous.status !== "published" && row.status === "published") void user;
  },
});
items.on({
  beforeCreate({ data }) {
    expectType<Equal<typeof data, ItemInsert>>();
    data.name = data.name.trim();
  },
  async beforeUpdate({ patch, existing }) {
    expectType<Equal<typeof patch, Partial<ItemInsert>>>();
    return { ...patch, name: existing.name };
  },
  afterUpdate({ row, previous }) {
    expectType<Equal<typeof row | typeof previous, Item>>();
  },
});

export const consume = mutation({}, (_ctx, { itemId, amount = 1 }: { itemId: number; amount?: number; note?: string }) => {
  expectType<Equal<typeof amount, number>>();
  return itemId * amount;
});
// The client calls a function with its handler's input type and gets its result.
expectType<Equal<Parameters<typeof consume>[0], { itemId: number; amount?: number; note?: string }>>();
expectType<Equal<Awaited<ReturnType<typeof consume>>, number>>();
export const whoami = mutation({ access: (ctx) => ctx.user !== null }, (ctx, _input: {}) => {
  expectType<Equal<typeof ctx, MutationCtx>>();
  return ctx.user?.name ?? "anonymous";
});
export const publish = mutation({ access: "editor" }, (_ctx, { id }: { id: number }) => id);

export default defineConfig({
  locales: { default: "en", all: ["en", "de"] },
  name: "fixture",
});
void queries;
