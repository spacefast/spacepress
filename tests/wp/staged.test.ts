// Staged versions (docs/staged.md) on WordPress and MariaDB, over HTTP as each kind of caller:
// anonymous, a subscriber (reader), an author who doesn't own the item, the author who does, an
// editor and an admin, each with an application password. Fixture: tests/wp/app/first/lanes/staged.ts.
// Concurrent stagers and promoters run against one item at once; MariaDB row locks decide.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, core, harness, http, ok, run, first, sql, wp, type Role } from "./env.ts";

const site = harness.url;
let mine = 0;
let other = 0;
const authorId = harness.users.author.id;

before(() => {
  // `mine` is owned by the author (their update rule covers it); `other` is nobody's.
  mine = first("insert", "bulletins", JSON.stringify({ title: `Live ${run}`, slug: `live-${run}`, body: "<p>live body</p>", summary: "live summary", ownerId: authorId, memo: "live memo" }))[0].id;
  other = first("insert", "bulletins", JSON.stringify({ title: `Other ${run}`, slug: `other-${run}`, body: "<p>other body</p>" }))[0].id;
});

const staged = (id: number, rest = "") => `${api}/bulletins/${id}/staged${rest}`;
const stagedRows = (id: number) => sql(`SELECT ID FROM wp_posts WHERE post_parent = ${id} AND post_name = '${id}-autosave-staged-v1'`).map((r) => Number(r.ID));
const logOf = (id: number) => sql(`SELECT \`change\`, \`by\` FROM wp_first_bulletin_log WHERE \`bulletinId\` = ${id} ORDER BY id`);

/** What a caller who may not update the item gets from every public surface of it. */
async function surfaces(as?: Role) {
  const opts = as ? { as } : {};
  const text = async (url: string) => (await fetch(url, as ? { headers: { Authorization: "Basic " + btoa(`${as}:${harness.users[as].appPassword}`) } } : {})).text();
  const item = (await http("GET", `${core}/first_bulletins/${mine}`, opts)).json;
  return {
    api: (await http("GET", `${api}/bulletins/${mine}`, opts)).json,
    list: (await http("GET", `${api}/bulletins?search=${run}`, opts)).json,
    // MySQL's FULLTEXT path: staged text must never be found.
    search: (await http("GET", `${api}/bulletins?search=stagedword${run}`, opts)).json,
    markdown: await text(`${api}/bulletins/${mine}?format=md`),
    core: [item.title, item.content?.raw ?? item.content?.rendered, item.slug, item.modified_gmt, item._links?.["version-history"], item._links?.["predecessor-version"]],
    page: await text(`${site}/bulletins/live-${run}/`),
    twin: await text(`${site}/bulletins/live-${run}.md`),
    stagedSlug: (await fetch(`${site}/bulletins/staged-${run}/`)).status,
    feed: (await text(`${site}/?feed=rss2&post_type=first_bulletins`)).replace(/<lastBuildDate>.*?<\/lastBuildDate>/, ""),
    llms: await text(`${site}/llms.txt`),
  };
}

test("a staged change is invisible to every reader until it is promoted", async () => {
  const before = { anonymous: await surfaces(), subscriber: await surfaces("subscriber") };
  const r = await http("PATCH", staged(mine), { as: "author", body: { title: `Staged ${run}`, body: `<p>stagedword${run}</p>`, slug: `staged-${run}` } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.data.row.title, r.json.data.fields, r.json.data.by.id], [`Staged ${run}`, ["title", "slug", "body"], authorId]);
  assert.deepEqual(stagedRows(mine), [r.json.data.id], "one staged revision");
  assert.deepEqual(logOf(mine), [], "staging runs no hook");
  assert.deepEqual({ anonymous: await surfaces(), subscriber: await surfaces("subscriber") }, before, "nothing a reader gets changed");
});

