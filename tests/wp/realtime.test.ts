// Change notices on real WordPress + MariaDB: a REST write commits and fires one
// zero_realtime_changes notice with ids only; a rolled-back write fires none; a wp-admin save
// reports too; and the generated client's watch() re-reads through the API when a notice arrives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./app/zero/client/index.ts";
import { api, auth, ok, problem, run, wp } from "./env.ts";

type Notice = { id: string; at: string; changes: { collection: string; ops: string[]; ids: (number | string)[] | null }[] };
const LOG = "zero-test-realtime.jsonl";
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
  const res = await fetch(`${api.replace("/zero/v1", "/wp/v2")}/zero_events/${event.id}`, {
    method: "POST",
    headers: { ...auth("editor"), "content-type": "application/json" },
    body: JSON.stringify({ title: `Edited ${run}` }),
  });
  assert.ok(res.ok, `core REST save → ${res.status} ${await res.text()}`);
  const ours = since(before).flatMap((n) => n.changes).filter((c) => c.collection === "events");
  assert.deepEqual(ours, [{ collection: "events", ops: ["update"], ids: [event.id] }]);
});

test("watch() refreshes through the access-checked API when the server publishes a notice", async () => {
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
  const zero = createClient({ url: api, headers: auth("subscriber"), realtime: { transport, pollMs: false } });
  const snapshots: string[][] = [];
  const where = { title: { like: `Watched ${run}%` } };
  const stop = zero.events.watch({ where, orderBy: { id: "asc" } }, (rows) => snapshots.push(rows.map((r) => r.title)));
  const until = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(pred(), JSON.stringify(snapshots));
  };
  try {
    await until(() => snapshots.length >= 1);
    assert.deepEqual(snapshots.at(-1), []);
    await ok("POST", "/events", { as: "editor", body: { title: `Watched ${run} one` } });
    await until(() => snapshots.at(-1)?.length === 1);
    assert.deepEqual(snapshots.at(-1), [`Watched ${run} one`], "the subscriber's own read, after the editor's commit");
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
