// @typedpress/astro against a real TypedPress site: test/fixture built with `typedpress build` and served on
// WordPress-on-SQLite (tests/php/wp.php serve). Needs PHP 8.2+ with pdo_sqlite, the `typedpress` binary
// (TP_BIN, default target/debug/typedpress) and `npm ci` here. The Astro build at the end needs the
// Node version Astro requires (22.23.4+).
//
//   node --test packages/astro/test/loader.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { tpLiveLoader, tpLoader, tpWebhook, verifySignature } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const bin = process.env.TP_BIN ?? join(repo, "target/debug/typedpress");
const SECRET = "whsec_astro_test";

const work = mkdtempSync(join(tmpdir(), "typedpress-astro-"));
let site; // { url, users, wpCli }
let server; // the php serve process
const deliveries = []; // { headers, body } POSTed to the receiver
let receiver;
let hooks; // the receiver's server

async function api(method, path, body, as = "admin") {
  const headers = { accept: "application/json", authorization: `Basic ${btoa(site.users[as].appPassword)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${site.url}/__tp/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json.data;
}

/** Runs a command without blocking this process (the webhook receiver answers from it meanwhile). */
function run(command, args, env = process.env) {
  return new Promise((done) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

/** The site's background work, as a host runs it (`wp typedpress jobs tick`) until none is left: delivers queued webhooks. */
async function tick() {
  const wp = (...args) => run("php", ["-d", "memory_limit=512M", site.wpCli.phar, `--path=${site.wpCli.path}`, `--url=${site.url}`, "typedpress", ...args],
    { ...process.env, ASTRO_HOOK_URL: receiver, ASTRO_HOOK_SECRET: SECRET });
  for (let pass = 0; pass < 20; pass++) {
    const out = await wp("jobs", "tick", "--limit=100");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const report = JSON.parse(out.stdout.slice(out.stdout.indexOf("{"))).data;
    if (report.failures > 0) assert.fail(`jobs tick: ${out.stdout}\n${(await wp("jobs", "list")).stdout}`);
    if (!report.remaining) return;
  }
  assert.fail("jobs tick never finished");
}

before(async () => {
  assert.ok(existsSync(bin), `build the compiler first (cargo build --bin typedpress), or set TP_BIN; ${bin} is missing`);
  const project = join(work, "app");
  cpSync(join(here, "fixture"), project, { recursive: true });
  const built = spawnSync(bin, ["build", project, "--quiet"], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);

  hooks = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      deliveries.push({ headers: req.headers, body });
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => hooks.listen(0, "127.0.0.1", r));
  receiver = `http://127.0.0.1:${hooks.address().port}/api/tp`;

  server = spawn("php", ["-d", "memory_limit=512M", join(repo, "tests/php/wp.php"), "serve", join(project, "tp/dist/wp-content"), "ed=editor"], {
    env: { ...process.env, TP_WP_CLI: "1", ASTRO_HOOK_URL: receiver, ASTRO_HOOK_SECRET: SECRET },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const line = await new Promise((resolveLine, reject) => {
    const rl = createInterface({ input: server.stdout });
    rl.once("line", resolveLine);
    server.once("exit", (code) => reject(new Error(`wp.php serve exited ${code}`)));
  });
  site = JSON.parse(line);

  // Seven published notes, one draft, a memo only editors read, a cover image.
  // A 1x1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "cover.png");
  form.append("alt", "A cover");
  const upload = await fetch(`${site.url}/__tp/api/v1/media`, { method: "POST", headers: { authorization: `Basic ${btoa(site.users.admin.appPassword)}` }, body: form });
  const cover = (await upload.json()).data;
  assert.equal(upload.status, 201);
  for (let i = 1; i <= 7; i++) {
    await api("POST", "/notes", {
      title: `Note ${i}`,
      summary: `Summary ${i}`,
      body: `<!-- wp:paragraph -->\n<p>Body of note <strong>${i}</strong></p>\n<!-- /wp:paragraph -->`,
      rank: i,
      memo: `secret ${i}`,
      ...(i === 1 ? { cover: cover.id, featured: true } : {}),
    });
  }
  await api("POST", "/notes", { title: "Unfinished", status: "draft" });
  await tick(); // the creates' webhooks: delivered now, so later counts start from zero
  deliveries.length = 0;
});

after(() => {
  hooks?.close();
  server?.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
});

/** Astro's LoaderContext, in memory, recording what the loader writes. */
function context(kind, state = { entries: new Map(), meta: new Map() }) {
  const writes = [];
  const logs = [];
  return {
    state,
    writes,
    logs,
    collection: kind,
    store: {
      get: (id) => state.entries.get(id),
      set: (entry) => {
        writes.push(entry.id);
        state.entries.set(entry.id, entry);
        return true;
      },
      has: (id) => state.entries.has(id),
      keys: () => [...state.entries.keys()],
      values: () => [...state.entries.values()],
      entries: () => [...state.entries.entries()],
      delete: (id) => state.entries.delete(id),
      clear: () => state.entries.clear(),
      addModuleImport() {},
    },
    meta: {
      get: (k) => state.meta.get(k),
      set: (k, v) => state.meta.set(k, v),
      has: (k) => state.meta.has(k),
      delete: (k) => state.meta.delete(k),
    },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m), debug() {} },
    parseData: async ({ data }) => data,
    generateDigest: (data) => JSON.stringify(data),
  };
}

