// Post-backed reads run against wp_posts + wp_postmeta for real (§3.5.1): typed CAST comparisons and
// ordering on meta, Ymd dates, UTC timestamps, `has` over SCF's serialized arrays, missing vs ''
// meta, the shared rejections, and relation filters / `with` across post↔post and post↔table,
// confined to target rows the viewer may read.
// The SQL text is pinned in tests/php/sql_test.php; this suite proves MariaDB agrees with it.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { api, core, http, ok, problem, qs, run, sql, wp, first } from "./env.ts";

const ids: Record<string, number> = {};
let post: any;

before(async () => {
  post = await ok("POST", "/posts", { as: "editor", body: { title: `Meta ${run}`, tags: ["guide", "release"] } });
  const rows = [
    { title: `A ${run}`, seats: 9, price: 2.5, open: true, day: "2026-01-09", startsAt: "2026-01-09T08:00:00.000Z", kinds: ["talk"], postId: post.id },
    { title: `B ${run}`, seats: 10, price: 10, open: false, day: "2026-02-01", startsAt: "2026-02-01T18:30:00.000Z", kinds: ["talk", "workshop"] },
    { title: `C ${run}`, seats: 100, price: 0.75, open: true, day: "2025-12-31", kinds: [] },
  ];
  for (const r of rows) ids[r.title[0]] = (await ok("POST", "/events", { as: "editor", body: r })).id;
  // An event with no `seats` meta row at all (as wp-admin leaves a never-saved field) next to C's ''.
  sql(`DELETE FROM wp_postmeta WHERE post_id = ${ids.A} AND meta_key = 'first_price'`);
  sql(`UPDATE wp_postmeta SET meta_value = '' WHERE post_id = ${ids.C} AND meta_key = 'first_startsAt'`);
});

const titles = async (where: object, extra: object = {}) =>
  (await ok("GET", "/events" + qs({ where: { AND: [where, { title: { like: `%${run}` } }] }, ...extra }))).map((e: any) => e.title[0]).join("");

test("typed comparisons and ordering on meta columns", async () => {
  // Numeric, not lexical: "10" < "9" as strings.
  assert.equal(await titles({ seats: { gte: 10 } }, { orderBy: "seats" }), "BC");
  assert.equal(await titles({}, { orderBy: "-seats" }), "CBA");
  assert.equal(await titles({ price: { lt: 3 } }, { orderBy: "price" }), "C");
  assert.equal(await titles({ open: true }, { orderBy: "title" }), "AC");
  assert.equal(await titles({ day: { gte: "2026-01-01" } }, { orderBy: "day" }), "AB");
  assert.equal(await titles({ startsAt: { gt: "2026-01-09T08:00:00.000Z" } }), "B");
  assert.equal(await titles({ kinds: { has: "talk" } }, { orderBy: "title" }), "AB");
  assert.equal(await titles({ kinds: { eq: [] } }), "C");
  // isNull covers both "no meta row" (A's price) and '' (C's startsAt).
  assert.equal(await titles({ OR: [{ price: { isNull: true } }, { startsAt: null }] }, { orderBy: "title" }), "AC");

  const [a] = await ok("GET", "/events" + qs({ where: { id: ids.A } }));
  assert.deepEqual(
    { seats: a.seats, price: a.price, open: a.open, day: a.day, startsAt: a.startsAt, kinds: a.kinds },
    { seats: 9, price: null, open: true, day: "2026-01-09", startsAt: "2026-01-09T08:00:00.000Z", kinds: ["talk"] },
  );
  // Storage forms SCF expects: Ymd dates, UTC "Y-m-d H:i:s", "1"/"0", serialized arrays.
  const meta = Object.fromEntries(sql(`SELECT meta_key AS k, meta_value AS v FROM wp_postmeta WHERE post_id = ${ids.B} AND meta_key LIKE 'first\\_%'`).map((r) => [r.k, r.v]));
  assert.deepEqual(
    [meta.first_day, meta.first_startsAt, meta.first_open, meta.first_kinds],
    ["20260201", "2026-02-01 18:30:00", "0", 'a:2:{i:0;s:4:"talk";i:1;s:8:"workshop";}'],
  );
});

test("operators that can't run on postmeta are rejected with the shared messages", async () => {
  await problem("GET", "/events" + qs({ where: { kinds: { in: ["talk"] } } }), {}, { status: 400, code: "invalid_query", pointer: "/where/kinds/in" });
  await problem("GET", "/posts" + qs({ where: { seo: { eq: {} } } }), {}, { status: 400, code: "invalid_query", pointer: "/where/seo/eq" });
  await problem("GET", "/posts" + qs({ orderBy: "tags" }), {}, { status: 400, code: "invalid_query", pointer: "/orderBy/tags" });
});

