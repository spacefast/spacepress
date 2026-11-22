import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "../env.ts";

type Page = { page: { id: string; channel: string; score: number }[]; isDone: boolean; continueCursor: string | null };

async function call(name: string, input: object): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${api}/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
async function page(name: string, input: object): Promise<Page> {
  const { status, body } = await call(name, input);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(typeof body === "object" && body !== null && "data" in body);
  return body.data as Page;
}
/** Every page until isDone, as 0.8's usePaginatedQuery would walk it. */
async function walk(name: string, input: object, numItems: number): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: Page = await page(name, { ...input, options: { numItems, cursor } });
    pages.push(result.page.map((row) => row.id));
    assert.equal(result.continueCursor === null, result.isDone);
    if (result.isDone) return pages;
    cursor = result.continueCursor;
  }
}

test("migrated paginate keeps the 0.8 keyset order and cursor contract", async () => {
  // by_creation desc: createdAt desc, then id desc on the minute ties.
  assert.deepEqual(await walk("latest", {}, 2), [["9", "8"], ["7", "5"], ["4", "3"], ["2", "6"], ["1"]]);
  assert.deepEqual(await walk("latest", {}, 9), [["9", "8", "7", "5", "4", "3", "2", "6", "1"]]);
  // by_channel asc after channel = "a": score, createdAt, id.
  assert.deepEqual(await walk("channel", { channel: "a" }, 2), [["6", "2"], ["4", "5"], ["1"]]);
  // numItems clamps to 1..1000 like 0.8.
  assert.deepEqual((await page("latest", { options: { numItems: 0, cursor: null } })).page.map((r) => r.id), ["9"]);
  assert.equal((await page("latest", { options: { numItems: 5000, cursor: null } })).page.length, 9);
  // A key holding NUL still round-trips: the cursor encodes keys as a JSON array, not joined text.
  assert.deepEqual(await walk("channel", { channel: "nul\u0000x" }, 1), [["8"], ["9"]]);

  const first = await page("channel", { channel: "a", options: { numItems: 2, cursor: null } });
  assert.ok(first.continueCursor);
  // A cursor continues only its own call site and filter values.
  for (const [name, input] of [["latest", {}], ["channel", { channel: "b" }]] as const) {
    const { status, body } = await call(name, { ...input, options: { numItems: 2, cursor: first.continueCursor } });
    assert.equal(status, 400, JSON.stringify(body));
  }
  for (const cursor of ["not json", JSON.stringify({ site: "x", keys: "1" }), JSON.stringify({ site: "channel:0:posts:by_channel:asc", scope: '["a"]', keys: JSON.stringify(["a", "NaN", "x", "1"]) }),
    JSON.stringify({ site: "channel:0:posts:by_channel:asc", scope: '["a"]', keys: JSON.stringify(["a", 1, "x", "1"]) }),
    JSON.stringify({ site: "channel:0:posts:by_channel:asc", scope: '["a"]', keys: JSON.stringify(["a", "1", "x"]) })]) {
    const { status } = await call("channel", { channel: "a", options: { numItems: 2, cursor } });
    assert.equal(status, 400, cursor);
  }
  // A write between pages appears in the right place, as with 0.8's keyset cursor.
  assert.equal((await call("post", { channel: "a", body: "late", score: 1.5 })).status, 200);
  const next = await page("channel", { channel: "a", options: { numItems: 2, cursor: first.continueCursor } });
  assert.equal(next.page[0]?.id, "4");
  assert.equal(next.page[1]?.score, 1.5);
});
