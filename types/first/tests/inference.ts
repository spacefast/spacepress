// Positive checks: inferred types are exactly what the spec says.
import {
  action, db, defineConfig, integer, text, job, email,
  type AccessCtx, type BlockValue, type BeforeHookCtx, type HookCtx, type InferInsertModel, type InferSelectModel, type User, type ValidateCtx,
} from "first";
import { authors, comments, items, locations, notes, posts, entities, settings, shoppingList } from "./schema";
import type { AppRelations } from "./register";

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

// v1 builders (design §1.1)
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
type Hero = Extract<BlockValue<{ hero: { heading: ReturnType<typeof text> } }>, { layout: "hero" }>;
expectType<Equal<Hero, { layout: "hero"; heading: string }>>();

// Collections gain status/publishedAt; tables don't.
expectType<Equal<Post["status"], "draft" | "published" | "scheduled">>();
expectType<Equal<Post["publishedAt"], string | null>>();
expectType<Equal<Author["status"], "draft" | "published" | "scheduled">>();
expectType<Equal<keyof Comment, "id" | "postId" | "body" | "approved">>();
expectType<Equal<"status" extends keyof Item ? true : false, false>>();
// title is required; slug({ source }) derives, so it's optional; status defaults to published.
expectType<Equal<RequiredKeys<InferInsertModel<typeof posts>>, "title">>();

// Globals read every field (defaults applied), update any subset.
expectType<Equal<(typeof settings)["$inferSelect"], { siteTitle: string; postsPerPage: number; website: string | null; social: { label: string; href: string }[] | null }>>();
expectType<Equal<(typeof settings)["$inferUpdate"]["postsPerPage"], number | undefined>>();

async function queries() {
  // A loaded `ref()` field holds the row in place of its id; without `with` it holds the id.
  const withLocation = await db.query.items.findMany({ with: { locationId: true } });
  expectType<Equal<(typeof withLocation)[number]["locationId"], Location | null>>();
  const plain = await db.query.items.findFirst();
  expectType<Equal<NonNullable<typeof plain>["locationId"], number | null>>();

  // A many-ref holds its ids; `with` loads the rows in their place; filters take `has` or the rows'.
  const post = await db.query.posts.findFirst({ where: { related: { has: 3 } } });
  expectType<Equal<NonNullable<typeof post>["related"], number[] | null>>();
  const withRelated = await db.query.posts.findFirst({
    where: { related: { title: "x" }, relatedFrom: { status: "published" } },
    with: { related: { columns: { title: true }, limit: 3 }, relatedFrom: true },
  });
  expectType<Equal<NonNullable<typeof withRelated>["related"], { title: string }[]>>();
  expectType<Equal<NonNullable<typeof withRelated>["relatedFrom"][number]["related"], number[] | null>>();
  await db.update(posts).set({ related: [1, 2] }).where({ id: 1 });

  // A term row (ruling 27): its own fields and the authored ones; `with` both ways (ruling 28).
  const topic = await db.query.topics.findFirst({ where: { posts: { title: "x" } }, with: { posts: { columns: { title: true } } } });
  expectType<Equal<NonNullable<typeof topic>["name"], string>>();
  expectType<Equal<NonNullable<typeof topic>["slug"], string>>();
  expectType<Equal<NonNullable<typeof topic>["parent"], number | null>>();
  expectType<Equal<NonNullable<typeof topic>["count"], number>>();
  expectType<Equal<NonNullable<typeof topic>["url"], string | null>>();
  expectType<Equal<NonNullable<typeof topic>["color"], string | null>>();
  expectType<Equal<NonNullable<typeof topic>["posts"], { title: string }[]>>();
  const label = await db.query.labels.findFirst();
  expectType<Equal<"parent" extends keyof NonNullable<typeof label> ? true : false, false>>();
  // The item field is the term ids; `with` puts the term rows in their place.
  const tagged = await db.query.notes.findFirst({ where: { labelIds: { has: 2 } } });
  expectType<Equal<NonNullable<typeof tagged>["labelIds"], number[]>>();
  const withTerms = await db.query.notes.findFirst({ with: { labelIds: { columns: { name: true } } } });
  expectType<Equal<NonNullable<typeof withTerms>["labelIds"], { name: string }[]>>();
  await db.insert(notes).values({ title: "n" });
  await db.update(notes).set({ labelIds: [1, 2] }).where({ id: 1 });

  // A required ref -> not nullable once loaded.
  const comment = await db.query.comments.findFirst({ with: { postId: true } });
  expectType<Equal<NonNullable<typeof comment>["postId"]["id"], number>>();

  // columns pick + nested with
  const loc = await db.query.locations.findFirst({
    columns: { name: true },
    with: { items: { columns: { id: true }, with: { locationId: true }, limit: 5 } },
  });
  expectType<Equal<typeof loc, { name: string; items: { id: number; locationId: Location | null }[] } | undefined>>();

  // columns omit
  const lists = await db.query.shoppingList.findMany({
    columns: { done: false },
    where: { itemId: { locationId: { kind: "fridge" } }, OR: [{ done: true }, { itemId: 3 }, { itemId: { in: [1, 2] } }] },
    orderBy: { name: "asc" },
  });
  expectType<Equal<keyof (typeof lists)[number], "id" | "itemId" | "name">>();

  const inserted = await db.insert(items).values([{ name: "a" }, { name: "b", unit: "kg" }]).returning();
  expectType<Equal<typeof inserted, Item[]>>();
  const updated = await db.update(items).set({ quantity: 2 }).where({ id: { in: [1, 2] } }).returning();
  expectType<Equal<typeof updated, Item[]>>();
  await db.delete(shoppingList).where({ done: true, itemId: { isNull: true } });

  // `has` on list columns; JSON-valued columns compare whole values; trusted reads see every status.
  const news = await db.query.posts.findMany({
    where: { tags: { has: "news" }, photos: { isNull: true }, seo: { isNotNull: true }, status: { in: ["draft", "scheduled"] } },
    orderBy: { publishedAt: "desc" },
    with: { authorId: true },
  });
  expectType<Equal<(typeof news)[number]["authorId"], Author | null>>();
  await db.update(posts).set({ status: "published", sections: [{ layout: "quote", text: "hi" }] }).where({ tags: { eq: [] } });

  // db.globals is typed from the registration first build writes (./register.ts).
  const s = await db.globals.settings.get();
  expectType<Equal<typeof s.postsPerPage, number>>();
  await db.globals.settings.update({ postsPerPage: 20 });
}

