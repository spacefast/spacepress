// Post-backed reads run against wp_posts + wp_postmeta for real (§3.5.1): typed CAST comparisons and
// ordering on meta, Ymd dates, UTC timestamps, `has` over SCF's serialized arrays, missing vs ''
// meta, the shared rejections, and relation filters / `with` across post↔post and post↔table.
// The SQL text is pinned in tests/php/sql_test.php; this suite proves MariaDB agrees with it.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { ok, problem, qs, run, sql } from "./env.ts";

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
  sql(`DELETE FROM wp_postmeta WHERE post_id = ${ids.A} AND meta_key = 'zero_price'`);
  sql(`UPDATE wp_postmeta SET meta_value = '' WHERE post_id = ${ids.C} AND meta_key = 'zero_startsAt'`);
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
  const meta = Object.fromEntries(sql(`SELECT meta_key AS k, meta_value AS v FROM wp_postmeta WHERE post_id = ${ids.B} AND meta_key LIKE 'zero\\_%'`).map((r) => [r.k, r.v]));
  assert.deepEqual(
    [meta.zero_day, meta.zero_startsAt, meta.zero_open, meta.zero_kinds],
    ["20260201", "2026-02-01 18:30:00", "0", 'a:2:{i:0;s:4:"talk";i:1;s:8:"workshop";}'],
  );
});

test("operators that can't run on postmeta are rejected with the shared messages", async () => {
  await problem("GET", "/events" + qs({ where: { kinds: { in: ["talk"] } } }), {}, { status: 400, code: "invalid_query", pointer: "/where/kinds/in" });
  await problem("GET", "/posts" + qs({ where: { seo: { eq: {} } } }), {}, { status: 400, code: "invalid_query", pointer: "/where/seo/eq" });
  await problem("GET", "/posts" + qs({ orderBy: "tags" }), {}, { status: 400, code: "invalid_query", pointer: "/orderBy/tags" });
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
