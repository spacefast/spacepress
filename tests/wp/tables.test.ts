// `editor: false` custom tables (§4.2): rows live in wp_zero_<table> in the §3.4 storage form, the
// cross-kind reference (comments.postId → a post) is checked and cascaded by the pipeline, and a
// MySQL UNIQUE violation maps to the same 409 the standalone target returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, problem, run, sql, wpTry, zero } from "./env.ts";

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
  // signups (tests/wp/app) is an editor:false table with a real UNIQUE index: MySQL error 1062, mapped.
  await ok("POST", "/signups", { body: { email: `s-${run}@example.test` } });
  await problem("POST", "/signups", { body: { email: `s-${run}@example.test` } }, { status: 409, code: "unique_violation", pointer: "/email" });
});