/** A fetch that records each request: method, path and the `_live` answers' `changed` flags. */
function recording() {
  const calls = [];
  const fetchFn = async (url, init) => {
    const response = await fetch(url, init);
    const text = await response.text();
    const call = { method: init.method, path: new URL(url).pathname + new URL(url).search };
    if (call.path.endsWith("/_live")) call.changed = JSON.parse(text).data.results.map((r) => r.changed);
    calls.push(call);
    return new Response(text, { status: response.status, headers: response.headers });
  };
  return { calls, fetch: fetchFn };
}

test("a build-time collection holds the published rows, with media rows, rendered HTML and only what the reader may see", async () => {
  const rec = recording();
  const loader = tpLoader("notes", { site: site.url, fetch: rec.fetch, pageSize: 3 });
  const ctx = context("notes");
  await loader.load(ctx);
  const ids = [...ctx.state.entries.keys()].sort();
  assert.deepEqual(ids, ["note-1", "note-2", "note-3", "note-4", "note-5", "note-6", "note-7"]);
  const one = ctx.state.entries.get("note-1");
  assert.equal(one.data.title, "Note 1");
  assert.equal(one.data.featured, true);
  assert.equal(one.data.cover.alt, "A cover");
  assert.match(one.data.cover.url, /^http:\/\/127\.0\.0\.1:\d+\/wp-content\/uploads\/.+\.png$/);
  assert.equal("memo" in one.data, false, "an anonymous build never sees an editor-only field");
  assert.match(one.rendered.html, /<p[^>]*>Body of note <strong>1<\/strong><\/p>/);
  // Key ranges of at most three rows that cover every key once.
  const pages = JSON.parse(ctx.state.meta.get("typedpress:pages")).pages;
  assert.equal(pages[0].lo, null);
  assert.equal(pages.at(-1).hi, null);
  assert.ok(pages.every((p, i) => i === 0 || p.lo === pages[i - 1].hi), JSON.stringify(pages));
  assert.deepEqual(pages.map((p) => p.ids.length), [3, 3, 1]);
});

