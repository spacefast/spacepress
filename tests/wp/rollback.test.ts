// One request = one transaction (§3.3): a hook that throws after wp_insert_post rolls the post, its
// meta and its revision back, and the object cache doesn't keep a ghost of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, http, problem, sql, wp } from "./env.ts";

test("a hook throwing after wp_insert_post leaves no post behind", async () => {
  const max = () => Number(sql("SELECT COALESCE(MAX(ID), 0) AS m FROM wp_posts")[0].m);
  const before = max();
  // The test app's posts.afterCreate throws for this title, after the post and its meta are written.
  await problem("POST", "/posts", { as: "editor", body: { title: "Explode", excerpt: "doomed", tags: ["news"] } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(sql(`SELECT ID FROM wp_posts WHERE ID > ${before}`), []);
  assert.deepEqual(sql(`SELECT meta_id FROM wp_postmeta WHERE post_id > ${before}`), []);
  assert.deepEqual((await http("GET", api + "/posts" + "?where=" + encodeURIComponent(JSON.stringify({ title: "Explode" })), { as: "editor" })).json.data, []);
  assert.equal(wp("post", "list", "--post_type=zero_posts", "--post_status=any", "--title=Explode", "--format=count"), "0");
});
