// The blog scenario (design §9.1): one function, driven only through the typed client, that the
// WordPress lane (tests/wp/rest.test.ts) runs against the phase-1 blog (tests/fixtures/blog). Every
// assertion is about what a client sees over HTTP.
//
// What a lane provides (BlogScenarioEnv):
//   - `client(role)`: a client signed in as that role, or anonymous for "anonymous".
//       createClient({ url, headers: { Authorization: "Basic " + btoa(`${user}:${appPassword}`) } })
//     The "author" user must own an `authors` row (its userId = that user's id): the posts.beforeCreate
//     hook links posts to it, and the posts.update rule grants authors their own posts through it.
//     `authors` is admin-only over the API, so lanes seed it with a trusted CLI insert.
//   - `promoteDue(at)`: make every scheduled row whose publishedAt <= `at` visible as published:
//     set post_date_gmt in the past via WP-CLI, `wp cron event run --due-now`.
//     May return the anonymous client to read with afterwards (default: env.client("anonymous")).
//
// Each step is a `t.test` subtest when a node:test context is passed, so failures name the step.

import assert from "node:assert/strict";
import { SpacePressError, type Client, type Media, type Post } from "../wp/app/sp/_generated/client/index.ts";

export type ScenarioRole = "anonymous" | "subscriber" | "author" | "editor" | "admin";

export interface BlogScenarioEnv {
  client(role: ScenarioRole): Client;
  promoteDue(at: string): Promise<Client | void>;
}

/** The subset of node:test's TestContext the scenario uses (so lanes can pass `t`). */
interface Steps {
  test(name: string, fn: () => Promise<void>): Promise<unknown>;
}

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Runs `fn` and returns the SpacePressError it throws; fails when it resolves or throws anything else. */
async function rejects(fn: () => Promise<unknown>, expect: { status: number; code: string; pointer?: string }): Promise<SpacePressError> {
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof SpacePressError, `expected a SpacePressError ${expect.status} ${expect.code}, got ${String(thrown)}`);
  assert.deepEqual(
    { status: thrown.status, code: thrown.code, pointer: thrown.pointer },
    { status: expect.status, code: expect.code, pointer: expect.pointer },
    thrown.detail,
  );
  assert.equal(thrown.type, "about:blank");
  return thrown;
}

/** Unique per run, so the scenario can share an app with other tests and run twice. */
const run = Date.now().toString(36);

