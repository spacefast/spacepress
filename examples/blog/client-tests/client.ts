// The typed client over the generated zero/_generated/client/types.ts + schema.ts (design §7):
// positive checks that results carry the shapes `with` asks for, and one @ts-expect-error per real mistake.
import {
  createClient, ZeroError,
  type Author, type Comment, type Media, type Post, type RevisionSummary, type Settings, type User,
} from "../zero/_generated/client/index.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function expectType<T extends true>(): void;
type Flat<T> = { [K in keyof T]: T[K] } & {};

const zero = createClient();
createClient({ url: "https://x.test/wp-json/zero/v1", nonce: "abc" });
createClient({ headers: { Authorization: "Basic " + btoa("admin:app pass") } });

async function reads() {
  const plain = await zero.posts.list();
  expectType<Equal<typeof plain, Post[]>>();

  // one (optional) → row | null; many → rows; media columns populate in place.
  const withAuthor = await zero.posts.list({ with: { author: true } });
  expectType<Equal<Flat<(typeof withAuthor)[number]>, Flat<Post & { author: Author | null }>>>();

  const post = await zero.posts.get(1, { with: { cover: true, comments: true } });
  expectType<Equal<Flat<typeof post>, Flat<Omit<Post, "cover"> & { cover: Media | null; comments: Comment[] }>>>();

  // optional: false → never null; nested with recurses.
  const comments = await zero.comments.list({ with: { post: { with: { author: true }, limit: 1 } } });
  expectType<Equal<(typeof comments)[number]["post"]["author"], Author | null>>();

  // Filters: operators per column kind, `has` on list columns, relation filters; orderBy object or wire string.
  await zero.posts.list({
    where: { tags: { has: "news" }, title: { ilike: "%zero%" }, author: { userId: 3 }, OR: [{ status: "draft" }, { publishedAt: { gte: "2026-01-01" } }] },
    orderBy: { createdAt: "desc" },
    limit: 10,
    offset: 20,
  });
  await zero.posts.list({ orderBy: "-createdAt,title", status: "draft" });

  const revs = await zero.posts.revisions.list(1);
  expectType<Equal<typeof revs, RevisionSummary[]>>();
  expectType<Equal<Awaited<ReturnType<typeof zero.posts.revisions.restore>>, Post>>();
  expectType<Equal<Awaited<ReturnType<typeof zero.auth.me>>, User | null>>();
}

async function writes() {
  const created = await zero.posts.create({ title: "Hello", tags: ["news"], sections: [{ layout: "quote", text: "hi" }] });
  expectType<Equal<typeof created, Post>>();
  const updated = await zero.comments.update(created.id, { approved: true });
  expectType<Equal<typeof updated, Comment>>();

  const approved = await zero.actions.approveComment({ id: 1 });
  expectType<Equal<typeof approved, Comment>>();
  const count = await zero.actions.publishedCount();
  expectType<Equal<typeof count, { count: number }>>();

  const settings = await zero.globals.settings.update({ tagline: null });
  expectType<Equal<typeof settings, Settings>>();

  const media = await zero.media.upload(new Blob(["x"], { type: "image/png" }), { alt: "pixel", filename: "p.png" });
  expectType<Equal<typeof media, Media>>();

  try {
    await zero.posts.create({ title: "" });
  } catch (e) {
    if (e instanceof ZeroError) {
      expectType<Equal<[typeof e.status, typeof e.code, typeof e.pointer], [number, string, string | undefined]>>();
    }
  }
}

async function mistakes() {
  // @ts-expect-error posts have no `autor` relation
  await zero.posts.list({ with: { autor: true } });
  // @ts-expect-error a relation not loaded via `with` isn't on the row
  (await zero.posts.get(1)).author;
  // @ts-expect-error `has` is for list columns; title is a scalar
  await zero.posts.list({ where: { title: { has: "x" } } });
  // @ts-expect-error "blog" is not one of the tag options
  await zero.posts.list({ where: { tags: { has: "blog" } } });
  // @ts-expect-error `title` is required on create
  await zero.posts.create({ excerpt: "no title" });
  // @ts-expect-error blocks items are discriminated by layout: a hero has no `text`
  await zero.posts.create({ title: "x", sections: [{ layout: "hero", text: "quote text" }] });
  // @ts-expect-error status is "draft" | "published" | "scheduled"
  await zero.posts.update(1, { status: "archived" });
  // @ts-expect-error comments have no drafts, so no `status` shorthand
  await zero.comments.list({ status: "draft" });
  // @ts-expect-error approveComment needs `{ id }`
  await zero.actions.approveComment();
  // @ts-expect-error there is no `rejectComment` action
  await zero.actions.rejectComment({ id: 1 });
  // @ts-expect-error postsPerPage is a number
  await zero.globals.settings.update({ postsPerPage: "10" });
  // @ts-expect-error ids are numbers
  await zero.posts.get("1");
  // @ts-expect-error media columns populate with `true` only
  await zero.posts.list({ with: { cover: { limit: 1 } } });
}

void reads; void writes; void mistakes;