// Access rule functions see a typed ctx; read/update may return filters (with relation keys).
type PostAccess = NonNullable<NonNullable<Parameters<typeof import("first").collection>[1]>["access"]>;
declare const accessCtx: AccessCtx<Partial<InferInsertModel<typeof posts>>>;
expectType<Equal<typeof accessCtx.user, User | null>>();
expectType<Equal<typeof accessCtx.op, "read" | "create" | "update" | "delete">>();
expectType<Equal<NonNullable<typeof accessCtx.data>["status"], "draft" | "published" | "scheduled" | undefined>>();
void (0 as unknown as PostAccess);
declare const vctx: ValidateCtx;
expectType<Equal<typeof vctx.user, User | null>>();

export const sendWelcome = job({ input: { email: email(), name: text().default("world") }, handler: async (input, ctx) => { expectType<Equal<typeof input.name, string>>(); void [input.email, ctx.attempt, ctx.jobId]; } });

// Hooks are declared on the kind (spec §2.8); each handler is typed by its own kind.
posts.on({
  // Hooks get a trailing ctx: who's writing, and where.
  async beforeCreate(data, ctx) {
    expectType<Equal<typeof ctx, BeforeHookCtx<typeof data>>>();
    expectType<Equal<typeof ctx.data, typeof data>>();
    if (data.authorId == null && ctx.user) {
      const author = await db.query.authors.findFirst({ where: { userId: ctx.user.id } });
      if (author) data.authorId = author.id;
    }
  },
  afterUpdate(row, previous, ctx) {
    expectType<Equal<[typeof row, typeof previous], [Post, Post]>>();
    if (previous.status !== "published" && row.status === "published") void ctx.user;
  },
});
items.on({
  beforeCreate(data) {
    expectType<Equal<typeof data, ItemInsert>>();
    data.name = data.name.trim();
  },
  async beforeUpdate(patch, existing) {
    expectType<Equal<typeof patch, Partial<ItemInsert>>>();
    return { ...patch, name: existing.name };
  },
  afterUpdate(row, previous) {
    expectType<Equal<typeof row | typeof previous, Item>>();
  },
});

export const consume = action({
  input: { itemId: integer(), amount: integer().default(1).optional(), note: text().optional() },
  handler(input) {
    expectType<Equal<typeof input, { itemId: number; amount: number | null; note?: string | null }>>();
    return input.itemId;
  },
});
export const whoami = action({
  input: {},
  access: (ctx) => ctx.user !== null,
  handler(_input, ctx) {
    expectType<Equal<typeof ctx, HookCtx>>();
    return ctx.user?.name ?? "anonymous";
  },
});
export const publish = action({ input: { id: integer() }, access: "editor", handler: ({ id }) => id });

export default defineConfig({
  locales: { default: "en", all: ["en", "de"] },
  name: "fixture",
});
void queries;