test("only a caller the update rule covers learns that a staged version exists", async () => {
  const shape = (r: { status: number; json: any }) => [r.status, r.json.code, String(r.json.detail).replace(/\d+/g, "N")];
  for (const who of [undefined, "subscriber", "editor"] as (Role | undefined)[]) {
    // The author who doesn't own `other` is an author too: use the item they don't own for that case.
    const target = who === "editor" ? null : mine;
    if (target === null) continue;
    for (const [method, rest, body] of [["GET", "", undefined], ["GET", "/compare", undefined], ["PATCH", "", { title: "x" }], ["POST", "/promote", undefined], ["DELETE", "", undefined], ["POST", "/preview", undefined]] as const) {
      const opts = { ...(who ? { as: who } : {}), ...(body ? { body } : {}) };
      const withStaged = await http(method, staged(target, rest), opts);
      assert.equal(withStaged.status, 404, `${who ?? "anonymous"} ${method} ${rest}`);
      assert.deepEqual(shape(withStaged), shape(await http(method, staged(999999999, rest), opts)), "the same as a missing item");
    }
  }
  // An author who doesn't own the item: the same 404, while the owner reads it.
  first("update", "bulletins", JSON.stringify({ id: other }), JSON.stringify({ ownerId: authorId + 1000 }));
  await ok("PATCH", `/bulletins/${other}/staged`, { as: "editor", body: { summary: "staged by the editor" } });
  for (const rest of ["", "/compare"]) assert.equal((await http("GET", staged(other, rest), { as: "author" })).status, 404, `author, not the owner, ${rest}`);
  assert.equal((await http("GET", staged(mine), { as: "author" })).status, 200, "the owner reads theirs");
  assert.equal((await http("GET", staged(mine), { as: "editor" })).status, 200, "an editor reads any");
  await ok("DELETE", `/bulletins/${other}/staged`, { as: "editor" });
});

test("compare masks a hidden field; an editor can't stage or promote it", async () => {
  const hidden = await http("PATCH", staged(mine), { as: "editor", body: { memo: "guess" } });
  assert.deepEqual([hidden.status, hidden.json.code, hidden.json.pointer], [403, "forbidden", "/memo"]);
  await ok("PATCH", `/bulletins/${mine}/staged`, { as: "admin", body: { memo: `staged memo ${run}` } });
  const asEditor = await ok("GET", `/bulletins/${mine}/staged/compare`, { as: "editor" });
  assert.deepEqual(asEditor.changes.map((c: any) => c.field), ["title", "slug", "body"]);
  assert.ok(!JSON.stringify(asEditor).includes("memo"), "the editor's comparison never names the hidden field");
  const asAdmin = await ok("GET", `/bulletins/${mine}/staged/compare`, { as: "admin" });
  assert.deepEqual(asAdmin.changes.find((c: any) => c.field === "memo"), { field: "memo", live: "live memo", staged: `staged memo ${run}` });
  const refused = await http("POST", staged(mine, "/promote"), { as: "editor" });
  assert.deepEqual([refused.status, refused.json.pointer], [403, "/memo"], "a promote is the promoter's update");
  assert.equal((await ok("GET", `/bulletins/${mine}`, { as: "admin" })).title, `Live ${run}`);
});

test("concurrent stagers and promoters of one item: each one runs alone, nothing is half-applied", async () => {
  // Ten stagers at once, each writing its own field value: every response is a success or a 409 to
  // retry, and the staged version holds exactly one stager's value: never two staged revisions.
  const writes = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    http("PATCH", staged(mine), { as: i % 2 ? "editor" : "author", body: { summary: `writer ${i}` } })));
  for (const w of writes) assert.ok(w.status === 200 || (w.status === 409 && w.json.code === "conflict"), JSON.stringify(w.json));
  assert.equal(stagedRows(mine).length, 1, "one staged revision whatever the interleaving");
  const winners = writes.filter((w) => w.status === 200).map((w) => w.json.data.row.summary);
  assert.ok(winners.length >= 1);
  assert.ok(winners.includes((await ok("GET", `/bulletins/${mine}/staged`, { as: "editor" })).row.summary));

  // Two promotes and a discard at once: exactly one wins; the item is updated at most once.
  // A staged admin-only field refuses an editor's promote even at its live value, as an update
  // would; start the race from a staged version without it, so either promoter may win.
  const summary = (await ok("GET", `/bulletins/${mine}/staged`, { as: "editor" })).row.summary;
  await ok("DELETE", `/bulletins/${mine}/staged`, { as: "admin" });
  await ok("PATCH", `/bulletins/${mine}/staged`, { as: "author", body: { title: `Staged ${run}`, body: `<p>stagedword${run}</p>`, slug: `staged-${run}`, summary } });
  const race = await Promise.all([
    http("POST", staged(mine, "/promote"), { as: "admin" }),
    http("POST", staged(mine, "/promote"), { as: "editor" }),
    http("DELETE", staged(mine), { as: "editor" }),
  ]);
  const succeeded = race.filter((r) => r.status === 200);
  assert.equal(succeeded.length, 1, JSON.stringify(race.map((r) => [r.status, r.json.code])));
  for (const r of race.filter((r) => r.status !== 200)) assert.ok([404, 409].includes(r.status), JSON.stringify(r.json));
  assert.deepEqual(stagedRows(mine), [], "the staged version ended once");
  const promoted = logOf(mine).filter((l) => l.change.endsWith(`Staged ${run}`));
  assert.equal(promoted.length, "title" in (succeeded[0].json.data ?? {}) ? 1 : 0, "one update, or none when the discard won");
  if (promoted.length === 0) {
    // The discard won: stage again and promote, to go on with a live staged title.
    await ok("PATCH", `/bulletins/${mine}/staged`, { as: "author", body: { title: `Staged ${run}`, body: `<p>stagedword${run}</p>`, slug: `staged-${run}` } });
    await ok("POST", `/bulletins/${mine}/staged/promote`, { as: "author" });
  }
});