test("the next build pulls only the pages that changed, and only their changed entries are written", async () => {
  const rec = recording();
  const loader = tpLoader("notes", { site: site.url, fetch: rec.fetch, pageSize: 3 });
  const ctx = context("notes");
  await loader.load(ctx);
  const state = ctx.state;

  // Nothing changed: every page answers "not modified", no rows and no HTML are fetched.
  rec.calls.length = 0;
  const same = context("notes", state);
  await loader.load(same);
  assert.deepEqual(same.writes, []);
  const reads = () => rec.calls.filter((c) => c.path !== "/__tp/api/v1").map((c) => c.changed ?? c.path.split("?")[0]);
  assert.deepEqual(reads(), [[false, false, false]], "one request, no rows, no HTML");
  assert.match(same.logs.at(-1), /0 changed, 0 removed, 7 entries, 3 of 3 pages not modified/);

  // One edit: only its page comes back, and only its entry is written.
  const notes = await api("GET", "/notes?orderBy=id");
  await api("PATCH", `/notes/${notes[4].id}`, { summary: "Edited" });
  rec.calls.length = 0;
  const edited = context("notes", state);
  await loader.load(edited);
  assert.deepEqual(edited.writes, ["note-5"]);
  assert.equal(state.entries.get("note-5").data.summary, "Edited");
  assert.deepEqual(reads(), [[false, true, false], "/"], "the changed page, then rendered HTML for its one changed entry");

  // A note unpublished and one deleted leave the collection; a new one joins the last page.
  await api("PATCH", `/notes/${notes[1].id}`, { status: "draft" });
  await api("DELETE", `/notes/${notes[6].id}`);
  await api("POST", "/notes", { title: "Note 8", rank: 8 });
  const changed = context("notes", state);
  await loader.load(changed);
  assert.deepEqual([...state.entries.keys()].sort(), ["note-1", "note-3", "note-4", "note-5", "note-6", "note-8"]);
  assert.deepEqual(changed.writes, ["note-8"]);
  assert.match(changed.logs.at(-1), /1 changed, 2 removed, 6 entries/);

  // Pages that fill split: twelve more notes, read in pages of three again.
  for (let i = 9; i <= 20; i++) await api("POST", "/notes", { title: `Note ${i}`, rank: i });
  const grown = context("notes", state);
  await loader.load(grown);
  assert.equal(state.entries.size, 18);
  const pages = JSON.parse(state.meta.get("typedpress:pages")).pages;
  assert.ok(pages.every((p, i) => i === 0 || p.lo === pages[i - 1].hi), JSON.stringify(pages));
  assert.ok(pages.every((p) => p.ids.length <= 3), JSON.stringify(pages));
  rec.calls.length = 0;
  const again = context("notes", state);
  await loader.load(again);
  assert.deepEqual(again.writes, []);
  assert.deepEqual(reads(), [pages.map(() => false)]);

  // Another query is another collection: its saved pages are not reused.
  const featured = context("notes", state);
  await tpLoader("notes", { site: site.url, where: { featured: true } }).load(featured);
  assert.deepEqual([...state.entries.keys()], ["note-1"]);

  // Restore what later tests expect.
  await api("PATCH", `/notes/${notes[1].id}`, { status: "published" });
});

test("an editor's credentials read drafts and editor-only fields when asked", async () => {
  const ctx = context("notes");
  await tpLoader("notes", { site: site.url, appPassword: site.users.ed.appPassword, drafts: true }).load(ctx);
  const draft = [...ctx.state.entries.values()].find((e) => e.data.title === "Unfinished");
  assert.equal(draft?.data.status, "draft");
  assert.equal(ctx.state.entries.get("note-1").data.memo, "secret 1");
});

