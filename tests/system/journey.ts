// The system journey: one publication site (examples/site) from first post to plugin upgrade, driven
// only through the generated typed client. tests/system/wp.test.ts runs it on a WordPress built from
// the installed wp-content artifact.
//
// What the lane provides (SiteJourneyEnv):
//   origin              the site's origin, for media URLs returned relative.
//   client(role)        a client signed in as that role ("anonymous" = no credentials). The "author"
//                       user owns `authorId` (an authors row whose userId is that user).
//   editor              how an editor builds a post: through core /wp/v2 (media library + the block
//                       editor's REST save with SCF `acf` fields), exactly as wp-admin does.
//   runJobs()           run every due background job (Action Scheduler's queue runner, as cron would).
//   runRetries()        run every failed job's pending retry now instead of after its backoff.
//   sync(dir)           run `first sync` for posts between `dir` and the site, as the editor.
//   deliveries          the signed webhooks the site's moderation tool (project.ts `receiver`) got.
//   promoteDue(at)      publish the post scheduled for `at` (its cron event); may return the client to read with.
//   upgrade()           rebuild the app with project.ts's additive `upgrade`, install it, prove the
//                       migration ran, and return clients for the new build.
//   signIn(email, pw)   a reader signs in (the first-identity screens' authorization-code flow,
//                       finished by the client's own handleCallback()) and gets a client holding that session.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FirstError, type Client, type PostInsert } from "../../examples/site/first/_generated/client/index.ts";
import { pngCentre, splitPng, type Delivery } from "./project.ts";

export type Role = "anonymous" | "subscriber" | "author" | "editor" | "admin";

/** The fields an editor fills in on the post screen. */
export type EditorPost = Required<Pick<PostInsert, "title" | "body" | "dek" | "cover" | "manuscript" | "topics" | "featured" | "authorId" | "seo" | "related" | "sections">>;

export interface EditorSurface {
  upload(bytes: Uint8Array, mime: string, filename: string, alt: string): Promise<number>;
  saveDraft(post: EditorPost): Promise<number>;
  publish(id: number): Promise<void>;
}

/** The slice of the upgraded build's client the journey uses (its types are generated at run time). */
export interface UpgradedClient {
  posts: {
    get(id: number): Promise<{ id: number; title: string; dek: string | null; readingMinutes: number | null }>;
    update(id: number, patch: { readingMinutes: number }): Promise<{ readingMinutes: number | null }>;
  };
  comments: { get(id: number): Promise<{ id: number; body: string; pinned: boolean }> };
  globals: { settings: { get(): Promise<{ tagline: string | null }> } };
}

export interface SiteJourneyEnv {
  origin: string;
  client(role: Role): Client;
  authorId: number;
  editor: EditorSurface;
  promoteDue(at: string): Promise<Client | void>;
  runJobs(): Promise<void>;
  runRetries(): Promise<void>;
  sync(dir: string): { applied: number; conflicts: unknown[]; refused: string[] };
  deliveries(): Delivery[];
  upgrade(): Promise<(role: Role) => UpgradedClient>;
  signIn(email: string, password: string): Promise<Client>;
}

interface Steps {
  test(name: string, fn: () => Promise<void>): Promise<unknown>;
}

const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

/**
 * The FirstError `fn` throws; fails when it resolves or throws anything else. Matched by name, since
 * the upgraded build's client is a second copy of the module with its own FirstError class.
 */
export async function rejects(fn: () => Promise<unknown>, expect: { status: number; code: string; pointer?: string }): Promise<FirstError> {
  let thrown: unknown;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof Error && thrown.name === FirstError.name, `expected FirstError ${expect.status} ${expect.code}, got ${String(thrown)}`);
  assert.ok(thrown instanceof Error && "status" in thrown && "code" in thrown && "detail" in thrown);
  const problem = thrown as FirstError;
  assert.deepEqual({ status: problem.status, code: problem.code, pointer: problem.pointer }, { pointer: undefined, ...expect }, problem.detail);
  return problem;
}

/** Whole seconds, as both targets store post dates. */
const isoSeconds = (ms: number) => new Date(Math.ceil(ms / 1000) * 1000).toISOString();

