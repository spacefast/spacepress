// Standalone lane of the shared blog scenario (design §9.1): the blog fixture app is assembled by
// tests/php/blog_app.php, served by `php -S`, tokens are minted through the real CLI, and the
// scenario runs over HTTP. Codec, filter-grammar and pipeline edge cases live in tests/php; this
// file only proves what crossing CLI ↔ HTTP ↔ runtime adds.
//
// Run: node --test tests/e2e/standalone.test.ts   (Node 22 strips types)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const php = process.env.PHP ?? "php";
const root = join(mkdtempSync(join(tmpdir(), "zero-e2e-")), "app");
const servers: ChildProcess[] = [];
const tokens: Record<string, string> = {};
let base = "";

type Problem = { type: string; title: string; status: number; code: string; detail: string; pointer?: string };

function cli(...args: string[]): any {
  const out = execFileSync(php, [join(root, "zero/bin/zero.php"), ...args], { encoding: "utf8" });
  return JSON.parse(out).data;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Start `php -S` on the app (optionally with a pinned clock) and wait until it accepts connections. */
async function serve(env: Record<string, string> = {}): Promise<string> {
  const port = await freePort();
  const child = spawn(php, ["-S", `127.0.0.1:${port}`, "-t", join(root, "public"), join(root, "public/index.php")], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  servers.push(child);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const up = await new Promise<boolean>((resolve) => {
      const sock = connect(port, "127.0.0.1", () => { sock.end(); resolve(true); });
      sock.on("error", () => resolve(false));
    });
    if (up) return `http://127.0.0.1:${port}/api`;
    if (Date.now() > deadline) throw new Error("php -S didn't start");
    await new Promise((r) => setImmediate(r));
  }
}

async function api(method: string, path: string, opts: { as?: string; body?: unknown; form?: FormData; url?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.as) headers.authorization = `Bearer ${tokens[opts.as]}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch((opts.url ?? base) + path, { method, headers, body });
  const json = await res.json();
  return { status: res.status, type: res.headers.get("content-type") ?? "", json };
}

async function ok(method: string, path: string, opts: Parameters<typeof api>[2] = {}) {
  const r = await api(method, path, opts);
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}

async function problem(method: string, path: string, opts: Parameters<typeof api>[2], expect: Partial<Problem>) {
  const r = await api(method, path, opts);
  assert.match(r.type, /^application\/problem\+json/);
  const p = r.json as Problem;
  assert.equal(p.type, "about:blank");
  assert.deepEqual({ status: r.status, code: p.code, pointer: p.pointer }, { status: expect.status, code: expect.code, pointer: expect.pointer });
  return p;
}

const qs = (o: Record<string, unknown>) =>
  "?" + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])).toString();

before(async () => {
  execFileSync(php, [join(repo, "tests/php/blog_app.php"), root]);
  for (const [name, role] of [["ed", "editor"], ["alice", "author"], ["bob", "author"]]) {
    cli("user", "add", name, "--role", role);
    tokens[name] = cli("token", "create", name).token;
  }
  base = await serve();
  // Alice's author profile (authors are admin-only through the API; the CLI is trusted).
  cli("insert", "authors", JSON.stringify({ name: "Alice", email: "alice@example.com", userId: cli("user", "list").find((u: any) => u.name === "alice").id }));
});

after(() => {
  for (const s of servers) s.kill();
  rmSync(dirname(root), { recursive: true, force: true });
});

test("anonymous vs author vs editor visibility; drafts hidden from anonymous readers", async () => {
  const draft = await ok("POST", "/posts", { as: "alice", body: { title: "Alice draft", status: "draft" } });
  assert.equal(draft.status, "draft");
  const pub = await ok("POST", "/posts", { as: "alice", body: { title: "Alice live", tags: ["news"] } });
  assert.equal(pub.status, "published");

  const anon = (await ok("GET", "/posts")).map((p: any) => p.title);
  assert.ok(anon.includes("Alice live") && !anon.includes("Alice draft"));
  await problem("GET", `/posts/${draft.id}`, {}, { status: 404, code: "not_found" });
  assert.ok((await ok("GET", "/posts", { as: "alice" })).some((p: any) => p.id === draft.id));
  assert.deepEqual((await ok("GET", "/posts" + qs({ status: "draft" }), { as: "ed" })).map((p: any) => p.id), [draft.id]);

  await problem("POST", "/posts", { body: { title: "x" } }, { status: 401, code: "unauthenticated" });
  await problem("PATCH", `/posts/${pub.id}`, { as: "bob", body: { title: "mine now" } }, { status: 404, code: "not_found" });
  assert.equal((await ok("PATCH", `/posts/${pub.id}`, { as: "ed", body: { excerpt: "edited" } })).excerpt, "edited");
  assert.deepEqual(await ok("GET", "/me", { as: "bob" }), { id: 3, name: "bob", role: "author" });
});

test("a scheduled post appears after promotion", async () => {
  const at = "2031-06-01T00:00:00.000Z";
  const post = await ok("POST", "/posts", { as: "ed", body: { title: "Scheduled", status: "scheduled", publishedAt: at } });
  assert.equal(post.status, "scheduled");
  assert.ok(!(await ok("GET", "/posts")).some((p: any) => p.id === post.id));

  // Time travel: a second server on the same database with its clock past publishedAt.
  const later = await serve({ ZERO_NOW: "2031-06-01T00:00:01Z" });
  const seen = (await ok("GET", "/posts", { url: later })).find((p: any) => p.id === post.id);
  assert.deepEqual([seen?.status, seen?.publishedAt], ["published", at]);
  assert.ok((await ok("GET", "/posts")).some((p: any) => p.id === post.id), "promotion persisted");
});

test("anonymous comment, approval through the action", async () => {
  const post = (await ok("GET", "/posts"))[0];
  const c = await ok("POST", "/comments", { body: { postId: post.id, name: "Visitor", body: "Lovely" } });
  assert.equal(c.approved, false);
  assert.deepEqual((await ok("GET", `/posts/${post.id}` + qs({ with: "comments" }))).comments, []);
  await problem("POST", "/actions/approveComment", { as: "alice", body: { id: c.id } }, { status: 403, code: "forbidden" });
  assert.equal((await ok("POST", "/actions/approveComment", { as: "ed", body: { id: c.id } })).approved, true);
  assert.deepEqual((await ok("GET", `/posts/${post.id}` + qs({ with: "comments" }))).comments.map((x: any) => x.id), [c.id]);
});

test("validation error with a nested pointer", async () => {
  const p = await problem(
    "POST", "/posts",
    { as: "ed", body: { title: "Bad", sections: [{ layout: "quote", text: "ok" }, { layout: "hero", heading: "x".repeat(81) }] } },
    { status: 422, code: "invalid_input", pointer: "/sections/1/heading" },
  );
  assert.equal(p.title, "Invalid input");
  await problem("POST", "/comments", { body: { postId: 1, name: "S", body: "http://spam" } }, { status: 422, code: "invalid_input", pointer: "/body" });
});

test("globals get/update", async () => {
  assert.deepEqual(await ok("GET", "/globals/settings"), { siteTitle: "My blog", tagline: null, postsPerPage: 10, social: null });
  await problem("PATCH", "/globals/settings", { as: "alice", body: { tagline: "x" } }, { status: 403, code: "forbidden" });
  const updated = await ok("PATCH", "/globals/settings", { as: "ed", body: { tagline: "Notes", social: [{ label: "Site", href: "https://example.com" }] } });
  assert.deepEqual(await ok("GET", "/globals/settings"), updated);
  assert.equal(updated.tagline, "Notes");
});

test("revisions list/restore", async () => {
  const p = await ok("POST", "/posts", { as: "alice", body: { title: "First title" } });
  await ok("PATCH", `/posts/${p.id}`, { as: "alice", body: { title: "Second title" } });
  const revs = await ok("GET", `/posts/${p.id}/revisions`, { as: "alice" });
  assert.equal(revs.length, 2);
  assert.deepEqual(revs[0].user, { id: 2, name: "alice" });
  assert.equal((await ok("GET", `/posts/${p.id}/revisions/${revs[1].id}`, { as: "alice" })).title, "First title");
  const restored = await ok("POST", `/posts/${p.id}/revisions/${revs[1].id}/restore`, { as: "alice" });
  assert.equal(restored.title, "First title");
  assert.equal((await ok("GET", `/posts/${p.id}/revisions`, { as: "alice" })).length, 3);
});

test("media upload referenced by a post with with: { cover: true }", async () => {
  // 1×1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
  form.append("alt", "A pixel");
  await problem("POST", "/media", { form }, { status: 401, code: "unauthenticated" });
  const media = await ok("POST", "/media", { as: "alice", form });
  assert.deepEqual([media.mime, media.width, media.height, media.alt, media.filename], ["image/png", 1, 1, "A pixel", "pixel.png"]);
  assert.ok(existsSync(join(root, "public", media.url)));
  const served = await fetch(base.replace(/\/api$/, "") + media.url);
  assert.deepEqual([served.status, Buffer.from(await served.arrayBuffer()).equals(png)], [200, true]);

  const post = await ok("POST", "/posts", { as: "alice", body: { title: "With cover", cover: media.id } });
  assert.equal(post.cover, media.id);
  assert.deepEqual((await ok("GET", `/posts/${post.id}` + qs({ with: { cover: true } }))).cover, media);
  const listed = (await ok("GET", "/posts" + qs({ where: { id: post.id }, with: { cover: true } })))[0];
  assert.equal(listed.cover.url, media.url);
});
