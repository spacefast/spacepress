import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, harness, sql } from "../env.ts";

const marks = () => sql("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'wp_import_792d42d7667e9cbd939d'")[0]?.t;

const at = (path: string, init: RequestInit = {}) => fetch(`${harness.url}${path}`, { redirect: "manual", ...init });

test("0.8 endpoints answer at their original paths with 0.8 result rules", async () => {
  const ping = await at("/api/ping");
  assert.equal(ping.status, 200);
  assert.equal(ping.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await ping.text(), "ok");

  // ctx.env reads the same wp-config constant through env().
  assert.equal(await (await at("/api/banner")).text(), "from wp-config");

  const count = await at("/api/notes/count");
  assert.equal(count.status, 200);
  assert.match(count.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await count.json(), { count: 3 });

  // A returned row is JSON with 0.8's public string id.
  const note = await at("/api/notes/2");
  assert.equal(note.status, 200);
  const row = await note.json();
  assert.equal(row.id, "2");
  assert.equal(row.body, "second");
  const missing = await at("/api/notes/99");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "missing" });

  // readOnly POST: reads the JSON body; arrays become JSON.
  const search = await at("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "red" }) });
  assert.equal(search.status, 200);
  assert.deepEqual(await search.json(), ["first", "third"]);

  // Query values keep URLSearchParams semantics: first value, every value, byte-exact names.
  const tags = await at("/api/tags?t=a&t=b+c&user.id=7");
  assert.deepEqual(await tags.json(), { first: "a", all: ["a", "b c"], dotted: "7" });

  // 0.8's :splat took the rest of the path, decoded and joined with /, and also answered the bare prefix.
  assert.equal(await (await at("/api/files/docs/a%20b/c.txt")).text(), "file docs/a b/c.txt");
  assert.equal(await (await at("/api/files")).text(), "file ");
  assert.equal((await at("/api/files/a/..%2F..%2Fwp-config.php")).status, 404);

  // A number is text, like 0.8.
  const total = await at("/api/total");
  assert.equal(total.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await total.text(), "3");

  // Status and author headers survive; header names compare case-insensitively.
  const empty = await at("/api/notes", { method: "PUT", body: "" });
  assert.equal(empty.status, 400);
  assert.equal(empty.headers.get("x-reason"), "empty");
  const created = await at("/api/notes?tag=green", { method: "PUT", body: "fourth" });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const fourth = await created.json();
  assert.equal(fourth.body, "fourth");
  assert.equal(fourth.tag, "green");

  // empty() keeps its status; falling off the end answers 204.
  const refused = await at(`/api/notes/${fourth.id}`, { method: "DELETE" });
  assert.equal(refused.status, 412);
  const removed = await at(`/api/notes/${fourth.id}`, { method: "DELETE", headers: { "X-Confirm": "yes" } });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");
  assert.equal((await at(`/api/notes/${fourth.id}`)).status, 404);

  const home = await at("/go/home?ref=1");
  assert.equal(home.status, 303);
  assert.equal(home.headers.get("location"), "/?from=ref");
  assert.equal((await at("/go/home")).headers.get("location"), "/?from=direct");

  // A writing route that reads ctx.auth.userId refuses an anonymous caller with 401 before writing,
  // so the v2 client can start a guest session; 0.8 always had a guest identity here.
  const anonymous = await at("/api/marks", { method: "POST", body: "anonymous" });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, "unauthorized");
  assert.equal(sql(`SELECT COUNT(*) AS n FROM ${marks()} WHERE label = 'anonymous'`)[0]?.n, "0", "nothing was written");

  // A method the path does not declare answers 405; HEAD follows GET.
  assert.equal((await at("/api/ping", { method: "POST" })).status, 405);
  assert.equal((await at("/api/ping", { method: "HEAD" })).status, 200);
  // Application passwords are not route credentials; the call still runs as anyone.
  assert.equal((await at("/api/ping", { headers: auth("admin") })).status, 200);
});