export async function blogScenario(env: BlogScenarioEnv, t?: Steps): Promise<void> {
  const step = (name: string, fn: () => Promise<void>) => (t ? t.test(name, fn) : fn());
  const anon = env.client("anonymous");
  const author = env.client("author");
  const editor = env.client("editor");
  const subscriber = env.client("subscriber");

  const me = await author.auth.me();
  assert.ok(me, "the author client must be signed in");
  assert.equal(me.role, "author");
  assert.equal(await anon.auth.me(), null);

  let draft!: Post;
  let live!: Post;

  await step("anonymous sees published only; the author sees their draft; the editor filters by status", async () => {
    draft = await author.posts.create({ title: `Draft ${run}`, status: "draft" });
    live = await author.posts.create({ title: `Live ${run}`, tags: ["news"], excerpt: "Hello" });
    assert.deepEqual([draft.status, draft.publishedAt], ["draft", null]);
    assert.equal(live.status, "published");
    assert.ok(live.publishedAt, "published rows get publishedAt = now");
    assert.equal(live.slug, `live-${run}`, "slug derives from the title");
    assert.ok(live.authorId !== null, "beforeCreate links the signed-in user's author profile");

    const titles = (await anon.posts.list({ where: { title: { like: `%${run}` } } })).map((p) => p.title);
    assert.deepEqual(titles, [`Live ${run}`]);
    await rejects(() => anon.posts.get(draft.id), { status: 404, code: "not_found" });
    await rejects(() => subscriber.posts.get(draft.id), { status: 404, code: "not_found" });
    assert.equal((await author.posts.get(draft.id)).title, `Draft ${run}`);
    const drafts = await editor.posts.list({ status: "draft", where: { title: { like: `%${run}` } } });
    assert.deepEqual(drafts.map((p) => p.id), [draft.id]);

    // `has` on a list column, and a relation loaded with `with`.
    const news = await anon.posts.list({ where: { tags: { has: "news" }, id: live.id }, with: { authorId: true } });
    assert.equal(news.length, 1);
    assert.equal(news[0].authorId?.id, live.authorId);
  });

  await step("access: anonymous can't write; authors only update their own posts; editors update any", async () => {
    await rejects(() => anon.posts.create({ title: "x" }), { status: 401, code: "unauthenticated" });
    await rejects(() => subscriber.posts.create({ title: "x" }), { status: 403, code: "forbidden" });
    const theirs = await editor.posts.create({ title: `Editor's ${run}` });
    // The update rule is a filter for authors: someone else's post is not found, not forbidden.
    await rejects(() => author.posts.update(theirs.id, { title: "mine now" }), { status: 404, code: "not_found" });
    assert.equal((await author.posts.update(live.id, { excerpt: "Edited" })).excerpt, "Edited");
    assert.equal((await editor.posts.update(live.id, { excerpt: "By editor" })).excerpt, "By editor");
    await rejects(() => author.posts.delete(theirs.id), { status: 403, code: "forbidden" });
    assert.equal((await editor.posts.delete(theirs.id)).id, theirs.id);
  });

  await step("a scheduled post is hidden until promotion, then published", async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const scheduled = await editor.posts.create({ title: `Scheduled ${run}`, status: "scheduled", publishedAt: at });
    assert.deepEqual([scheduled.status, scheduled.publishedAt], ["scheduled", at]);
    await rejects(() => anon.posts.get(scheduled.id), { status: 404, code: "not_found" });
    await rejects(
      () => editor.posts.create({ title: "Past", status: "scheduled", publishedAt: "2000-01-01T00:00:00.000Z" }),
      { status: 422, code: "invalid_input", pointer: "/publishedAt" },
    );
    // An explicit "published" stays published with a future date: only "scheduled" schedules.
    const dated = await editor.posts.create({ title: `Dated ${run}`, status: "published", publishedAt: at });
    assert.deepEqual([dated.status, dated.publishedAt], ["published", at]);
    const redated = await editor.posts.update(dated.id, { title: `Dated ${run} v2` });
    assert.deepEqual([redated.status, redated.publishedAt], ["published", at]);
    assert.equal((await anon.posts.get(dated.id)).title, `Dated ${run} v2`);

    const reader = (await env.promoteDue(at)) ?? anon;
    const seen = await reader.posts.get(scheduled.id);
    assert.deepEqual([seen.status, seen.publishedAt], ["published", at]);
  });

  await step("revisions list, read and restore through the update pipeline", async () => {
    const p = await author.posts.create({ title: `SpacePress ${run}` });
    await author.posts.update(p.id, { title: `Second ${run}` });
    const revs = await author.posts.revisions.list(p.id);
    assert.ok(revs.length >= 2, `expected ≥ 2 revisions, got ${revs.length}`);
    assert.equal(revs[0].user?.id, me.id, "newest first, attributed to the writer");
    const oldest = revs[revs.length - 1];
    assert.equal((await author.posts.revisions.get(p.id, oldest.id)).title, `SpacePress ${run}`);
    const restored = await author.posts.revisions.restore(p.id, oldest.id);
    assert.deepEqual([restored.title, restored.slug], [`SpacePress ${run}`, p.slug], "the slug is the row's, not the revision post's");
    assert.equal((await author.posts.get(p.id)).title, `SpacePress ${run}`);
    assert.equal((await author.posts.revisions.list(p.id)).length, revs.length + 1, "the restore is itself a revision");
    // Revisions need `update` access; posts' update rule is a filter for non-staff, so a reader
    // outside it gets 404 (existence never leaks, §1.6), not 401/403.
    await rejects(() => anon.posts.revisions.list(p.id), { status: 404, code: "not_found" });
  });

  await step("media upload, referenced by a post, populated in place with `with`", async () => {
    const png = Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0));
    const file = new Blob([png], { type: "image/png" });
    await rejects(() => anon.media.upload(file, { filename: "pixel.png" }), { status: 401, code: "unauthenticated" });
    const media: Media = await author.media.upload(file, { alt: "A pixel", filename: "pixel.png" });
    assert.deepEqual([media.mime, media.width, media.height, media.alt], ["image/png", 1, 1, "A pixel"]);
    assert.deepEqual(await anon.media.get(media.id), media);

    const post = await author.posts.create({ title: `Cover ${run}`, cover: media.id });
    assert.equal(post.cover, media.id);
    const withCover = await anon.posts.get(post.id, { with: { cover: true } });
    assert.deepEqual(withCover.cover, media);
    const listed = await anon.posts.list({ where: { id: post.id }, with: { cover: true, authorId: true } });
    assert.equal(listed[0].cover?.url, media.url);
  });

  await step("comments: anonymous create, approval via the action, staff comments approved on sight", async () => {
    const c = await anon.comments.create({ postId: live.id, name: "Visitor", body: "Lovely" });
    assert.equal(c.approved, false);
    assert.deepEqual((await anon.posts.get(live.id, { with: { comments: true } })).comments, []);
    await rejects(() => author.actions.approveComment({ id: c.id }), { status: 403, code: "forbidden" });
    assert.equal((await editor.actions.approveComment({ id: c.id })).approved, true);
    assert.deepEqual((await anon.posts.get(live.id, { with: { comments: true } })).comments.map((x) => x.id), [c.id]);

    const staff = await author.comments.create({ postId: live.id, name: "Alice", body: "Thanks!" });
    assert.equal((await editor.comments.get(staff.id)).approved, true, "afterCreate approves comments by non-subscribers");
    await rejects(() => editor.actions.approveComment({ id: 999_999_999 }), { status: 404, code: "not_found" });

    const { count } = await anon.actions.publishedCount();
    assert.ok(count >= 1);
  });

  await step("validation problems carry a code and a pointer", async () => {
    const bad = await rejects(
      () => editor.posts.create({ title: "Bad", sections: [{ layout: "quote", text: "ok" }, { layout: "hero", heading: "x".repeat(81) }] }),
      { status: 422, code: "invalid_input", pointer: "/sections/1/heading" },
    );
    assert.equal(bad.title, "Invalid input");
    await rejects(() => anon.comments.create({ postId: live.id, name: "S", body: "see http://spam" }), {
      status: 422, code: "invalid_input", pointer: "/body",
    });
    await rejects(() => editor.posts.create({ title: "" }), { status: 422, code: "invalid_input", pointer: "/title" });
    await rejects(() => editor.posts.create({ title: "x", gallery: Array.from({ length: 13 }, () => ({ image: 1 })) }), {
      status: 422, code: "invalid_input", pointer: "/gallery",
    });
  });

  await step("globals: defaults before the first write, editors update, others can't", async () => {
    const before = await anon.globals.settings.get();
    assert.equal(before.siteTitle.length > 0, true);
    await rejects(() => author.globals.settings.update({ tagline: "x" }), { status: 403, code: "forbidden" });
    const updated = await editor.globals.settings.update({ tagline: `Notes ${run}`, social: [{ label: "Site", href: "https://example.com" }] });
    assert.equal(updated.tagline, `Notes ${run}`);
    assert.deepEqual(await anon.globals.settings.get(), updated);
    await rejects(() => editor.globals.settings.update({ postsPerPage: 99 }), { status: 422, code: "invalid_input", pointer: "/postsPerPage" });
  });
}
