import { test } from "node:test";
import assert from "node:assert/strict";

import { exclusive } from "../../src/compiler/exclusive.ts";

/** One turn of the event loop: enough for anything not blocked to have started. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a second section does not start until the first has finished", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = exclusive(async () => {
    order.push("first:start");
    await gate;
    order.push("first:end");
  });
  const second = exclusive(async () => {
    order.push("second:start");
  });
  await turn();
  assert.deepEqual(order, ["first:start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
});

test("a section entered from inside another runs at once instead of waiting for itself", async () => {
  const value = await exclusive(() => exclusive(async () => "inner"));
  assert.equal(value, "inner");
});

test("a section that throws releases the next one and rethrows", async () => {
  await assert.rejects(exclusive(() => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await exclusive(async () => "after"), "after");
});