test("a promote is an update: hooks, the new URL, search and the twin follow it", async () => {
  const row = await ok("GET", `/bulletins/${mine}`);
  assert.deepEqual([row.title, row.slug], [`Staged ${run}`, `staged-${run}`]);
  assert.match(JSON.stringify(logOf(mine).at(-1)), new RegExp(`Live ${run} -> Staged ${run}`));
  assert.equal((await fetch(`${site}/bulletins/staged-${run}/`)).status, 200);
  assert.match(await (await fetch(`${site}/bulletins/staged-${run}.md`)).text(), new RegExp(`stagedword${run}`));
  assert.equal((await ok("GET", `/bulletins?search=stagedword${run}`)).length, 1, "the promoted text is found");
  const history = await ok("GET", `/bulletins/${mine}/revisions`, { as: "editor" });
  assert.ok(history.length >= 2, "the promoted version stays in the history");
});

test("a unique field is checked when the staged version is promoted", async () => {
  first("update", "bulletins", JSON.stringify({ id: other }), JSON.stringify({ code: `taken-${run}` }));
  await ok("PATCH", `/bulletins/${mine}/staged`, { as: "editor", body: { code: `taken-${run}` } });
  const refused = await http("POST", staged(mine, "/promote"), { as: "admin" });
  assert.deepEqual([refused.status, refused.json.code, refused.json.pointer], [409, "unique_violation", "/code"]);
  assert.equal(stagedRows(mine).length, 1, "the refused promote kept the staged version");
  await ok("DELETE", `/bulletins/${mine}/staged`, { as: "editor" });
});

test("a preview link works without signing in, and stops when the staged version ends", async () => {
  await ok("PATCH", `/bulletins/${mine}/staged`, { as: "editor", body: { title: `Preview ${run}` } });
  const link = await ok("POST", `/bulletins/${mine}/staged/preview`, { as: "editor", body: { ttl: 120 } });
  const read = await http("GET", link.api);
  assert.deepEqual([read.status, read.json.data.row.title, "by" in read.json.data], [200, `Preview ${run}`, false]);
  assert.ok(!("memo" in read.json.data.row), "through an anonymous visitor's masks");
  const page = await fetch(link.url);
  const html = await page.text();
  assert.match(html, new RegExp(`Preview ${run}`));
  assert.match(page.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await http("GET", link.api.replace(/.$/, (c: string) => (c === "A" ? "B" : "A")))).status, 404, "a tampered link is not one");
  await ok("DELETE", `/bulletins/${mine}/staged`, { as: "editor" });
  assert.equal((await http("GET", link.api)).status, 404);
  assert.doesNotMatch(await (await fetch(link.url)).text(), new RegExp(`Preview ${run}`));
});

