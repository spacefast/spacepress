// Client runtime request building, against an in-process node:http server with canned responses.
// The runtime is copied next to a fixture schema.ts/types.ts in the exact layout `zero build` emits
// (zero/client/{index,schema,types}.ts), then imported for real.
//
// Run: node --test runtime/client/index.test.ts   (Node 22 strips types)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA_TS = `export const SCHEMA = {
  name: "blog", target: "standalone", basePath: "/api",
  collections: {
    posts: { path: "posts", primaryKey: "id", drafts: true, revisions: true,
      relations: { author: { kind: "one", collection: "authors", optional: true } }, media: ["cover"], mediaList: [], files: ["deck"] },
    authors: { path: "authors", primaryKey: "id", drafts: true, revisions: true, relations: {}, media: [], mediaList: [], files: [] },
    shoppingList: { path: "shopping_list", primaryKey: "id", drafts: false, revisions: false, relations: {}, media: [], mediaList: [], files: [] },
  },
  globals: ["settings"],
  actions: ["approveComment", "publishedCount"],
  buckets: ["decks"],
} as const;
`;
const TYPES_TS = `export interface User { id: number; name: string; role: string }
export type Media = Record<string, unknown>; export type PrivateFile = Record<string, unknown>; export type RevisionSummary = unknown; export type Status = string; export type Locale = string;
export type Collections = Record<string, any>; export type Globals = Record<string, any>; export type Actions = Record<string, any>;
`;

interface Seen { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: Buffer }
let seen: Seen[] = [];
let reply: (s: Seen) => { status: number; type?: string; body: string } = () => ({ status: 200, body: '{"data":null}' });
let server: Server;
let url = "";
let dir = "";
// The runtime's public surface, loosely typed: the test drives it the way generated types would.
let mod: any;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "zero-client-"));
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), join(dir, "index.ts"));
  writeFileSync(join(dir, "schema.ts"), SCHEMA_TS);
  writeFileSync(join(dir, "types.ts"), TYPES_TS);
  mod = await import(pathToFileURL(join(dir, "index.ts")).href);

  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const u = new URL(req.url ?? "/", "http://x");
    const s: Seen = { method: req.method ?? "", path: u.pathname, query: u.searchParams, headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(s);
    const r = reply(s);
    res.writeHead(r.status, { "content-type": r.type ?? "application/json" }).end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const ok = (data: unknown) => () => ({ status: 200, body: JSON.stringify({ data }) });
const last = () => seen[seen.length - 1];

test("list encodes where/orderBy/limit/offset/status/locale; with is a comma list or JSON", async () => {
  seen = [];
  reply = ok([{ id: 1 }]);
  const zero = mod.createClient({ url: url + "/" });
  const rows = await zero.posts.list({
    where: { tags: { has: "news" }, OR: [{ title: { like: "%a&b%" } }] },
    orderBy: { createdAt: "desc", title: "asc" },
    limit: 10,
    offset: 20,
    status: "draft",
    locale: "de",
    with: { author: true, cover: true },
  });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(last().query.get("locale"), "de");
  const q = last().query;
  assert.equal(last().method, "GET");
  assert.equal(last().path, "/api/posts");
  assert.deepEqual(JSON.parse(q.get("where") ?? ""), { tags: { has: "news" }, OR: [{ title: { like: "%a&b%" } }] });
  assert.deepEqual([q.get("orderBy"), q.get("limit"), q.get("offset"), q.get("status"), q.get("with")], ["-createdAt,title", "10", "20", "draft", "author,cover"]);

  // Any entry with options switches `with` to JSON; nested orderBy strings travel as objects.
  await zero.posts.get(7, { with: { author: { with: { posts: true }, orderBy: "-id", limit: 2 } }, locale: "*" });
  assert.equal(last().path, "/api/posts/7");
  assert.equal(last().query.get("locale"), "*");
  assert.deepEqual(JSON.parse(last().query.get("with") ?? ""), { author: { with: { posts: true }, orderBy: { id: "desc" }, limit: 2 } });

  // The collection key is not the path: shoppingList lives at /shopping_list.
  await zero.shoppingList.list();
  assert.equal(last().path, "/api/shopping_list");
  assert.equal(last().query.toString(), "");
});

test("writes, revisions, globals, actions and auth hit the §4.8 routes with JSON bodies", async () => {
  seen = [];
  reply = ok({ id: 1 });
  const zero = mod.createClient({ url });
  await zero.posts.create({ title: "Hi" });
  await zero.posts.update(1, { title: "Yo" });
  await zero.posts.delete(1);
  await zero.posts.revisions.list(1);
  await zero.posts.revisions.get(1, 4);
  await zero.posts.revisions.restore(1, 4);
  await zero.globals.settings.get();
  await zero.globals.settings.update({ tagline: "x" });
  await zero.actions.approveComment({ id: 3 });
  await zero.actions.publishedCount();
  await zero.auth.me();
  await zero.schema();
  assert.deepEqual(
    seen.map((s) => `${s.method} ${s.path} ${s.body.toString()}`),
    [
      'POST /api/posts {"title":"Hi"}',
      'PATCH /api/posts/1 {"title":"Yo"}',
      "DELETE /api/posts/1 ",
      "GET /api/posts/1/revisions ",
      "GET /api/posts/1/revisions/4 ",
      "POST /api/posts/1/revisions/4/restore ",
      "GET /api/globals/settings ",
      'PATCH /api/globals/settings {"tagline":"x"}',
      'POST /api/actions/approveComment {"id":3}',
      "POST /api/actions/publishedCount {}",
      "GET /api/me ",
      "GET /api/_schema ",
    ],
  );
  assert.equal(seen[0].headers["content-type"], "application/json");
});

test("auth headers: standalone bearer (and login adopts the token), WP nonce, custom headers win", async () => {
  seen = [];
  reply = (s) => (s.path === "/api/auth/token" ? ok({ token: "zt_new", user: { id: 2, name: "alice", role: "author" } })() : ok(null)());

  const standalone = mod.createClient({ url, token: "zt_abc" });
  await standalone.auth.me();
  assert.equal(last().headers.authorization, "Bearer zt_abc");
  assert.equal(last().headers["x-wp-nonce"], undefined);

  const anon = mod.createClient({ url });
  await anon.auth.me();
  assert.equal(last().headers.authorization, undefined);
  const { token } = await anon.auth.login("alice", "pw");
  assert.deepEqual(JSON.parse(last().body.toString()), { name: "alice", password: "pw" });
  await anon.auth.me();
  assert.equal(last().headers.authorization, `Bearer ${token}`);

  // WP cookie auth: nonce header + same-origin credentials (observed through a fetch wrapper).
  let credentials: RequestCredentials | undefined;
  const wp = mod.createClient({
    url,
    nonce: "n0nce",
    fetch: (input: RequestInfo | URL, init?: RequestInit) => ((credentials = init?.credentials), fetch(input, init)),
  });
  await wp.auth.me();
  assert.deepEqual([last().headers["x-wp-nonce"], last().headers.authorization, credentials], ["n0nce", undefined, "same-origin"]);

  // WP application passwords travel as a caller-supplied header and override the token.
  const basic = "Basic " + btoa("admin:xxxx yyyy");
  await mod.createClient({ url, token: "zt_abc", headers: { Authorization: basic } }).auth.me();
  assert.equal(last().headers.authorization, basic);
});

test("problem documents become ZeroError with every field; non-problem failures still map", async () => {
  const zero = mod.createClient({ url });
  const problem = { type: "about:blank", title: "Invalid input", status: 422, code: "invalid_input", detail: "Too long", pointer: "/sections/1/heading" };
  reply = () => ({ status: 422, type: "application/problem+json", body: JSON.stringify(problem) });
  const err = await zero.posts.create({ title: "x" }).catch((e: unknown) => e);
  assert.ok(err instanceof mod.ZeroError);
  assert.ok(err instanceof Error);
  assert.deepEqual(
    { type: err.type, title: err.title, status: err.status, code: err.code, detail: err.detail, pointer: err.pointer, message: err.message },
    { ...problem, message: "Too long" },
  );

  // No pointer in the document → no pointer on the error.
  reply = () => ({ status: 403, type: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Forbidden", status: 403, code: "forbidden", detail: "no" }) });
  const forbidden = await zero.actions.approveComment({ id: 1 }).catch((e: unknown) => e);
  assert.deepEqual([forbidden.status, forbidden.code, forbidden.pointer], [403, "forbidden", undefined]);

  // A WordPress core error body (before Zero's route runs) maps onto the same shape.
  reply = () => ({ status: 401, body: JSON.stringify({ code: "rest_cookie_invalid_nonce", message: "Cookie check failed", data: { status: 403 } }) });
  const wpErr = await zero.auth.me().catch((e: unknown) => e);
  assert.deepEqual([wpErr.status, wpErr.code, wpErr.detail], [401, "rest_cookie_invalid_nonce", "Cookie check failed"]);

  // HTML from a proxy, and an unreachable server: status 0, code "network".
  reply = () => ({ status: 502, type: "text/html", body: "<h1>Bad gateway</h1>" });
  const html = await zero.posts.list().catch((e: unknown) => e);
  assert.deepEqual([html.status, html.code], [0, "network"]);
  const down = await mod.createClient({ url: "http://127.0.0.1:1/api" }).posts.list().catch((e: unknown) => e);
  assert.deepEqual([down instanceof mod.ZeroError, down.status, down.code], [true, 0, "network"]);
});

test("media upload is multipart with `file` (+ filename, type) and `alt`", async () => {
  seen = [];
  const media = { id: 9, url: "/uploads/2026/10/a.png", mime: "image/png", size: 3, width: 1, height: 1, alt: "A pixel", filename: "pixel.png", createdAt: "2026-10-28T00:00:00.000Z" };
  reply = () => ({ status: 201, body: JSON.stringify({ data: media }) });
  const zero = mod.createClient({ url, token: "zt_abc" });
  const bytes = new Uint8Array([137, 80, 78]);
  assert.deepEqual(await zero.media.upload(new Blob([bytes], { type: "image/png" }), { alt: "A pixel", filename: "pixel.png" }), media);

  const s = last();
  assert.deepEqual([s.method, s.path, s.headers.authorization], ["POST", "/api/media", "Bearer zt_abc"]);
  assert.match(s.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
  const form = await new Response(s.body, { headers: { "content-type": s.headers["content-type"] ?? "" } }).formData();
  const file = form.get("file") as File;
  assert.deepEqual([file.name, file.type, new Uint8Array(await file.arrayBuffer())], ["pixel.png", "image/png", bytes]);
  assert.equal(form.get("alt"), "A pixel");

  // A File keeps its own name; no alt → no alt part.
  await zero.media.upload(new File([bytes], "own.png", { type: "image/png" }));
  const again = await new Response(last().body, { headers: { "content-type": last().headers["content-type"] ?? "" } }).formData();
  assert.deepEqual([(again.get("file") as File).name, again.has("alt")], ["own.png", false]);

  await zero.media.list({ where: { mime: { like: "image/%" } }, limit: 5 });
  assert.deepEqual([last().path, last().query.get("limit"), JSON.parse(last().query.get("where") ?? "")], ["/api/media", "5", { mime: { like: "image/%" } }]);
  await zero.media.delete(9);
  assert.deepEqual([last().method, last().path], ["DELETE", "/api/media/9"]);
});

test("media.update is a JSON PATCH of alt/focal", async () => {
  reply = ok({ id: 9 });
  const zero = mod.createClient({ url });
  await zero.media.update(9, { focal: { x: 0.25, y: 1 }, alt: null });
  assert.deepEqual([last().method, last().path, last().headers["content-type"], JSON.parse(last().body.toString())],
    ["PATCH", "/api/media/9", "application/json", { focal: { x: 0.25, y: 1 }, alt: null }]);
});

test("files.<bucket> upload/get/delete hit /files/<bucket>", async () => {
  const row = { id: 4, bucket: "decks", url: "/api/files/decks/4/download?exp=1&sig=ab" };
  reply = ok(row);
  const zero = mod.createClient({ url });
  assert.deepEqual(await zero.files.decks.upload(new Blob([new Uint8Array([37, 80])], { type: "application/pdf" }), { filename: "q3.pdf" }), row);
  const form = await new Response(last().body, { headers: { "content-type": last().headers["content-type"] ?? "" } }).formData();
  assert.deepEqual([last().method, last().path, (form.get("file") as File).name], ["POST", "/api/files/decks", "q3.pdf"]);
  await zero.files.decks.get(4);
  assert.deepEqual([last().method, last().path], ["GET", "/api/files/decks/4"]);
  await zero.files.decks.delete(4);
  assert.deepEqual([last().method, last().path], ["DELETE", "/api/files/decks/4"]);
});

test("default base URL is the build's prefix", async () => {
  let requested = "";
  const zero = mod.createClient({ fetch: async (input: RequestInfo | URL) => ((requested = String(input)), new Response('{"data":null}')) });
  await zero.auth.me();
  assert.equal(requested, "/api/me");
});
