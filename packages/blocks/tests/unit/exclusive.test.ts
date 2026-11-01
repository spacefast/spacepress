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

test("work left behind by a finished section queues behind the current holder instead of re-entering it", async () => {
  const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const order: string[] = [];
  let wake!: () => void;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let late!: Promise<void>;
  await exclusive(async () => {
    late = gate.then(() => exclusive(async () => {
      order.push("late");
    }));
  });
  const owner = exclusive(async () => {
    order.push("owner:start");
    await hold;
    order.push("owner:end");
  });
  await turn();
  wake();
  await turn();
  release();
  await Promise.all([owner, late]);
  assert.deepEqual(order, ["owner:start", "owner:end", "late"]);
});

test("a section waits for a nested call it started before it releases the lock", async () => {
  const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const order: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const outer = exclusive(async () => {
    void exclusive(async () => {
      await hold;
      order.push("nested:end");
    });
    order.push("outer:end");
  });
  const next = exclusive(async () => {
    order.push("next");
  });
  await turn();
  assert.deepEqual(order, ["outer:end"]);
  release();
  await Promise.all([outer, next]);
  assert.deepEqual(order, ["outer:end", "nested:end", "next"]);
});

test("a section that throws releases the next one and rethrows", async () => {
  await assert.rejects(exclusive(() => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await exclusive(async () => "after"), "after");
});