test("the schema comes from the site's description", async () => {
  const { schema, types } = await tpLoader("notes", { site: site.url }).createSchema();
  const parsed = schema.parse({ id: 1, title: "T", slug: "t", summary: null, body: null, cover: { id: 3, url: "u" }, rank: 2, featured: false, status: "published", publishedAt: null });
  assert.equal(parsed.rank, 2);
  assert.throws(() => schema.parse({ id: 1, title: 5 }), /title/);
  assert.match(types, /title: string;/);
  assert.match(types, /status: "draft" \| "published" \| "scheduled";/);
  assert.match(types, /memo\?: string \| null;/);
  assert.match(types, /cover: \{ id: number; url: string;/);
  await assert.rejects(tpLoader("nope", { site: site.url }).createSchema(), /has no kind 'nope' \(it has notes, fieldNotes, /);
});

test("WordPress's own kinds load through the list API, filtered with core's parameters", async () => {
  const ctx = context("posts");
  await tpLoader("posts", { site: site.url }).load(ctx);
  assert.equal(ctx.state.entries.get("hello-world")?.data.title, "Hello world!");
  await assert.rejects(tpLoader("posts", { site: site.url, where: { slug: "x" } }).load(context("posts")), /WordPress's own kind; its reads take core's filters/);
  const live = tpLiveLoader("posts", { site: site.url });
  assert.equal((await live.loadEntry({ filter: { id: "hello-world" } })).data.title, "Hello world!");
  assert.equal(await live.loadEntry({ filter: { id: "no-such-post" } }), undefined, "a missing slug is no entry, not the newest post");
  assert.match((await live.loadEntry({ filter: { where: { slug: "hello-world" } } })).error.message, /core's filters/);
  const searched = await live.loadCollection({ filter: { query: { search: "Hello" } } });
  assert.deepEqual(searched.entries.map((e) => e.id), ["hello-world"]);
});

test("a kind is named by its client key or its storage name; tags and events use the storage name", async () => {
  for (const site_ of ["a", "a", "b"]) await api("POST", "/field_notes", { title: `From ${site_} ${Math.random()}`, site: site_ });
  for (const name of ["fieldNotes", "field_notes"]) {
    const ctx = context(name);
    await tpLoader(name, { site: site.url }).load(ctx);
    assert.equal(ctx.state.entries.size, 3, name);
  }
  const live = tpLiveLoader("fieldNotes", { site: site.url, where: { site: "a" } });
  const list = await live.loadCollection({ filter: {} });
  assert.equal(list.entries.length, 2);
  assert.equal(list.cacheHint.tags[0], "field_notes");
  const other = (await tpLiveLoader("fieldNotes", { site: site.url }).loadCollection({ filter: { where: { site: "b" } } })).entries[0];
  assert.equal(await live.loadEntry({ filter: { id: other.id } }), undefined, "the loader's where holds for an entry too");
  assert.equal((await live.loadEntry({ filter: { id: list.entries[0].id, site: "a" } })).id, list.entries[0].id, "id and fields together");
});

test("a live collection reads at request time and tags entries for the cache", async () => {
  const live = tpLiveLoader("notes", { site: site.url });
  const list = await live.loadCollection({ filter: { orderBy: { rank: "asc" }, limit: 2 } });
  assert.equal(list.error, undefined, list.error?.message);
  assert.deepEqual(list.entries.map((e) => e.id), ["note-1", "note-2"]);
  const first = list.entries[0];
  assert.deepEqual(first.cacheHint.tags, [`notes:${first.data.id}`, `media:${first.data.cover.id}`]);
  assert.deepEqual(list.cacheHint.tags, ["notes", `notes:${first.data.id}`, `media:${first.data.cover.id}`, `notes:${list.entries[1].data.id}`]);

  const entry = await live.loadEntry({ filter: { id: "note-3" } });
  assert.equal(entry.data.title, "Note 3");
  assert.match(entry.rendered.html, /Body of note <strong>3<\/strong>/);
  assert.deepEqual(entry.cacheHint.tags, [`notes:${entry.data.id}`]);
  assert.equal(await live.loadEntry({ filter: { id: "no-such-note" } }), undefined);
  assert.equal(await live.loadEntry({ filter: { id: "unfinished" } }), undefined, "drafts stay out");
  const byField = await live.loadEntry({ filter: { rank: 4 } });
  assert.equal(byField.id, "note-4");

  // One loader for every kind: the filter names it.
  const any = tpLiveLoader({ site: site.url });
  assert.equal((await any.loadEntry({ filter: { kind: "notes", id: "note-6" } })).data.title, "Note 6");
  assert.match((await any.loadCollection({ filter: {} })).error.message, /name one/);
  assert.match((await any.loadCollection({ filter: { kind: "nope" } })).error.message, /has no kind 'nope'/);
  assert.equal((await tpLiveLoader("notes", { site: "http://127.0.0.1:1" }).loadCollection({ filter: {} })).error.code, "network");
});

test("a write is delivered as a signed webhook the Astro endpoint verifies and turns into cache tags", async () => {
  await tick(); // what earlier tests queued
  deliveries.length = 0;
  const [note] = await api("GET", `/notes?where=${encodeURIComponent(JSON.stringify({ slug: "note-3" }))}`);
  await api("PATCH", `/notes/${note.id}`, { title: "Note 3, edited" });
  await tick();
  assert.equal(deliveries.length, 1, JSON.stringify(deliveries));
  const [hit] = deliveries;
  assert.equal(hit.headers["typedpress-event"], "notes.updated");

  const invalidated = [];
  const events = [];
  const endpoint = tpWebhook({ secret: SECRET, onEvent: ({ tags }) => events.push(tags) });
  const call = (body, signature) => endpoint({
    request: new Request("http://astro.test/api/tp", { method: "POST", body, headers: { "typedpress-signature": signature } }),
    cache: { enabled: true, invalidate: async (o) => invalidated.push(o.tags) },
  });
  const ok = await call(hit.body, hit.headers["typedpress-signature"]);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { tags: ["notes", `notes:${note.id}`] });
  assert.deepEqual(invalidated, [["notes", `notes:${note.id}`]]);
  assert.deepEqual(events, [["notes", `notes:${note.id}`]]);

  assert.equal((await call(hit.body.replace("edited", "forged"), hit.headers["typedpress-signature"])).status, 401);
  assert.equal((await call(hit.body, "t=1,v1=00")).status, 401);
  const t = Number(/t=(\d+)/.exec(hit.headers["typedpress-signature"])[1]);
  assert.equal(await verifySignature(SECRET, hit.headers["typedpress-signature"], hit.body, (t + 301) * 1000), false, "five minutes' tolerance");
  assert.equal(await verifySignature("other", hit.headers["typedpress-signature"], hit.body, t * 1000), false);
  assert.equal(invalidated.length, 1);
});

test("astro build renders the collection, and a rebuild after an edit pulls only that entry", { timeout: 300_000 }, async (t) => {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major === 22 && (minor < 23 || (minor === 23 && patch < 4))) {
    assert.fail(`Astro 7.4 needs Node 22.23.4+; this is ${process.versions.node}`);
  }
  const out = join(work, "site");
  const build = () => {
    const run = spawnSync(process.execPath, [join(here, "../node_modules/astro/bin/astro.mjs"), "build", "--root", join(here, "site")], {
      // Astro writes its prerender chunks below the working directory; they import its packages.
      cwd: join(here, "site"),
      env: { ...process.env, TP_URL: site.url, ASTRO_TELEMETRY_DISABLED: "1", ASTRO_TEST_OUT: out },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    return run.stdout + run.stderr;
  };
  const log = build();
  assert.match(log, /notes: \d+ changed, 0 removed/);
  const index = readFileSync(join(out, "dist/index.html"), "utf8");
  assert.match(index, /Note 3, edited/);
  const page = readFileSync(join(out, "dist/notes/note-4/index.html"), "utf8");
  assert.match(page, /<h1>Note 4<\/h1>/);
  assert.match(page, /Body of note <strong>4<\/strong>/);

  const [note] = await api("GET", `/notes?where=${encodeURIComponent(JSON.stringify({ slug: "note-4" }))}`);
  await api("PATCH", `/notes/${note.id}`, { title: "Note 4, rebuilt" });
  const second = build();
  assert.match(second, /notes: 1 changed, 0 removed, \d+ entries, \d+ of \d+ pages not modified/);
  assert.match(readFileSync(join(out, "dist/notes/note-4/index.html"), "utf8"), /<h1>Note 4, rebuilt<\/h1>/);
  t.diagnostic(second.split("\n").find((l) => l.includes("notes:")));
});

