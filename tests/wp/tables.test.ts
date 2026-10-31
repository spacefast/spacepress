// `editor: false` custom tables (§4.2): rows live in wp_zero_<table> in the §3.4 storage form, the
// cross-kind reference (comments.postId → a post) is checked and cascaded by the pipeline, and a
// MySQL UNIQUE violation maps to the same 409 the standalone target returns. Also: db.globals from
// compiled code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, http, ok, problem, run, sql, wpTry, zero } from "./env.ts";

test("comments are rows in wp_zero_comments; references to posts are checked and cascade", async () => {
  const post = await ok("POST", "/posts", { as: "editor", body: { title: `Table ${run}` } });
  const c = await ok("POST", "/comments", { body: { postId: post.id, name: "Visitor", body: "Hello" } });
  assert.deepEqual(sql(`SELECT postId, name, body, approved, createdAt FROM wp_zero_comments WHERE id = ${c.id}`), [
    { postId: String(post.id), name: "Visitor", body: "Hello", approved: "0", createdAt: c.createdAt },
  ]);
  await problem("POST", "/comments", { body: { postId: 999_999_999, name: "V", body: "x" } }, { status: 409, code: "reference_violation", pointer: "/postId" });
  await ok("DELETE", `/posts/${post.id}`, { as: "editor" });
  assert.deepEqual(sql(`SELECT id FROM wp_zero_comments WHERE id = ${c.id}`), [], "onDelete: cascade ran in the pipeline");
});

test("unique() maps to 409 with a pointer: the meta check on posts, SQL UNIQUE on tables", async () => {
  // authors.email is unique meta on a post-backed collection: no SQL constraint exists, the store checks.
  zero("insert", "authors", JSON.stringify({ name: "U1", email: `u-${run}@example.test` }));
  const dup = JSON.parse(wpTry("zero", "insert", "authors", JSON.stringify({ name: "U2", email: `u-${run}@example.test` })));
  assert.deepEqual([dup.error.status, dup.error.code, dup.error.pointer], [409, "unique_violation", "/email"]);
  // signups (tests/wp/app) is an editor:false table with a real UNIQUE index: MySQL error 1062, mapped,
  // for a viewer who may read the table.
  zero("insert", "signups", JSON.stringify({ email: `s-${run}@example.test` }));
  await problem("POST", "/signups", { as: "editor", body: { email: `s-${run}@example.test` } }, { status: 409, code: "unique_violation", pointer: "/email" });
});

// Write errors answer only about rows the viewer could read (review: field-unique-oracle,
// ref-existence-oracle). signups: anyone creates, editors read.
test("a signup the viewer can't read back answers the same whether or not the address is taken", async () => {
  const email = `taken-${run}@example.test`;
  const first = await http("POST", `${api}/signups`, { body: { email } });
  const again = await http("POST", `${api}/signups`, { body: { email } });
  assert.deepEqual([first.status, first.json.data, again.status, again.json.data], [201, { email }, 201, { email }], "the values sent, never the stored row");
  assert.deepEqual(sql(`SELECT COUNT(*) AS n FROM wp_zero_signups WHERE email = '${email}'`), [{ n: "1" }], "stored once");
});

test("a reference to a row the viewer can't read answers like one that doesn't exist", async () => {
  const draft = await ok("POST", "/posts", { as: "editor", body: { title: `Hidden ${run}`, status: "draft" } });
  const missing = await http("POST", `${api}/comments`, { body: { postId: 999_999_999, name: "V", body: "x" } });
  const hidden = await http("POST", `${api}/comments`, { body: { postId: draft.id, name: "V", body: "x" } });
  assert.deepEqual([hidden.status, hidden.json.code, hidden.json.pointer], [missing.status, missing.json.code, missing.json.pointer]);
  assert.equal(hidden.json.detail.replace(String(draft.id), "N"), missing.json.detail.replace("999999999", "N"));
  assert.equal((await http("POST", `${api}/comments`, { as: "editor", body: { postId: draft.id, name: "E", body: "ok" } })).status, 201, "an editor sees the draft and may reference it");
});

test("setting a unique column the viewer can't read is refused, whatever the value", async () => {
  zero("insert", "payroll", JSON.stringify({ title: `Badge ${run}`, badge: `B-${run}` }));
  const taken = await http("POST", `${api}/payroll`, { as: "editor", body: { title: "x", badge: `B-${run}` } });
  const free = await http("POST", `${api}/payroll`, { as: "editor", body: { title: "y", badge: `free-${run}` } });
  assert.deepEqual([taken.status, taken.json.pointer, free.status, free.json.pointer], [403, "/badge", 403, "/badge"]);
});

test("db.globals in compiled code reads and writes the WordPress-stored global", async () => {
  const start = (await ok("GET", "/globals/settings")).postsPerPage;
  assert.deepEqual(await ok("POST", "/actions/bumpPostsPerPage", { as: "editor", body: {} }), [start, start + 1]);
  assert.equal((await ok("GET", "/globals/settings")).postsPerPage, start + 1);
});
