import assert from "node:assert/strict";
import { test } from "node:test";
import { api, auth } from "../env.ts";

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