test("abilities: one per step, as each caller", async () => {
  const abilities = `${site}/wp-json/wp-abilities/v1`;
  // Core's run route: readonly abilities (get, compare) over GET with the input in the query, others POST.
  const runAbility = (name: string, input: { id: number; [k: string]: unknown }, as?: Role) => /-staged-(get|compare)$/.test(name)
    ? http("GET", `${abilities}/abilities/blog/${name}/run?input[id]=${input.id}`, as ? { as } : {})
    : http("POST", `${abilities}/abilities/blog/${name}/run`, { ...(as ? { as } : {}), body: { input } });
  const stagedByAgent = await runAbility("bulletins-stage", { id: mine, patch: { summary: `agent ${run}` } }, "editor");
  assert.deepEqual([stagedByAgent.status, stagedByAgent.json.fields], [200, ["summary"]]);
  for (const as of [undefined, "subscriber"] as (Role | undefined)[]) {
    for (const name of ["bulletins-staged-get", "bulletins-staged-compare", "bulletins-staged-promote", "bulletins-staged-discard", "bulletins-staged-preview"]) {
      const r = await runAbility(name, { id: mine }, as);
      assert.ok([401, 403, 404].includes(r.status), `${as ?? "anonymous"} ${name}: ${r.status}`);
      if (as !== undefined) assert.equal(r.status, 404, `${name}: a signed-in caller the rule doesn't cover gets the missing item's 404`);
    }
  }
  const promoted = await runAbility("bulletins-staged-promote", { id: mine }, "editor");
  assert.deepEqual([promoted.status, promoted.json.summary], [200, `agent ${run}`]);
  assert.equal((await http("GET", `${abilities}/abilities/blog/fixed-notes-stage`, { as: "admin" })).status, 404, "staged: false has none");
});

test("_rev: two writers with the same read, at once: one wins, the other is told what changed", async () => {
  const id = first("insert", "bulletins", JSON.stringify({ title: `Race ${run}`, slug: `race-${run}`, summary: "start", ownerId: authorId }))[0].id;
  const read = await ok("GET", `/bulletins/${id}`, { as: "editor" });
  assert.equal(typeof read._rev, "string");
  const writes = await Promise.all(["author", "editor", "admin", "editor", "author"].map((as, i) =>
    http("PATCH", `${api}/bulletins/${id}`, { as: as as Role, body: { summary: `writer ${i}`, _rev: read._rev } })));
  const won = writes.filter((w) => w.status === 200);
  assert.equal(won.length, 1, JSON.stringify(writes.map((w) => [w.status, w.json.code])));
  for (const lost of writes.filter((w) => w.status !== 200)) {
    assert.equal(lost.status, 409, JSON.stringify(lost.json));
    assert.ok(["stale_revision", "conflict"].includes(lost.json.code), JSON.stringify(lost.json));
    if (lost.json.code === "stale_revision") assert.deepEqual(lost.json.changed.fields, ["summary"]);
  }
  const after = await ok("GET", `/bulletins/${id}`, { as: "editor" });
  assert.equal(after.summary, won[0].json.data.summary);
  assert.equal(after._rev, won[0].json.data._rev, "the winner's answer carries the row's next _rev");
});

test("edit locks: the block editor's lock refuses other writers on the API, core REST and abilities; takeover takes it", async () => {
  const id = first("insert", "bulletins", JSON.stringify({ title: `Locked ${run}`, slug: `locked-${run}`, ownerId: authorId }))[0].id;
  // The admin has it open in the editor: core's own lock, set by core's own function.
  wp("eval", `require_once ABSPATH . 'wp-admin/includes/post.php'; wp_set_current_user(${harness.users.admin.id}); wp_set_post_lock(${id});`);
  const refused = await http("PATCH", `${api}/bulletins/${id}`, { as: "editor", body: { summary: "blocked" } });
  assert.deepEqual([refused.status, refused.json.code, refused.json.holder?.id], [409, "locked", harness.users.admin.id]);
  const core409 = await http("POST", `${core}/first_bulletins/${id}`, { as: "editor", body: { title: "blocked by core" } });
  assert.deepEqual([core409.status, core409.json.code], [409, "first_locked"]);
  const ability = await http("POST", `${site}/wp-json/wp-abilities/v1/abilities/blog/bulletins-update/run`, { as: "editor", body: { input: { id, patch: { summary: "blocked" } } } });
  assert.equal(ability.status, 409, JSON.stringify(ability.json));
  assert.equal((await http("PATCH", `${api}/bulletins/${id}`, { as: "subscriber", body: { summary: "x" } })).status, 404, "a reader learns of no lock");
  const taken = await http("PATCH", `${api}/bulletins/${id}`, { as: "editor", body: { summary: "taken over", takeover: true } });
  assert.deepEqual([taken.status, taken.json.data.summary], [200, "taken over"]);
  const holder = sql(`SELECT meta_value FROM wp_postmeta WHERE post_id = ${id} AND meta_key = '_edit_lock'`)[0].meta_value;
  assert.equal(holder.split(":")[1], String(harness.users.editor.id), "the lock is the taker's now, as the editor's Take over leaves it");
  assert.equal((await http("PATCH", `${api}/bulletins/${id}`, { as: "admin", body: { summary: "back" } })).json.code, "locked");
});
