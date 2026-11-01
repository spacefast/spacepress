import { test } from "node:test";
import assert from "node:assert/strict";

import { exclusive } from "../../src/compiler/exclusive.ts";

/** One turn of the event loop: enough for anything not blocked to have started. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A promise and the function that settles it. */
function gate(): { open: () => void; closed: Promise<void> } {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
}

test("module work waits until dom work has finished", async () => {
  const order: string[] = [];
  const hold = gate();
  const dom = exclusive("dom", async () => {
    order.push("dom:start");
    await hold.closed;
    order.push("dom:end");
  });
  const module = exclusive("module", async () => {
    order.push("module");
  });
  await turn();
  assert.deepEqual(order, ["dom:start"]);
  hold.open();
  await Promise.all([dom, module]);
  assert.deepEqual(order, ["dom:start", "dom:end", "module"]);
});

test("dom work waits until module work has finished", async () => {
  const order: string[] = [];
  const hold = gate();
  const module = exclusive("module", async () => {
    order.push("module:start");
    await hold.closed;
    order.push("module:end");
  });
  const dom = exclusive("dom", async () => {
    order.push("dom");
  });
  await turn();
  assert.deepEqual(order, ["module:start"]);
  hold.open();
  await Promise.all([module, dom]);
  assert.deepEqual(order, ["module:start", "module:end", "dom"]);
});

test("work of the same kind overlaps", async () => {
  const order: string[] = [];
  const hold = gate();
  const first = exclusive("dom", async () => {
    order.push("first:start");
    await hold.closed;
    order.push("first:end");
  });
  const second = exclusive("dom", async () => {
    order.push("second");
  });
  await turn();
  assert.deepEqual(order, ["first:start", "second"]);
  hold.open();
  await Promise.all([first, second]);
});

test("a nested call keeps its group alive after the outer call has returned", async () => {
  const order: string[] = [];
  const hold = gate();
  const outer = exclusive("dom", async () => {
    void exclusive("dom", async () => {
      await hold.closed;
      order.push("nested:end");
    });
    order.push("outer:end");
  });
  const module = exclusive("module", async () => {
    order.push("module");
  });
  await turn();
  assert.deepEqual(order, ["outer:end"]);
  hold.open();
  await Promise.all([outer, module]);
  assert.deepEqual(order, ["outer:end", "nested:end", "module"]);
});

test("a nested call that awaits an outsider of its own kind completes, since the outsider joins", async () => {
  let outsider!: Promise<void>;
  const outer = exclusive("dom", async () => {
    void exclusive("dom", async () => {
      await outsider;
    });
  });
  outsider = exclusive("dom", async () => {});
  await Promise.all([outer, outsider]);
  assert.equal(await exclusive("module", async () => "after"), "after");
});

test("work of the other kind requested from inside an active group is refused at once, not left waiting for itself", async () => {
  await exclusive("dom", async () => {
    await assert.rejects(exclusive("module", async () => {}), /cannot start inside the block API/);
  });
  await exclusive("module", async () => {
    await assert.rejects(exclusive("dom", async () => {}), /cannot start inside module execution/);
  });
  assert.equal(await exclusive("module", async () => "after"), "after");
});

test("work left behind by a finished group waits for the group of the other kind that is active, and joins one of its own", async () => {
  const order: string[] = [];
  const wake = gate();
  const hold = gate();
  let lateModule!: Promise<void>;
  let lateDom!: Promise<void>;
  await exclusive("dom", async () => {
    lateModule = wake.closed.then(() => exclusive("module", async () => {
      order.push("late module");
    }));
    lateDom = wake.closed.then(() => exclusive("dom", async () => {
      order.push("late dom");
    }));
  });
  const owner = exclusive("dom", async () => {
    order.push("owner:start");
    await hold.closed;
    order.push("owner:end");
  });
  await turn();
  wake.open();
  await turn();
  assert.deepEqual(order, ["owner:start", "late dom"]);
  hold.open();
  await Promise.all([owner, lateModule, lateDom]);
  assert.deepEqual(order, ["owner:start", "late dom", "owner:end", "late module"]);
});

test("every waiter of the next kind starts together when the active group empties", async () => {
  const order: string[] = [];
  const hold = gate();
  const dom = exclusive("dom", async () => {
    await hold.closed;
  });
  const modules = [1, 2, 3].map((n) => exclusive("module", async () => {
    order.push(`module ${n}:start`);
    await turn();
    order.push(`module ${n}:end`);
  }));
  await turn();
  hold.open();
  await Promise.all([dom, ...modules]);
  assert.deepEqual(order.slice(0, 3), ["module 1:start", "module 2:start", "module 3:start"]);
});

test("work that throws releases the group and rethrows", async () => {
  await assert.rejects(exclusive("dom", () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await exclusive("module", async () => "after"), "after");
});

test("a nested call that rejects does not poison its group", async () => {
  const outer = await exclusive("dom", async () => {
    await assert.rejects(exclusive("dom", () => Promise.reject(new Error("inner"))), /inner/);
    return "outer";
  });
  assert.equal(outer, "outer");
  assert.equal(await exclusive("module", async () => "after"), "after");
});
