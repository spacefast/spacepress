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
import { createHash } from "node:crypto";

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
export type Media = Record<string, unknown>; export type PrivateFile = Record<string, unknown>; export type RevisionSummary = unknown; export type Status = string;
export type Collections = Record<string, any>; export type Globals = Record<string, any>; export type Actions = Record<string, any>;
`;

interface Seen { method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"]; body: Buffer }
let seen: Seen[] = [];
let reply: (s: Seen) => { status: number; type?: string; body: string } = () => ({ status: 200, body: '{"data":null}' });
let server: Server;
let origin = "";
let url = "";
const dirs: string[] = [];
// The runtime's public surface, loosely typed: the test drives it the way generated types would.
let mod: any;
// The same runtime built for WordPress (`SCHEMA.target === "wp"`).
let wpMod: any;

async function load(schemaTs: string): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "zero-client-"));
  dirs.push(dir);
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), join(dir, "index.ts"));
  writeFileSync(join(dir, "schema.ts"), schemaTs);
  writeFileSync(join(dir, "types.ts"), TYPES_TS);
  return import(pathToFileURL(join(dir, "index.ts")).href);
}

before(async () => {
  mod = await load(SCHEMA_TS);
  wpMod = await load(SCHEMA_TS.replace('target: "standalone", basePath: "/api"', 'target: "wp", basePath: "/wp-json/zero/v1"'));

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
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  url = `${origin}/api`;
});

after(() => {
  server.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ok = (data: unknown) => () => ({ status: 200, body: JSON.stringify({ data }) });
const last = () => seen[seen.length - 1];
const problem = (status: number, code: string) => ({
  status,
  type: "application/problem+json",
  body: JSON.stringify({ type: "about:blank", title: code, status, code, detail: code }),
});
const tokens = (n: number, user: unknown, extra: Record<string, unknown> = {}) =>
  ok({ accessToken: `za_${n}`, refreshToken: `zr_${n}`, expiresIn: 900, user, ...extra })();
/** Each request as one line; form and JSON bodies verbatim. */
const lines = () => seen.map((s) => `${s.method} ${s.path} ${s.headers.authorization ?? "-"} ${s.body.toString()}`.trim());
const form = (s: Seen) => Object.fromEntries(new URLSearchParams(s.body.toString()));

/**
 * Minimal browser globals for redirect sign-in: `sessionStorage` over a Map and a `location` whose
 * `assign` resolves `navigated`. Restored by `restore()`.
 */
function stubBrowser(search = "") {
  const saved = (["sessionStorage", "location"] as const).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  const store = new Map<string, string>();
  let navigate: (to: string) => void = () => {};
  const navigated = new Promise<string>((resolve) => (navigate = resolve));
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search, assign: (to: string) => navigate(to) } });
  return {
    store,
    navigated,
    restore() {
      for (const [k, d] of saved) d ? Object.defineProperty(globalThis, k, d) : Reflect.deleteProperty(globalThis, k);
    },
  };
}

const sha256url = (v: string) => createHash("sha256").update(v).digest("base64url");

test("list encodes where/orderBy/limit/offset/status; with is a comma list or JSON", async () => {
  seen = [];
  reply = ok([{ id: 1 }]);
  const zero = mod.createClient({ url: url + "/" });
  const rows = await zero.posts.list({
    where: { tags: { has: "news" }, OR: [{ title: { like: "%a&b%" } }] },
    orderBy: { createdAt: "desc", title: "asc" },
    limit: 10,
    offset: 20,
    status: "draft",
    with: { author: true, cover: true },
  });
  assert.deepEqual(rows, [{ id: 1 }]);
  const q = last().query;
  assert.equal(last().method, "GET");
  assert.equal(last().path, "/api/posts");
  assert.deepEqual(JSON.parse(q.get("where") ?? ""), { tags: { has: "news" }, OR: [{ title: { like: "%a&b%" } }] });
  assert.deepEqual([q.get("orderBy"), q.get("limit"), q.get("offset"), q.get("status"), q.get("with")], ["-createdAt,title", "10", "20", "draft", "author,cover"]);

  // Any entry with options switches `with` to JSON; nested orderBy strings travel as objects.
  await zero.posts.get(7, { with: { author: { with: { posts: true }, orderBy: "-id", limit: 2 } } });
  assert.equal(last().path, "/api/posts/7");
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

test("auth headers: standalone bearer, login keeps session tokens until signOut, WP nonce, custom headers win", async () => {
  seen = [];
  const alice = { id: 2, name: "alice", role: "author" };
  reply = (s) => (s.path === "/api/auth/token" ? tokens(1, alice) : s.path === "/api/auth/session" ? ok(true)() : ok(null)());

  const standalone = mod.createClient({ url, token: "zt_abc" });
  await standalone.auth.me();
  assert.equal(last().headers.authorization, "Bearer zt_abc");
  assert.equal(last().headers["x-wp-nonce"], undefined);

  // Standalone password sign-in returns the user and keeps the pair; signOut ends the session server-side first.
  const anon = mod.createClient({ url });
  await anon.auth.me();
  assert.equal(last().headers.authorization, undefined);
  assert.deepEqual(await anon.auth.login("alice", "pw"), alice);
  assert.deepEqual(JSON.parse(last().body.toString()), { grant_type: "password", name: "alice", password: "pw" });
  assert.deepEqual({ ...anon.auth.session(), expiresAt: typeof anon.auth.session()?.expiresAt }, { accessToken: "za_1", refreshToken: "zr_1", expiresAt: "number" });
  await anon.auth.me();
  await anon.auth.signOut();
  await anon.auth.me();
  assert.deepEqual(lines().slice(-3), ["GET /api/me Bearer za_1", "DELETE /api/auth/session Bearer za_1", "GET /api/me -"]);
  assert.equal(anon.auth.session(), null);
  // Redirect sign-in is WordPress's; password sign-in is standalone's.
  assert.equal((await anon.auth.signIn().catch((e: unknown) => e)).code, "not_supported");
  assert.equal((await wpMod.createClient({ url }).auth.login("alice", "pw").catch((e: unknown) => e)).code, "not_supported");

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

test("a 401 unauthenticated refreshes once and retries once; a refused refresh forgets the session and surfaces the 401", async () => {
  const zero = mod.createClient({ url });
  reply = () => tokens(1, { id: 2, name: "alice", role: "author" });
  await zero.auth.login("alice", "a long password");

  // za_1 has expired: the server takes only za_2, which the rotated refresh hands out.
  seen = [];
  reply = (s) =>
    s.path === "/api/auth/token" ? tokens(2, { id: 2, name: "alice", role: "author" }) : s.headers.authorization === "Bearer za_2" ? ok([{ id: 1 }])() : problem(401, "unauthenticated");
  assert.deepEqual(await zero.posts.list(), [{ id: 1 }]);
  await zero.posts.list();
  assert.deepEqual(lines(), [
    "GET /api/posts Bearer za_1",
    'POST /api/auth/token - {"grant_type":"refresh_token","refreshToken":"zr_1"}',
    "GET /api/posts Bearer za_2",
    "GET /api/posts Bearer za_2",
  ]);
  assert.equal(zero.auth.session()?.refreshToken, "zr_2");

  // The server now refuses every access token and rotates the refresh token only once. The first write
  // refreshes and retries once, then surfaces the 401; the next one finds the refresh token dead, gets the
  // request's own 401, and the session is gone.
  seen = [];
  let rotations = 0;
  reply = (s) => (s.path === "/api/auth/token" ? (rotations++ === 0 ? tokens(3, null) : problem(401, "invalid_grant")) : problem(401, "unauthenticated"));
  for (const title of ["x", "y"]) {
    const err = await zero.posts.create({ title }).catch((e: unknown) => e);
    assert.deepEqual([err instanceof mod.ZeroError, err.status, err.code], [true, 401, "unauthenticated"]);
  }
  assert.deepEqual(lines(), [
    'POST /api/posts Bearer za_2 {"title":"x"}',
    'POST /api/auth/token - {"grant_type":"refresh_token","refreshToken":"zr_2"}',
    'POST /api/posts Bearer za_3 {"title":"x"}',
    'POST /api/posts Bearer za_3 {"title":"y"}',
    'POST /api/auth/token - {"grant_type":"refresh_token","refreshToken":"zr_3"}',
  ]);
  assert.equal(zero.auth.session(), null);
});

test("guests: the first unauthenticated write starts a guest session and retries; reads don't; upgrade keeps the session", async () => {
  const guest = { id: 7, name: "Guest", role: "guest" };
  reply = (s) => {
    if (s.path === "/api/auth/guest") return tokens(1, guest);
    if (s.path === "/api/auth/guest/upgrade") return ok({ user: { ...guest, name: "gina", role: "subscriber" } })();
    return s.headers.authorization ? ok({ id: 1 })() : problem(401, "unauthenticated");
  };
  const zero = mod.createClient({ url, auth: { guests: true } });

  seen = [];
  assert.equal((await zero.posts.list().catch((e: unknown) => e)).code, "unauthenticated");
  assert.deepEqual(await zero.posts.create({ title: "Hi" }), { id: 1 });
  assert.deepEqual(await zero.auth.upgrade("gina", "a long password"), { id: 7, name: "gina", role: "subscriber" });
  await zero.posts.create({ title: "Again" });
  assert.deepEqual(lines(), [
    "GET /api/posts -",
    'POST /api/posts - {"title":"Hi"}',
    "POST /api/auth/guest - {}",
    'POST /api/posts Bearer za_1 {"title":"Hi"}',
    'POST /api/auth/guest/upgrade Bearer za_1 {"name":"gina","password":"a long password"}',
    'POST /api/posts Bearer za_1 {"title":"Again"}',
  ]);

  // Without `guests`, the same write just fails.
  seen = [];
  assert.equal((await mod.createClient({ url }).posts.create({ title: "Hi" }).catch((e: unknown) => e)).code, "unauthenticated");
  assert.equal(seen.length, 1);
});

test("guests: two first writes in flight share one guest, even when one 401 lands after the guest exists", async () => {
  // A fetch stub with manual control: each request waits until the test releases it.
  const pending: { url: string; init: RequestInit; release: (r: Response) => void }[] = [];
  const fetch = (url: string, init: RequestInit) => new Promise<Response>((release) => pending.push({ url, init, release }));
  const zero = mod.createClient({ url: "http://x/api", fetch, auth: { guests: true } });
  // Microtask turns only (no timers); a bounded count so a regression fails instead of hanging.
  const until = async (n: number) => {
    for (let turn = 0; pending.length < n; turn++) {
      if (turn > 10_000) throw new Error(`expected ${n} requests, saw ${pending.map((p) => p.url).join(", ")}`);
      await Promise.resolve();
    }
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const denied = () => json(401, { type: "about:blank", title: "Unauthorized", status: 401, code: "unauthenticated", detail: "no" });

  const a = zero.posts.create({ title: "a" });
  const b = zero.posts.create({ title: "b" });
  await until(2);
  pending[0].release(denied());                       // a's 401 starts the guest
  await until(3);
  assert.equal(pending[2].url, "http://x/api/auth/guest");
  pending[2].release(json(201, { data: { accessToken: "za_g", refreshToken: "zr_g", expiresIn: 300, user: { id: 9, name: "Guest", role: "guest" } } }));
  await until(4);                                      // a retries with the guest
  pending[1].release(denied());                        // b's 401 arrives after the guest exists
  await until(5);
  assert.equal(pending[4].url, "http://x/api/posts", "b retries with the existing guest instead of starting another");
  pending[3].release(json(201, { data: { id: 1 } }));
  pending[4].release(json(201, { data: { id: 2 } }));
  assert.deepEqual([await a, await b], [{ id: 1 }, { id: 2 }]);
  assert.equal(pending.filter((p) => p.url.endsWith("/auth/guest")).length, 1, "one guest");
  assert.deepEqual([pending[3], pending[4]].map((p) => (p.init.headers as Record<string, string>).authorization), ["Bearer za_g", "Bearer za_g"]);
});

test("WP signIn redirects to <issuer>/authorize with PKCE S256, state and nonce kept in sessionStorage", async () => {
  const browser = stubBrowser();
  try {
    seen = [];
    reply = (s) => (s.path === "/wp-json/zero/v1/auth/config" ? ok({ issuer: `${origin}/identity`, guests: true })() : problem(404, "not_found"));
    const zero = wpMod.createClient({ url: `${origin}/wp-json/zero/v1`, auth: { clientId: "app_blog", redirectUri: "https://blog.test/callback" } });
    void zero.auth.signIn({ returnTo: "/drafts" });
    const to = new URL(await browser.navigated);

    // No issuer option: it comes from /auth/config.
    assert.deepEqual(lines(), ["GET /wp-json/zero/v1/auth/config -"]);
    assert.equal(`${to.origin}${to.pathname}`, `${origin}/identity/authorize`);
    const pkce = JSON.parse(browser.store.get("zero.auth.pkce") ?? "{}");
    assert.deepEqual(Object.fromEntries(to.searchParams), {
      response_type: "code",
      client_id: "app_blog",
      redirect_uri: "https://blog.test/callback",
      scope: "openid profile email",
      state: pkce.state,
      nonce: pkce.nonce,
      code_challenge: sha256url(pkce.verifier),
      code_challenge_method: "S256",
    });
    // 64 / 32 / 32 random bytes, base64url.
    assert.deepEqual(
      [pkce.verifier, pkce.state, pkce.nonce].map((v: string) => /^[A-Za-z0-9_-]+$/.test(v) && v.length),
      [86, 43, 43],
    );
    assert.equal(pkce.returnTo, "/drafts");

    const missing = await wpMod.createClient({ url, auth: { issuer: `${origin}/identity` } }).auth.signIn().catch((e: unknown) => e);
    assert.deepEqual([missing.status, missing.code], [400, "invalid_input"]);
  } finally {
    browser.restore();
  }
});

test("WP handleCallback refuses a foreign state, exchanges the code with the verifier, and signOut revokes then logs out", async () => {
  const issuer = `${origin}/identity`;
  const auth = { issuer, clientId: "app_blog", redirectUri: "https://blog.test/callback", storage: "session" };
  const base = `${origin}/wp-json/zero/v1`;
  const pkce = JSON.stringify({ verifier: "v".repeat(86), state: "s".repeat(43), nonce: "n".repeat(43) });
  const member = { id: 3, name: "ann", role: "subscriber", member: { id: 3, email: "ann@x.test" } };
  reply = (s) => {
    if (s.path === "/identity/token") return { status: 200, body: JSON.stringify({ access_token: "at_1", refresh_token: "rt_1", expires_in: 3600, id_token: "h.p.s", token_type: "Bearer" }) };
    if (s.path === "/identity/revoke") return { status: 200, body: "{}" };
    return ok(member)();
  };

  const forged = stubBrowser("?code=c0de&state=other");
  try {
    forged.store.set("zero.auth.pkce", pkce);
    seen = [];
    const err = await wpMod.createClient({ url: base, auth }).auth.handleCallback().catch((e: unknown) => e);
    assert.deepEqual([err instanceof wpMod.ZeroError, err.code], [true, "invalid_state"]);
    assert.deepEqual(seen, []);
  } finally {
    forged.restore();
  }

  const browser = stubBrowser(`?code=c0de&state=${"s".repeat(43)}`);
  try {
    browser.store.set("zero.auth.pkce", pkce);
    const zero = wpMod.createClient({ url: base, auth });
    seen = [];
    assert.deepEqual(await zero.auth.handleCallback(), member);
    assert.deepEqual([seen[0].path, seen[0].headers["content-type"], seen[0].headers.authorization], ["/identity/token", "application/x-www-form-urlencoded", undefined]);
    assert.deepEqual(form(seen[0]), {
      grant_type: "authorization_code",
      code: "c0de",
      redirect_uri: "https://blog.test/callback",
      client_id: "app_blog",
      code_verifier: "v".repeat(86),
    });
    assert.deepEqual([seen[1].path, seen[1].headers.authorization], ["/wp-json/zero/v1/me", "Bearer at_1"]);
    assert.equal(browser.store.has("zero.auth.pkce"), false);
    const kept = JSON.parse(browser.store.get(`zero.auth:${base}`) ?? "{}");
    assert.deepEqual({ ...kept, expiresAt: typeof kept.expiresAt }, { accessToken: "at_1", refreshToken: "rt_1", expiresAt: "number", clientId: "app_blog", idToken: "h.p.s" });

    seen = [];
    await zero.auth.signOut({ returnTo: "https://blog.test/" });
    assert.deepEqual([seen.length, seen[0].path, form(seen[0])], [1, "/identity/revoke", { token: "rt_1", client_id: "app_blog" }]);
    assert.equal(browser.store.has(`zero.auth:${base}`), false);
    const logout = new URL(await browser.navigated);
    assert.deepEqual(
      [`${logout.origin}${logout.pathname}`, Object.fromEntries(logout.searchParams)],
      [`${issuer}/logout`, { id_token_hint: "h.p.s", post_logout_redirect_uri: "https://blog.test/" }],
    );
  } finally {
    browser.restore();
  }
});

test("WP guests refresh at <issuer>/token with the clientId they were issued, and upgrade hands off to the issuer", async () => {
  const browser = stubBrowser();
  try {
    const base = `${origin}/wp-json/zero/v1`;
    const zero = wpMod.createClient({ url: base, auth: { issuer: `${origin}/identity`, clientId: "app_blog", redirectUri: "https://blog.test/callback" } });
    reply = (s) => {
      if (s.path === "/wp-json/zero/v1/auth/guest") return tokens(1, { id: 9, name: "Guest", role: "guest" }, { clientId: "app_zero_guest" });
      if (s.path === "/identity/token") return { status: 200, body: JSON.stringify({ access_token: "at_2", refresh_token: "rt_2", expires_in: 3600 }) };
      if (s.path === "/identity/handoff") return { status: 200, body: JSON.stringify({ handoff: "h1.secret" }) };
      return s.headers.authorization === "Bearer at_2" ? ok({ id: 1 })() : problem(401, "unauthenticated");
    };
    assert.equal((await zero.auth.guest()).role, "guest");

    seen = [];
    await zero.posts.create({ title: "Hi" });
    assert.deepEqual(
      seen.map((s) => [s.path, s.headers.authorization ?? "-"]),
      [["/wp-json/zero/v1/posts", "Bearer za_1"], ["/identity/token", "-"], ["/wp-json/zero/v1/posts", "Bearer at_2"]],
    );
    assert.deepEqual(form(seen[1]), { grant_type: "refresh_token", refresh_token: "zr_1", client_id: "app_zero_guest" });

    seen = [];
    void zero.auth.upgrade();
    const to = new URL(await browser.navigated);
    assert.deepEqual([seen[0].path, seen[0].headers.authorization], ["/identity/handoff", "Bearer at_2"]);
    assert.deepEqual([to.pathname, to.searchParams.get("handoff"), to.searchParams.get("code_challenge_method")], ["/identity/authorize", "h1.secret", "S256"]);
  } finally {
    browser.restore();
  }
});