export async function siteJourney(env: SiteJourneyEnv, t: Steps): Promise<void> {
  const run = Date.now().toString(36);
  const anon = env.client("anonymous");
  const subscriber = env.client("subscriber");
  const author = env.client("author");
  const editor = env.client("editor");
  const admin = env.client("admin");

  let feature!: number;
  let cover!: number;
  let commentId!: number;
  let tagline!: string;

  await t.test("readers sign up for the newsletter", async () => {
    const email = `reader-1-${run}@example.test`;
    const seeded = await admin.subscribers.create({ email: `Seed-${run}@EXAMPLE.TEST` });
    assert.equal(seeded.email, `seed-${run}@example.test`, "direct creates normalize email before storage");
    assert.equal((await admin.subscribers.update(seeded.id, { email: email.toUpperCase() })).email, email, "direct updates normalize email before storage");
    for (const n of [1, 2, 3]) assert.deepEqual(await anon.actions.subscribeNewsletter({ email: `reader-${n}-${run}@example.test` }), { accepted: true });
    assert.deepEqual(await Promise.all([anon.actions.subscribeNewsletter({ email }), anon.actions.subscribeNewsletter({ email: email.toUpperCase() })]), [{ accepted: true }, { accepted: true }]);
    await env.runJobs();
    assert.deepEqual(await anon.actions.subscribeNewsletter({ email }), { accepted: true }, "an existing private subscription has the same acknowledgement");
    await env.runJobs();
    await rejects(() => anon.subscribers.list(), { status: 401, code: "unauthenticated" });
    assert.equal((await admin.subscribers.list({ where: { email: { like: `reader-%-${run}@example.test` } } })).length, 3);
  });

  await t.test("an editor builds a rich post in the editor; the public reads it with `with`", async () => {
    cover = await env.editor.upload(PNG_1X1, "image/png", `cover-${run}.png`, "A single pixel");
    const fields: EditorPost = {
      title: `Feature ${run}`,
      // As the block editor saves a paragraph: block markup, which syncs to Markdown losslessly.
      body: "<!-- wp:paragraph -->\n<p>The long read.</p>\n<!-- /wp:paragraph -->",
      dek: "Why one pixel is enough",
      cover,
      manuscript: null,
      topics: ["science", "tech"],
      featured: true,
      authorId: env.authorId,
      // An unchecked toggle inside a group: SCF stores it as '', and it must read back as false.
      seo: { noindex: false, metaTitle: null },
      related: [{ label: "Docs", href: "https://example.com/docs" }],
      sections: [
        { layout: "pullQuote", text: "Less is more.", cite: "Mies" },
        { layout: "figure", image: cover, caption: "The pixel" },
      ],
    };
    feature = await env.editor.saveDraft(fields);
    await rejects(() => anon.posts.get(feature), { status: 404, code: "not_found" });
    assert.equal((await editor.posts.get(feature)).status, "draft");
    await env.editor.publish(feature);

    const read = await anon.posts.get(feature, { with: { author: true, cover: true, comments: true } });
    const { cover: media, author: byline, comments: thread, updatedAt, publishedAt, uid, ...row } = read;
    assert.match(uid, /^zr_[0-9a-f]{20}$/, "synced posts carry a stable uid");
    const { cover: _, ...rest } = fields;
    assert.deepEqual(row, { ...rest, id: feature, status: "published", slug: `feature-${run}`, locale: "en", translations: { en: feature } }, "readers see every public field");
    assert.ok(publishedAt && updatedAt, "publishing stamps the dates");
    assert.deepEqual(media, await anon.media.get(cover));
    assert.deepEqual([media?.mime, media?.alt, byline?.id, thread], ["image/png", "A single pixel", env.authorId, []]);
    const listed = await anon.posts.list({ where: { featured: true, topics: { has: "science" }, id: feature }, with: { author: true } });
    assert.deepEqual(listed.map((p) => [p.id, p.author?.name]), [[feature, byline?.name]]);
    assert.ok((await anon.actions.frontPage()).featured.includes(feature), "actions read what the editor published");
  });

  await t.test("publishing tells readers through the background job queue", async () => {
    const announced = async () => (await admin.announcements.list({ where: { postId: feature } })).map(({ recipients, attempt }) => ({ recipients, attempt }));
    assert.deepEqual(await announced(), [], "the job waits for the queue; the publish request didn't run it");
    await rejects(() => anon.announcements.list(), { status: 401, code: "unauthenticated" });
    const readers = (await admin.subscribers.list({ limit: 200 })).length;
    assert.ok(readers >= 3, "the announcement goes to real recipients");
    await env.runJobs();
    assert.deepEqual(await announced(), [{ recipients: readers, attempt: 1 }]);
    await rejects(() => editor.announcements.list({ where: { recipients: { gt: 0 } } }), { status: 403, code: "forbidden", pointer: "/where/recipients" });
    assert.equal("recipients" in (await editor.announcements.list({ where: { postId: feature } }))[0], false);
    // Editing a published post isn't publishing it: nothing new is queued.
    await editor.posts.update(feature, { featured: true });
    await env.runJobs();
    assert.deepEqual(await announced(), [{ recipients: readers, attempt: 1 }]);
    // Unpublishing and publishing again is a new publication, and announces again.
    await editor.posts.update(feature, { status: "draft" });
    await editor.posts.update(feature, { status: "published" });
    await env.runJobs();
    assert.deepEqual(await announced(), [{ recipients: readers, attempt: 1 }, { recipients: readers, attempt: 1 }]);
    let total = readers;
    for (const [email, added] of [[`reader-1-${run}@example.test`, 0], [`count-probe-${run}@example.test`, 1]] as const) {
      assert.deepEqual(await editor.actions.subscribeNewsletter({ email }), { accepted: true });
      await env.runJobs();
      await editor.posts.update(feature, { status: "draft" });
      await editor.posts.update(feature, { status: "published" });
      await env.runJobs();
      total += added;
      const receipts = await admin.announcements.list({ where: { postId: feature }, orderBy: { id: "desc" } });
      assert.equal(receipts[0].recipients, total, "administrators see the actual recipient count");
      const visible = await editor.announcements.list({ where: { postId: feature } });
      assert.equal(visible.length, receipts.length, "editors can still see each announcement");
      for (const row of visible) {
        assert.deepEqual([row.postId, row.attempt, "recipients" in row], [feature, 1, false], "signup and publication cannot expose membership through recipient counts");
      }
    }
  });

  await t.test("access holds for anonymous, subscriber, author and editor", async () => {
    await rejects(() => anon.posts.create({ title: "x" }), { status: 401, code: "unauthenticated" });
    await rejects(() => subscriber.posts.create({ title: "x" }), { status: 403, code: "forbidden" });
    const draft = await author.posts.create({ title: `Author draft ${run}`, status: "draft" });
    assert.equal(draft.authorId, env.authorId, "beforeCreate links the signed-in author");
    await rejects(() => subscriber.posts.get(draft.id), { status: 404, code: "not_found" });
    assert.deepEqual((await editor.posts.list({ status: "draft", where: { id: draft.id } })).map((p) => p.id), [draft.id]);
    // The byline the editor set on the feature grants its author API edits; an unbylined post is
    // outside the author's update filter, so it is not found rather than forbidden.
    assert.equal((await author.posts.update(feature, { dek: "Why one pixel is plenty" })).dek, "Why one pixel is plenty");
    const desk = await editor.posts.create({ title: `Desk ${run}` });
    await rejects(() => author.posts.update(desk.id, { dek: "mine now" }), { status: 404, code: "not_found" });
    await rejects(() => author.posts.delete(draft.id), { status: 403, code: "forbidden" });
    assert.equal((await editor.actions.removePost({ id: draft.id })).id, draft.id);
    const linked = await editor.posts.create({ title: `Private subscription ${run}` });
    const signup = await admin.subscribers.create({ email: `linked-${run}@example.test`, postId: linked.id });
    await rejects(() => editor.subscribers.get(signup.id), { status: 403, code: "forbidden" });
    assert.equal((await editor.actions.removePost({ id: linked.id })).id, linked.id, "removal succeeds with or without private subscriptions");
    assert.equal((await admin.subscribers.get(signup.id)).postId, null, "removal detaches the private subscription without returning it");
  });

  await t.test("field access: the desk's notes reach staff only, and only editors write them", async () => {
    // The column is absent from readers' rows (not null), and readers can't probe it through filters.
    assert.equal((await editor.posts.update(feature, { deskNotes: "Fact-check the pixel count" })).deskNotes, "Fact-check the pixel count");
    assert.equal("deskNotes" in (await anon.posts.get(feature)), false);
    assert.equal("deskNotes" in (await subscriber.posts.list({ where: { id: feature } }))[0], false);
    assert.equal((await author.posts.get(feature)).deskNotes, "Fact-check the pixel count", "authors are staff");
    await rejects(() => anon.posts.list({ where: { deskNotes: { like: "Fact%" } } }), { status: 403, code: "forbidden", pointer: "/where/deskNotes" });
    await rejects(() => author.posts.update(feature, { deskNotes: "mine" }), { status: 403, code: "forbidden", pointer: "/deskNotes" });
    assert.equal((await editor.posts.get(feature)).deskNotes, "Fact-check the pixel count");
  });

  await t.test("a writer drafts in Markdown: posts sync to files and an edit syncs back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "first-system-sync-"));
    try {
      const pulled = env.sync(dir);
      assert.deepEqual([pulled.conflicts, pulled.refused], [[], []], "every post is representable as Markdown");
      const file = join(dir, `content/posts/feature-${run}.md`);
      const text = readFileSync(file, "utf8");
      assert.match(text, new RegExp(`^---\\nuid: zr_[0-9a-f]{20}\\ntitle: Feature ${run}\\n`), "the post's fields are front matter");
      assert.match(text, /\n---\nThe long read\.\n$/, "the body is Markdown");
      assert.ok(pulled.applied > 0);
      assert.equal(env.sync(dir).applied, 0, "a second run is a no-op");

      writeFileSync(file, text.replace("The long read.", "The long read.\n\n## Written in the repo").replace(`dek: ${(await anon.posts.get(feature)).dek}`, "dek: Edited in Markdown"));
      assert.deepEqual(env.sync(dir).conflicts, []);
      const read = await anon.posts.get(feature);
      assert.equal(read.dek, "Edited in Markdown");
      assert.match(read.body ?? "", /Written in the repo/, "the Markdown edit reaches readers as the post body");
      await editor.posts.update(feature, { dek: "Why one pixel is plenty" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("relation filters give anonymous readers no oracle into drafts or admin-only rows", async () => {
    const ghost = await admin.authors.create({ name: `Ghost ${run} key-42`, status: "draft" });
    const post = await editor.posts.create({ title: `By ghost ${run}`, authorId: ghost.id });
    await anon.actions.subscribeNewsletter({ email: `secret-7-${run}@example.test`, postId: post.id });
    await env.runJobs();
    const hidden = await editor.posts.create({ title: `Private signup target ${run}`, status: "draft" });
    for (const [label, postId] of [["hidden", hidden.id], ["absent", 999_999_997]] as const) {
      const email = `${label}-7-${run}@example.test`;
      assert.deepEqual(await anon.actions.subscribeNewsletter({ email, postId }), { accepted: true });
      await env.runJobs();
      assert.equal((await admin.subscribers.list({ where: { email } }))[0].postId, null, "private and absent targets are both omitted from the private subscription");
    }
    const draftProbe = { AND: [{ author: { name: { like: `%key-4%` } } }, { id: post.id }] };
    assert.deepEqual(await anon.posts.list({ where: draftProbe }), [], "a draft author is invisible through the filter");
    assert.deepEqual((await editor.posts.list({ where: draftProbe })).map((p) => p.id), [post.id]);
    const adminProbe = { AND: [{ subscribers: { email: { like: `secret-7%` } } }, { id: post.id }] };
    await rejects(() => anon.posts.list({ where: adminProbe }), { status: 401, code: "unauthenticated" });
    await rejects(() => editor.posts.list({ where: adminProbe }), { status: 403, code: "forbidden" });
    assert.deepEqual((await admin.posts.list({ where: adminProbe })).map((p) => p.id), [post.id]);
  });

  await t.test("a draft is scheduled, hidden until due, then published", async () => {
    const draft = await editor.posts.create({ title: `Scheduled ${run}`, status: "draft" });
    const at = isoSeconds(Date.now() + 86_400_000);
    const scheduled = await editor.posts.update(draft.id, { status: "scheduled", publishedAt: at });
    assert.deepEqual([scheduled.status, scheduled.publishedAt], ["scheduled", at]);
    await rejects(() => anon.posts.get(draft.id), { status: 404, code: "not_found" });
    const reader = (await env.promoteDue(at)) ?? anon;
    const seen = await reader.posts.get(draft.id);
    assert.deepEqual([seen.status, seen.publishedAt], ["published", at]);
  });

  await t.test("revisions restore rich fields through the update pipeline", async () => {
    const p = await author.posts.create({ title: `Revised ${run}`, dek: "First dek", topics: ["culture"], seo: { noindex: false, metaTitle: "First" } });
    const second = await author.posts.update(p.id, { title: `Revised ${run} v2`, dek: "Second dek", topics: ["tech"], seo: { noindex: true, metaTitle: "Second" } });
    assert.deepEqual(second.seo, { noindex: true, metaTitle: "Second" });
    const revs = await author.posts.revisions.list(p.id);
    const oldest = revs[revs.length - 1];
    const restored = await author.posts.revisions.restore(p.id, oldest.id);
    assert.deepEqual([restored.title, restored.dek, restored.topics, restored.seo], [`Revised ${run}`, "First dek", ["culture"], { noindex: false, metaTitle: "First" }]);
    const fresh = await anon.posts.get(p.id);
    assert.deepEqual([fresh.dek, fresh.seo], ["First dek", { noindex: false, metaTitle: "First" }], "every field, booleans included, came back");
    assert.equal((await author.posts.revisions.list(p.id)).length, revs.length + 1, "the restore is itself a revision");
  });

  await t.test("an uploaded image is used by a post's cover and blocks", async () => {
    const pixel = await author.media.upload(new Blob([PNG_1X1], { type: "image/png" }), { alt: "Inline", filename: `inline-${run}.png` });
    const p = await author.posts.create({ title: `Gallery ${run}`, cover: pixel.id, sections: [{ layout: "figure", image: pixel.id, caption: null }] });
    const read = await anon.posts.get(p.id, { with: { cover: true } });
    assert.deepEqual([read.cover, read.sections], [pixel, [{ layout: "figure", image: pixel.id, caption: null }]]);
    const served = await fetch(new URL(pixel.url, env.origin));
    assert.deepEqual([served.status, new Uint8Array(await served.arrayBuffer())], [200, PNG_1X1]);
  });

  await t.test("the card crop follows the image's focal point", async () => {
    // 400×200, red left half, blue right half: a 120×120 `card` taken at the focal point shows its side.
    const photo = await author.media.upload(new Blob([splitPng()], { type: "image/png" }), { filename: `split-${run}.png`, alt: "Two halves" });
    const card = async (m: { sizes: Record<string, { url: string }> }) => pngCentre(new Uint8Array(await (await fetch(new URL(m.sizes.card.url, env.origin))).arrayBuffer()));
    const bytes = async (m: { sizes: Record<string, { url: string }> }) => new Uint8Array(await (await fetch(new URL(m.sizes.card.url, env.origin))).arrayBuffer());
    const centred = await bytes(photo);
    assert.deepEqual([photo.focal, (await card(photo)).width], [null, 120]);
    // Authors can't move the focal point: the image and its crop are byte-for-byte as they were.
    await rejects(() => author.media.update(photo.id, { focal: { x: 0, y: 0.5 } }), { status: 403, code: "forbidden" });
    const untouched = await anon.media.get(photo.id);
    assert.deepEqual([untouched.focal, untouched.sizes.card, await bytes(untouched)], [null, photo.sizes.card, centred]);
    const left = await editor.media.update(photo.id, { focal: { x: 0, y: 0.5 } });
    assert.deepEqual([left.focal, await card(left)], [{ x: 0, y: 0.5 }, { width: 120, height: 120, colour: "red" }]);
    const right = await editor.media.update(photo.id, { focal: { x: 1, y: 0.5 } });
    assert.deepEqual(await card(right), { width: 120, height: 120, colour: "blue" });
    assert.deepEqual((await anon.media.get(photo.id)).sizes.card, right.sizes.card, "readers get the new crop");
  });

  await t.test("a manuscript is a private file: signed links for staff, nothing for anyone else", async () => {
    const text = new TextEncoder().encode(`Draft of Feature ${run}\n`);
    await rejects(() => subscriber.files.manuscripts.upload(new Blob([text], { type: "text/plain" }), { filename: "draft.txt" }), { status: 403, code: "forbidden" });
    const draft = await author.files.manuscripts.upload(new Blob([text], { type: "text/plain" }), { filename: "draft.txt" });
    assert.deepEqual([draft.bucket, draft.mime, draft.size, draft.filename], ["manuscripts", "text/plain", text.length, "draft.txt"]);
    await rejects(() => author.files.manuscripts.upload(new Blob([PNG_1X1], { type: "image/png" }), { filename: "x.png" }), { status: 422, code: "invalid_input", pointer: "/file" });
    await editor.posts.update(feature, { manuscript: draft.id });

    // Editors read it through the signed link, which works without credentials and only until it's tampered with.
    const signed = (await editor.files.manuscripts.get(draft.id)).url;
    const download = await fetch(new URL(signed, env.origin));
    assert.deepEqual([download.status, new Uint8Array(await download.arrayBuffer())], [200, text]);
    assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
    const forged = new URL(signed, env.origin);
    forged.searchParams.set("sig", "0".repeat(64));
    const refused = await fetch(forged);
    assert.deepEqual([refused.status, (await refused.json()).code], [403, "forbidden"], "a forged signature downloads nothing");
    // Readers see only the id on the post, and can't ask for a link.
    assert.equal((await anon.posts.get(feature, { with: { manuscript: true } })).manuscript, draft.id);
    const populated = (await editor.posts.get(feature, { with: { manuscript: true } })).manuscript;
    assert.deepEqual(typeof populated === "object" && populated ? [populated.id, populated.filename] : populated, [draft.id, "draft.txt"], "staff get the file row populated");
    await rejects(() => anon.files.manuscripts.get(draft.id), { status: 401, code: "unauthenticated" });
  });

  await t.test("comments are moderated through an action", async () => {
    const pending = await anon.comments.create({ postId: feature, name: "Reader", body: "Lovely piece" });
    const spam = await anon.comments.create({ postId: feature, name: "Bot", body: "Buy now", approved: true });
    assert.deepEqual([pending.approved, spam.approved], [false, false], "readers can't approve themselves");
    assert.deepEqual((await anon.posts.get(feature, { with: { comments: true } })).comments, []);
    await rejects(() => subscriber.comments.get(pending.id), { status: 404, code: "not_found" });
    await rejects(() => author.actions.moderateComment({ id: pending.id, decision: "approve" }), { status: 403, code: "forbidden" });
    assert.deepEqual(await editor.actions.moderateComment({ id: pending.id, decision: "approve" }), { id: pending.id, approved: true, removed: false });
    assert.deepEqual(await editor.actions.moderateComment({ id: spam.id, decision: "reject" }), { id: spam.id, approved: false, removed: true });
    await rejects(() => editor.comments.get(spam.id), { status: 404, code: "not_found" });
    assert.deepEqual((await anon.posts.get(feature, { with: { comments: true } })).comments.map((c) => c.id), [pending.id]);
    assert.equal((await subscriber.comments.get(pending.id)).approved, true, "approved comments reach every reader");
    const staff = await author.comments.create({ postId: feature, name: "Author", body: "Thanks!" });
    assert.equal((await anon.comments.get(staff.id)).approved, true, "staff comments skip the queue");
    commentId = pending.id;

    // Each new comment went out as a signed webhook. The moderation tool failed the first delivery;
    // that job retried, so all three arrive once, each verifiably signed.
    await env.runJobs();
    assert.equal(env.deliveries().length, 2, "two delivered, one failed and waiting to retry");
    await env.runRetries();
    const sent = env.deliveries().filter((d) => d.event === "comments.created").map((d) => [d.data.row.id, d.verified]);
    assert.deepEqual(sent.sort(), [[pending.id, true], [spam.id, true], [staff.id, true]].sort());
  });

  await t.test("a reader signs in as a member, keeps their own profile, and signs out", async () => {
    const email = `mia-${run}@example.test`;
    const password = `mia-${run}-correct-horse`;
    // Admins create members with a write-only password; it never comes back.
    const created = await admin.members.create({ email, name: "Mia", password });
    assert.deepEqual(await admin.members.get(created.id), created, "the member administrator can read the identities they manage");
    assert.deepEqual([created.role, created.plan, "password" in created], ["subscriber", "free", false]);
    const mia = await env.signIn(email, password);
    const me = await mia.auth.me();
    assert.deepEqual(me, { ...created, name: me?.name, role: "subscriber" }, "the session is the member, its row flattened onto the user");
    // A member reads and edits only their own row, and can't promote themselves.
    assert.equal((await mia.members.update(created.id, { email, name: "Mia Reader", plan: "supporter" })).plan, "supporter");
    await rejects(() => mia.members.update(created.id, { role: "editor" }), { status: 403, code: "forbidden", pointer: "/role" });
    const other = await admin.members.create({ email: `other-${run}@example.test`, name: "Other", password });
    assert.deepEqual((await mia.members.list()).map((m) => m.id), [created.id]);
    await rejects(() => mia.members.get(other.id), { status: 404, code: "not_found" });
    // A member is a reader: published posts and approved comments only, and their comments queue.
    await rejects(() => mia.posts.create({ title: "x" }), { status: 403, code: "forbidden" });
    const said = await mia.comments.create({ postId: feature, name: "Mia", body: "Signed in and saying hi", approved: true });
    assert.equal(said.approved, false, "members can't approve themselves");
    await rejects(() => mia.comments.get(said.id), { status: 404, code: "not_found" });
    await editor.actions.moderateComment({ id: said.id, decision: "reject" });
    await mia.auth.signOut();
    assert.equal(await mia.auth.me(), null);
    await rejects(() => mia.members.get(created.id), { status: 401, code: "unauthenticated" });
  });

  await t.test("a post is translated: German readers get the translation, others fall back", async () => {
    const de = await editor.posts.create({ title: `Feature ${run} (DE)`, dek: "Warum ein Pixel reicht", locale: "de", translationOf: feature, status: "published" });
    const shared = await anon.posts.get(feature);
    // Translated fields are the translation's own; every other field is the group's.
    assert.deepEqual([de.locale, de.title, de.dek, de.topics, de.featured, de.authorId, de.cover], ["de", `Feature ${run} (DE)`, "Warum ein Pixel reicht", shared.topics, shared.featured, shared.authorId, shared.cover]);
    assert.deepEqual((await anon.posts.get(feature)).translations, { en: feature, de: de.id });
    assert.equal((await anon.posts.get(feature, { locale: "de" })).title, `Feature ${run} (DE)`);
    // A German reader of the list sees the translation in place of the original, and the
    // untranslated posts in English.
    const german = await anon.posts.list({ locale: "de", where: { title: { like: `%${run}%` } }, limit: 200 });
    assert.ok(german.some((p) => p.id === de.id) && !german.some((p) => p.id === feature), "the translation replaces its original");
    assert.ok(german.some((p) => p.locale === "en"), "untranslated posts fall back to English");
    assert.ok((await anon.posts.list({ where: { title: { like: `%${run}%` } }, limit: 200 })).every((p) => p.locale === "en"), "the default locale stays English");
    // Shared fields stay shared: a change on the translation reaches the original.
    await editor.posts.update(de.id, { topics: ["science"] });
    assert.deepEqual((await anon.posts.get(feature)).topics, ["science"]);
    await editor.posts.update(feature, { topics: shared.topics });
  });

  await t.test("editors update the site settings; others can't", async () => {
    assert.deepEqual(await anon.globals.settings.get(), { siteTitle: "The First Review", tagline: null, commentsOpen: true, social: null });
    await rejects(() => author.globals.settings.update({ tagline: "x" }), { status: 403, code: "forbidden" });
    tagline = `Notes ${run}`;
    const updated = await editor.globals.settings.update({ tagline, social: [{ label: "Feed", href: "https://example.com/feed" }] });
    assert.deepEqual(await anon.globals.settings.get(), updated);
    await rejects(() => editor.globals.settings.update({ siteTitle: "x".repeat(81) }), { status: 422, code: "invalid_input", pointer: "/siteTitle" });
    // Hooks read settings too: with comments closed, nobody can comment until they reopen.
    await editor.globals.settings.update({ commentsOpen: false });
    await rejects(() => anon.comments.create({ postId: feature, name: "Late", body: "Hello?" }), { status: 403, code: "comments_closed" });
    await editor.globals.settings.update({ commentsOpen: true });
  });

  await t.test("an additive upgrade migrates in place and keeps every row", async () => {
    const before = await anon.posts.get(feature);
    const comment = await editor.comments.get(commentId);
    const as = await env.upgrade();
    const post = await as("anonymous").posts.get(feature);
    assert.deepEqual(post, { ...before, readingMinutes: null }, "the new post field starts empty");
    assert.deepEqual(await as("editor").comments.get(commentId), { ...comment, pinned: false }, "the new column gets its default");
    assert.equal((await as("anonymous").globals.settings.get()).tagline, tagline);
    assert.equal((await as("editor").posts.update(feature, { readingMinutes: 7 })).readingMinutes, 7);
    await rejects(() => as("editor").posts.update(feature, { readingMinutes: 0 }), { status: 422, code: "invalid_input", pointer: "/readingMinutes" });
  });
}