test("a post-backed timestamp refuses invalid dates", async () => {
  // The column type migrated datetimes use (docs/config-migration.md); 02-30 would roll into March.
  for (const startsAt of ["2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "tomorrow"]) {
    await problem("POST", "/events", { as: "editor", body: { title: `Bad ${run}`, startsAt } }, { status: 422, code: "invalid_input", pointer: "/startsAt" });
  }
});

test("a post-backed timestamp keeps whole UTC seconds", async () => {
  const created = await ok("POST", "/events", { as: "editor", body: { title: `Precise ${run}`, startsAt: "2026-01-01T10:00:00.789+02:00" } });
  assert.equal((await ok("GET", `/events/${created.id}`)).startsAt, "2026-01-01T08:00:00.000Z");
});

test("a json() meta value keeps {} apart from [] on WordPress", async () => {
  const e = await ok("POST", "/events", { as: "editor", body: { title: `Json ${run}`, extra: { a: {}, b: [] } } });
  assert.deepEqual((await ok("GET", `/events/${e.id}`)).extra, { a: {}, b: [] });
  const patch = { id: e.id, patch: { extra: { c: {} } } };
  wp("first", "run", "blog/events-update", `--input=${JSON.stringify(patch)}`, "--user=editor");
  assert.deepEqual((await ok("GET", `/events/${e.id}`)).extra, { c: {} });
  await ok("PATCH", `/events/${e.id}`, { as: "editor", body: { extra: { "1": 1, "0": 2 } } });
  assert.deepEqual((await ok("GET", `/events/${e.id}`)).extra, { "0": 2, "1": 1 });
});

test("relation filters and `with` across post↔post and post↔table", async () => {
  const comment = await ok("POST", "/comments", { as: "editor", body: { postId: post.id, name: "Staff", body: `On meta ${run}` } });
  // post → post through a meta reference: filtered on the target's serialized meta, target attached.
  const events = await ok("GET", "/events" + qs({ where: { post: { tags: { has: "release" } }, title: { like: `%${run}` } }, with: { post: true } }));
  assert.deepEqual(events.map((e: any) => [e.id, e.post.id]), [[ids.A, post.id]]);
  const posts = await ok("GET", "/posts" + qs({ where: { id: post.id, tags: { has: "release" }, comments: { body: { like: `%${run}` } } }, with: { comments: true } }));
  assert.deepEqual(posts.map((p: any) => [p.id, p.comments.map((c: any) => c.id)]), [[post.id, [comment.id]]]);
  // table → post: comments filtered by their post's title (an EXISTS over wp_posts), post attached.
  const comments = await ok("GET", "/comments" + qs({ where: { post: { title: `Meta ${run}` } }, with: { post: true } }), { as: "editor" });
  assert.deepEqual(comments.map((c: any) => [c.id, c.post.title]), [[comment.id, `Meta ${run}`]]);
});

test("relation filters only see target rows the viewer may read", async () => {
  // A draft author (post-backed, shorthand read + drafts) behind a published post.
  const ghost = await ok("POST", "/authors", { as: "admin", body: { name: `Ghost ${run}`, email: `price-42-${run}@example.test`, status: "draft" } });
  const byGhost = await ok("POST", "/posts", { as: "editor", body: { title: `By ghost ${run}`, authorId: ghost.id } });
  await ok("POST", "/signups", { as: "editor", body: { email: `sk-live-7-${run}@example.test`, postId: byGhost.id } });
  const where = (w: object) => qs({ where: { AND: [w, { id: byGhost.id }] } });
  const draftOracle = where({ author: { email: { like: `price-4%${run}%` } } });
  assert.deepEqual(await ok("GET", "/posts" + draftOracle), []);
  assert.deepEqual((await ok("GET", "/posts" + draftOracle, { as: "editor" })).map((p: any) => p.id), [byGhost.id]);
  // signups are editor-only: filtering through them is denied exactly like `with`.
  const keyOracle = where({ signups: { email: { like: `sk-live-7%` } } });
  await problem("GET", "/posts" + keyOracle, {}, { status: 401, code: "unauthenticated", pointer: undefined });
  assert.deepEqual((await ok("GET", "/posts" + keyOracle, { as: "editor" })).map((p: any) => p.id), [byGhost.id]);
});

// Core /wp/v2 for a post kind (spec §3a): fields under `meta` in First's value form, and First's own
// `where`/`orderBy`/`with`/`search` on the list route, answering what /first/v1 answers.
const coreTitles = async (params: Record<string, unknown>, as?: "editor") => {
  const r = await http("GET", `${core}/first_events` + qs({ per_page: "100", ...params }), as ? { as } : {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.map((e: any) => e.title.rendered[0]).join("");
};

test("core meta holds every field as First reads it", async () => {
  const [row] = await ok("GET", "/events" + qs({ where: { id: ids.B } }));
  const item = await http("GET", `${core}/first_events/${ids.B}`);
  assert.equal(item.status, 200, JSON.stringify(item.json));
  const { seats, price, open, day, startsAt, kinds, postId, extra } = row;
  const { seats: s, price: p, open: o, day: d, startsAt: t, kinds: k, postId: i, extra: x } = item.json.meta;
  assert.deepEqual({ seats: s, price: p, open: o, day: d, startsAt: t, kinds: k, postId: i, extra: x }, { seats, price, open, day, startsAt, kinds, postId, extra });
  const schema = (await http("OPTIONS", `${core}/first_events`)).json.schema.properties.meta.properties;
  assert.deepEqual([schema.seats.type, schema.kinds.type, schema.kinds.items.enum], [["integer", "null"], "array", ["talk", "workshop", "social"]]);
});

test("core list routes take First's where, orderBy and search", async () => {
  const mine = { id: { in: [ids.A, ids.B, ids.C] } };
  for (const [where, orderBy] of [[{ seats: { gte: 10 } }, "seats"], [{}, "-seats"], [{ kinds: { has: "talk" } }, "title"], [{ day: { gte: "2026-01-01" } }, "day"]] as const) {
    const first = (await ok("GET", "/events" + qs({ where: { AND: [where, mine] }, orderBy }))).map((e: any) => e.title[0]).join("");
    assert.equal(await coreTitles({ where: { AND: [where, mine] }, orderBy }), first, JSON.stringify(where));
  }
  // Pagination is core's, over the rows the query selected, in First's order.
  const page = await http("GET", `${core}/first_events` + qs({ where: mine, orderBy: "-seats", per_page: "1", page: "2" }));
  assert.deepEqual([page.json.map((e: any) => e.title.rendered[0]), (await fetch(`${core}/first_events` + qs({ where: mine, per_page: "1" }))).headers.get("x-wp-total")], [["B"], "3"]);
  // search matches any text field, not only title and content.
  const noted = await ok("POST", "/events", { as: "editor", body: { title: `Noted ${run}` } });
  assert.equal(await coreTitles({ search: run, where: { id: { in: [ids.A, noted.id] } }, orderBy: "title" }), "AN");
  // A term only in a meta text field is found, with orderby=relevance too (core can't rank it).
  const staff = first("insert", "field_staff", JSON.stringify({ name: `Staff ${run}`, kind: "pro", plan: `metaonly-${run}` }))[0].id;
  for (const extra of [{}, { orderby: "relevance" }]) {
    const r = await http("GET", `${core}/first_field_staff` + qs({ search: `metaonly-${run}`, ...extra }), { as: "editor" });
    assert.deepEqual([r.status, r.json.map((s: any) => s.id)], [200, [staff]], JSON.stringify(extra));
  }
  // Paging links keep First's search: following `next` gives the next page of the same matches.
  const first = await fetch(`${core}/first_events` + qs({ search: run, where: { id: { in: [ids.A, ids.B, noted.id] } }, orderBy: "title", per_page: "1" }));
  assert.equal(first.headers.get("x-wp-total"), "3");
  const next = /<([^>]+)>; rel="next"/.exec(first.headers.get("link") ?? "")?.[1];
  assert.ok(next && new URL(next).searchParams.get("search") === run, first.headers.get("link") ?? "no Link header");
  const second = await fetch(next!);
  assert.deepEqual([second.headers.get("x-wp-total"), (await second.json()).map((e: any) => e.title.rendered[0])], ["3", ["B"]]);
  // The same refusals as /first/v1, as WP_Error.
  const bad = await http("GET", `${core}/first_events` + qs({ where: { kinds: { in: ["talk"] } } }));
  assert.deepEqual([bad.status, bad.json.code, bad.json.data.pointer], [400, "invalid_query", "/where/kinds/in"]);
});

test("core routes attach `with` relations as First rows", async () => {
  const list = await http("GET", `${core}/first_events` + qs({ where: { id: ids.A }, with: "post" }));
  assert.deepEqual(list.json.map((e: any) => [e.id, e.with.post.id, e.with.post.title]), [[ids.A, post.id, `Meta ${run}`]]);
  const item = await http("GET", `${core}/first_events/${ids.A}` + qs({ with: { post: true } }));
  assert.equal(item.json.with.post.id, post.id);
  const unknown = await http("GET", `${core}/first_events/${ids.A}?with=nope`);
  assert.deepEqual([unknown.status, unknown.json.data.pointer], [400, "/with/nope"]);
});

test("core meta writes go through First's codec and validation", async () => {
  const created = await http("POST", `${core}/first_events`, { as: "editor", body: { title: `Core ${run}`, status: "publish", meta: { seats: 12, day: "2026-03-04", startsAt: "2026-03-04T10:00:00+02:00", kinds: ["social"], extra: { a: {} } } } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id;
  assert.deepEqual(
    [created.json.meta.seats, created.json.meta.day, created.json.meta.startsAt, created.json.meta.kinds, created.json.meta.extra],
    [12, "2026-03-04", "2026-03-04T08:00:00.000Z", ["social"], { a: {} }],
  );
  const meta = Object.fromEntries(sql(`SELECT meta_key AS k, meta_value AS v FROM wp_postmeta WHERE post_id = ${id} AND meta_key IN ('first_day', 'first_startsAt')`).map((r) => [r.k, r.v]));
  assert.deepEqual(meta, { first_day: "20260304", first_startsAt: "2026-03-04 08:00:00" });
  const updated = await http("POST", `${core}/first_events/${id}`, { as: "editor", body: { meta: { seats: null, open: true } } });
  assert.deepEqual([updated.status, updated.json.meta.seats, updated.json.meta.open], [200, null, true]);
  assert.deepEqual([(await ok("GET", `/events/${id}`)).seats, (await ok("GET", `/events/${id}`)).open], [null, true]);
  const bad = await http("POST", `${core}/first_events/${id}`, { as: "editor", body: { meta: { day: "2026-02-30" } } });
  assert.deepEqual([bad.status, bad.json.code, bad.json.data.pointer], [422, "invalid_input", "/day"]);
  assert.equal((await ok("GET", `/events/${id}`)).day, "2026-03-04", "a refused save changes nothing");
});

test("core meta writes check that media ids exist, as every write path does", async () => {
  const missing = await http("POST", `${core}/first_talks`, { as: "admin", body: { title: `No media ${run}`, status: "publish", meta: { image: 999_999_999 } } });
  assert.deepEqual([missing.status, missing.json.code, missing.json.data?.pointer], [422, "invalid_input", "/image"], JSON.stringify(missing.json));
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'first_talks' AND post_title = 'No media ${run}'`)[0].n, "0", "nothing was created");
  const attachment = Number(wp("eval", `echo wp_insert_attachment(['post_title' => 'Img ${run}', 'post_mime_type' => 'image/png', 'post_status' => 'inherit']);`));
  const stored = await http("POST", `${core}/first_talks`, { as: "admin", body: { title: `Media ${run}`, status: "publish", meta: { image: attachment } } });
  assert.deepEqual([stored.status, stored.json.meta?.image], [201, attachment], JSON.stringify(stored.json));
  const update = await http("POST", `${core}/first_talks/${stored.json.id}`, { as: "admin", body: { meta: { image: 999_999_999 } } });
  assert.deepEqual([update.status, update.json.data?.pointer], [422, "/image"]);
  assert.equal((await ok("GET", `/talks/${stored.json.id}`)).image, attachment, "a refused update changes nothing");
});

test("core meta rules see the whole row, as /first/v1's do", async () => {
  const [basic, pro] = first("insert", "field_staff", JSON.stringify([{ name: `Basic ${run}`, kind: "basic" }, { name: `Pro ${run}`, kind: "pro" }])).map((r: any) => r.id);
  const refused = await http("POST", `${core}/first_field_staff/${basic}`, { as: "editor", body: { meta: { postNote: "pro only" } } });
  const viaZero = await http("PATCH", `${api}/field_staff/${basic}`, { as: "editor", body: { postNote: "pro only" } });
  assert.deepEqual([refused.status, refused.json.data?.pointer], [viaZero.status, viaZero.json.pointer]);
  assert.deepEqual([refused.status, refused.json.data?.pointer], [422, "/postNote"], JSON.stringify(refused.json));
  const allowed = await http("POST", `${core}/first_field_staff/${pro}`, { as: "editor", body: { meta: { postNote: "pro only" } } });
  assert.deepEqual([allowed.status, allowed.json.meta?.postNote], [200, "pro only"], JSON.stringify(allowed.json));
});
