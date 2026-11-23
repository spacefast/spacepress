// Change notices on real WordPress + MariaDB: a REST write commits and fires one
// sp_realtime_changes notice with ids only; a rolled-back write fires none; a wp-admin save
// reports too; and the generated client's subscriptions re-read through the API when a notice
// arrives, by polling when there is no transport, and after the client's own writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./app/sp/_generated/client/index.ts";
import { api, auth, core, ok, problem, run, wp } from "./env.ts";

type Notice = { id: string; at: string; changes: { collection: string; ops: string[]; ids: (number | string)[] | null }[] };
const LOG = "spacepress-test-realtime.jsonl";
const notices = (): Notice[] => {
  const raw = wp("eval", `$f = WP_CONTENT_DIR . '/${LOG}'; echo is_file($f) ? file_get_contents($f) : '';`);
  return raw === "" ? [] : raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const since = (n: number) => notices().slice(n);

test("a committed REST write fires one notice naming the collection and id, never the row", async () => {
  const before = notices().length;
  const event = await ok("POST", "/events", { as: "editor", body: { title: `Realtime ${run}`, seats: 3 } });
  const fresh = since(before);
  assert.equal(fresh.length, 1, JSON.stringify(fresh));
  assert.deepEqual(fresh[0].changes, [{ collection: "events", ops: ["create"], ids: [event.id] }]);
  assert.ok(!JSON.stringify(fresh[0]).includes(`Realtime ${run}`), "no row values");
});

test("a write the hook rolls back fires nothing", async () => {
  const before = notices().length;
  await problem("POST", "/job_notes", { as: "editor", body: { title: "Explode" } }, { status: 500, code: "boom", pointer: undefined });
  assert.deepEqual(since(before), []);
});

test("a wp-admin save (core REST on the post type) reports through the same hook", async () => {
  const event = await ok("POST", "/events", { as: "editor", body: { title: `Editor ${run}` } });
  const before = notices().length;
  const res = await fetch(`${core}/sp_events/${event.id}`, {
    method: "POST",
    headers: { ...auth("editor"), "content-type": "application/json" },
    body: JSON.stringify({ title: `Edited ${run}` }),
  });
  assert.ok(res.ok, `core REST save → ${res.status} ${await res.text()}`);
  const ours = since(before).flatMap((n) => n.changes).filter((c) => c.collection === "events");
  assert.deepEqual(ours, [{ collection: "events", ops: ["update"], ids: [event.id] }]);
});

test("a subscription refreshes through the access-checked endpoint when the server publishes a notice", async () => {
  // A transport over the test log: what Cast does on Spacefast, minus the network.
  let seenNotices = notices().length;
  const transport = {
    connect(deliver: (n: Notice) => void, status: (s: "live" | "down") => void) {
      status("live");
      const timer = setInterval(() => {
        for (const n of since(seenNotices)) {
          seenNotices++;
          deliver(n);
        }
      }, 150);
      return () => clearInterval(timer);
    },
  };
  // Every subscription request the client sends, so a notice that should ask nothing can be checked.
  let asked = 0;
  const counting: typeof fetch = (input, init) => {
    if (String(input).endsWith("/_live")) asked++;
    return fetch(input, init);
  };
  const first = createClient({ url: api, headers: auth("subscriber"), fetch: counting, realtime: { transport, pollMs: false, livePollMs: false } });
  const snapshots: string[][] = [];
  const counts: number[] = [];
  const where = { title: { like: `Watched ${run}%` } };
  const stops = [
    first.events.list({ where, orderBy: { id: "asc" } }).subscribe((rows) => snapshots.push(rows.map((r) => r.title))),
    first.events.count({ where }).subscribe((n) => counts.push(n)),
  ];
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pred(), JSON.stringify({ snapshots, counts }));
  };
  try {
    await until(() => snapshots.length >= 1 && counts.length >= 1);
    assert.deepEqual([snapshots.at(-1), counts.at(-1)], [[], 0]);
    await ok("POST", "/events", { as: "editor", body: { title: `Watched ${run} one` } });
    await until(() => snapshots.at(-1)?.length === 1 && counts.at(-1) === 1);
    assert.deepEqual(snapshots.at(-1), [`Watched ${run} one`], "the subscriber's own read, after the editor's commit");
    // A write to another kind publishes a notice that names it: this subscription is not asked about.
    // A control notice for events, delivered after it, shows the transport delivered both in order.
    const before = asked;
    await ok("POST", "/guest_notes", { as: "subscriber", body: { body: `Elsewhere ${run}` } });
    await until(() => seenNotices === notices().length);
    assert.equal(asked, before, "a notice for a kind the reads don't use asks nothing");
    await ok("POST", "/events", { as: "editor", body: { title: `Watched ${run} two` } });
    await until(() => snapshots.at(-1)?.length === 2);
    assert.ok(asked > before, "a notice for events does ask");
  } finally {
    for (const stop of stops) stop();
  }
});

