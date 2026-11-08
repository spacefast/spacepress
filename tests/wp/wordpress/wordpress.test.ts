import assert from "node:assert/strict";
import { test } from "node:test";
import { api, auth, harness, wp } from "../env.ts";

async function count(headers: Record<string, string>): Promise<{ status: number; body: { data?: unknown; code?: string } }> {
  const response = await fetch(`${api}/actions/count`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ text: "one two three" }),
  });
  return { status: response.status, body: await response.json() };
}

test("a handler calls another plugin's ability as the signed-in user", async () => {
  const editor = await count(auth("editor"));
  assert.equal(editor.status, 200, JSON.stringify(editor.body));
  assert.deepEqual(editor.body.data, { words: 3, by: "EDITOR" });
});

test("the ability's own permission check answers for everyone else", async () => {
  const subscriber = await count(auth("subscriber"));
  assert.deepEqual([subscriber.status, subscriber.body.code], [403, "forbidden"]);
  const visitor = await count({});
  assert.deepEqual([visitor.status, visitor.body.code], [401, "unauthenticated"]);
});

test("wp-hooks/the_content filters change the rendered post, in file-name order", async () => {
  const response = await fetch(`${harness.url}/?p=${process.env.ZERO_HOOKS_POST}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  // a-note appends inside the content, then b-frame wraps both.
  assert.match(html, /<div class="zero-frame"><p>Lane body<\/p>\n<p class="zero-lane">first<\/p><\/div>/);
});

test("core functions run as the signed-in user and return typed views", async () => {
  const response = await fetch(`${api}/actions/draft`, {
    method: "POST", headers: { "Content-Type": "application/json", ...auth("author") }, body: JSON.stringify({ title: "Tea & <cake>" }),
  });
  const body = (await response.json()) as { data: { id: number; title: string; status: string } };
  assert.equal(response.status, 200, JSON.stringify(body));
  // An author has no unfiltered_html, so WordPress's kses drops the tag before saving; esc_html then
  // escapes the ampersand on the way out.
  assert.deepEqual([body.data.title, body.data.status], ["Tea &amp; ", "draft"]);
  assert.equal(wp("post", "get", String(body.data.id), "--field=post_author"), String(harness.users.author.id));
});
