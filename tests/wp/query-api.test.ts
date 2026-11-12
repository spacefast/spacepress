// The query API (spec §3): a kind imported from "first:db" has list, paginate, get, count, create,
// update and delete, run as the visitor the request runs as: access rules, draft visibility and
// field masks apply. `<kind>.system.*` is the trusted escape hatch. Fixtures: tests/wp/app/first/lanes/rest.ts
// (`jottings`: editors read everything, others published rows and their own; `vault`: admin-only).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, harness, http, ok, run, first } from "./env.ts";

const tag = `Jot ${run}`;
const subscriber = harness.users.subscriber.id;

before(() => {
  first("insert", "jottings", JSON.stringify([
    { title: `${tag} a`, status: "published", note: "a needle" },
    { title: `${tag} b`, status: "published" },
    { title: `${tag} c`, status: "published" },
    { title: `${tag} d draft`, status: "draft", note: "needle" },
    { title: `${tag} e own draft`, status: "draft", ownerId: subscriber },
  ]));
  first("insert", "vault", JSON.stringify({ title: `Vault ${run}` }));
});

const query = (as?: "editor" | "subscriber") =>
  ok("GET", "/actions/jotQuery?" + new URLSearchParams({ input: JSON.stringify({ tag }) }), as ? { as } : {});

test("list, paginate, get and count run as the visitor: an anonymous visitor sees published rows only", async () => {
  const anon = await query();
  assert.deepEqual(anon.titles, [`${tag} a`, `${tag} b`, `${tag} c`]);
  assert.deepEqual(anon.statuses, ["published", "published", "published"]);
  assert.deepEqual(anon.pages[0], [`${tag} a`, `${tag} b`], "the first page holds `limit` rows");
  assert.deepEqual([anon.pages[1], anon.pages[2]], [[`${tag} c`], null], "the cursor reaches the last page, whose cursor is null");
  assert.deepEqual([anon.total, anon.searched, anon.get], [3, 1, `${tag} a`], "count and search see the same rows; get by filter, then by id");
  assert.deepEqual([anon.trusted, anon.trustedCount], [5, 5], "`.system` reads every row");
});

test("the read rule follows the signed-in visitor: their own draft for a subscriber, every row for an editor", async () => {
  const sub = await query("subscriber");
  assert.deepEqual(sub.titles, [`${tag} a`, `${tag} b`, `${tag} c`, `${tag} e own draft`]);
  assert.equal(sub.total, 4);
  const editor = await query("editor");
  assert.equal(editor.total, 5);
  assert.equal(editor.searched, 2, "a draft's note matches the search for an editor");
  assert.deepEqual(editor.pages[0], [`${tag} a`, `${tag} b`]);
  assert.equal(typeof editor.pages[2], "string", "more pages follow");
});

test("an admin-only kind: the visitor's read is refused as on the API, `.system` reads the row", async () => {
  const peek = (system?: number) => http("GET", `${api}/actions/vaultPeek?` + new URLSearchParams({ input: JSON.stringify({ title: `Vault ${run}`, ...(system ? { system } : {}) }) }), { as: "editor" });
  const denied = await peek();
  assert.deepEqual([denied.status, denied.json.code], [403, "forbidden"]);
  assert.deepEqual((await peek(1)).json.data, { system: `Vault ${run}`, count: 1 });
});

test("create, update and delete run the kind's write rules as the visitor", async () => {
  const write = (step: string, as?: "editor" | "subscriber") => http("POST", `${api}/actions/jotWrite`, { as, body: { tag, step } });
  const anon = await write("create");
  assert.deepEqual([anon.status, anon.json.code], [401, "unauthenticated"], "create needs a signed-in visitor");
  assert.deepEqual((await write("create", "subscriber")).json, { data: `${tag} written` });
  const row = first("find", "jottings", JSON.stringify({ where: { title: `${tag} written` } }))[0];
  assert.equal(row.note, "first");
  const denied = await write("update", "editor");
  assert.deepEqual(denied.json, { data: "second" }, "an editor's update rule covers every row");
  const gone = await write("delete", "subscriber");
  assert.deepEqual([gone.status, gone.json.code], [403, "forbidden"], "delete is for editors");
  assert.deepEqual((await write("delete", "editor")).json, { data: `${tag} written` });
  assert.deepEqual(first("find", "jottings", JSON.stringify({ where: { title: `${tag} written` } })), []);
});