test("with no transport a subscription still hears another visitor's write, by polling", async () => {
  const first = createClient({ url: api, headers: auth("subscriber"), realtime: { transport: false, pollMs: 100 } });
  const titles: string[][] = [];
  const where = { title: { like: `Polled ${run}%` } };
  const stop = first.events.watch({ where }, (rows) => titles.push(rows.map((r) => r.title)));
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pred(), JSON.stringify(titles));
  };
  try {
    await until(() => titles.length === 1);
    await ok("POST", "/events", { as: "editor", body: { title: `Polled ${run}` } });
    await until(() => titles.at(-1)?.length === 1);
    assert.deepEqual(titles, [[], [`Polled ${run}`]], "one callback per change, none for the polls in between");
  } finally {
    stop();
  }
});

test("a write through the client refreshes its own subscriptions, and an optimistic update rolls back when the write is refused", async () => {
  const first = createClient({ url: api, headers: auth("subscriber"), realtime: { transport: false, pollMs: false } });
  const where = { body: { like: `Mine ${run}%` } };
  const read = first.guestNotes.list({ where, orderBy: { id: "asc" } });
  const frames: string[][] = [];
  const stop = read.subscribe((rows) => frames.push(rows.map((r) => r.body)));
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pred(), JSON.stringify(frames));
  };
  try {
    await until(() => frames.length === 1);
    const pending = read.optimistic((rows) => [...rows, { id: -1, body: `Mine ${run} (saving)`, memberId: null }]);
    assert.deepEqual(frames.at(-1), [`Mine ${run} (saving)`], "shown before the server answers");
    await first.guestNotes.create({ body: `Mine ${run}` });
    pending.settle();
    await until(() => frames.at(-1)?.[0] === `Mine ${run}`);
    assert.deepEqual(frames.at(-1), [`Mine ${run}`], "replaced by the server's row, with polling off");

    // big_counts takes creates from editors only: the subscriber's write is refused, and the update goes.
    const counts = first.bigCounts.list({ where: { n: -7 } });
    const shown: number[][] = [];
    const stop2 = counts.subscribe((rows) => shown.push(rows.map((r) => r.n)));
    try {
      await until(() => shown.length === 1);
      const doomed = counts.optimistic((rows) => [...rows, { id: -1, n: -7 }]);
      assert.deepEqual(shown.at(-1), [-7]);
      await assert.rejects(first.bigCounts.create({ n: -7 }), { status: 403 });
      doomed.rollback();
      assert.deepEqual(shown.at(-1), [], "back to the server's data");
    } finally {
      stop2();
    }
  } finally {
    stop();
  }
});

test("notices name collections by the client's schema key, not the physical table", async () => {
  const before = notices().length;
  // `jobNotes` (client key) is stored as `job_notes`.
  const note = await ok("POST", "/job_notes", { as: "editor", body: { title: `Keyed ${run}` } });
  const changes = since(before).flatMap((n) => n.changes).filter((c) => c.ids?.includes(note.id));
  assert.deepEqual(changes.map((c) => c.collection), ["jobNotes"]);
});
