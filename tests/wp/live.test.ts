// Reactive queries on real WordPress + MariaDB: the per-kind counters under concurrent writers, and
// POST /__first/api/v1/_live answering "not modified" or a fresh result as the caller: a reader the
// kind refuses, a field hidden from the caller, and saves made through core REST (what wp-admin and
// the block editor send). The in-process suite (tests/php/live_test.php) covers each rule in turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, auth, core, http, ok, run, sql, type Role } from "./env.ts";

type Result = { changed?: boolean; token?: string; data?: any; error?: { status: number; code: string }; pending?: true };
type Query = { kind: string; op: "list" | "paginate" | "get" | "count"; args?: Record<string, unknown>; id?: number | string; token?: string };

async function live(as: Role | undefined, queries: Query[]): Promise<Result[]> {
  const r = await http("POST", `${api}/_live`, { as, body: { queries } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data.results;
}
const one = async (as: Role | undefined, query: Query) => (await live(as, [query]))[0];
const counter = (kind: string, scope = "all") => Number(sql(`SELECT version FROM wp_first__versions WHERE kind = '${kind}' AND scope = '${scope}'`)[0]?.version ?? 0);

test("concurrent writers: every committed transaction is counted once, and no write is lost to a subscriber", async () => {
  const where = { body: { like: `Race ${run}%` } };
  const query: Query = { kind: "guestNotes", op: "list", args: { where, orderBy: { id: "asc" }, limit: 100 } };
  const first = await one("subscriber", query);
  assert.deepEqual(first.data, []);
  const before = counter("guest_notes");

  const writers = 24;
  const created = await Promise.all(
    Array.from({ length: writers }, (_, i) => http("POST", `${api}/guest_notes`, { as: i % 2 ? "editor" : "subscriber", body: { body: `Race ${run} ${i}` } })),
  );
  assert.deepEqual(created.map((r) => r.status), Array(writers).fill(201), JSON.stringify(created.find((r) => r.status !== 201)?.json));
  assert.equal(counter("guest_notes") - before, writers, "one count per committed transaction, none lost under contention");

  const after = await one("subscriber", { ...query, token: first.token });
  assert.equal(after.changed, true);
  assert.equal(after.data.length, writers, "the subscriber's next poll holds every write");
  const settled = await one("subscriber", { ...query, token: after.token });
  assert.deepEqual(Object.keys(settled), ["changed", "token"], "then not modified, with no data");
  assert.equal(settled.changed, false);
});

test("a subscriber polling during concurrent writes never ends on a stale result", async () => {
  const where = { body: { like: `Interleave ${run}%` } };
  const query: Query = { kind: "guestNotes", op: "count", args: { where } };
  let held = await one(undefined, query);
  assert.equal(held.data, 0);
  let seen = 0;
  const writes = Array.from({ length: 12 }, (_, i) => http("POST", `${api}/guest_notes`, { as: "subscriber", body: { body: `Interleave ${run} ${i}` } }));
  // Poll while the writes land; whatever order they commit in, a token never claims a newer state than its result.
  const polls = (async () => {
    for (let i = 0; i < 12; i++) {
      const next = await one(undefined, { ...query, token: held.token });
      if (next.changed) {
        assert.ok(next.data >= seen, "the count only grows");
        seen = next.data;
      }
      held = next;
    }
  })();
  await Promise.all([...writes, polls]);
  const last = await one(undefined, { ...query, token: held.token });
  assert.equal(last.changed ? last.data : seen, 12, "after the last commit, the next poll is the final count");
});

test("a kind the caller may not read: its 403 stays the same whatever is written to it", async () => {
  const query: Query = { kind: "signups", op: "list" };
  const denied = await one("subscriber", query);
  assert.deepEqual([Object.keys(denied), denied.error?.status, denied.error?.code], [["error"], 403, "forbidden"]);
  const before = counter("signups");
  await ok("POST", "/signups", { as: "editor", body: { email: `live-${run}@example.com` } });
  assert.equal(counter("signups"), before + 1, "the write was counted");
  assert.deepEqual(await one("subscriber", query), denied, "the refused caller is answered byte for byte as before");
  assert.equal((await one(undefined, query)).error?.status, 401);
  const editor = await one("editor", { ...query, args: { where: { email: `live-${run}@example.com` } } });
  assert.equal(editor.data.length, 1, "an editor's subscription reads it");
});

test("a field hidden from the caller: a write to it is not modified for them, and changed for who reads it", async () => {
  const row = await ok("POST", "/payroll", { as: "editor", body: { title: `Live ${run}` } });
  const query: Query = { kind: "payroll", op: "get", id: row.id };
  const [subscriber, admin] = await Promise.all([one("subscriber", query), one("admin", query)]);
  assert.ok(!("salary" in subscriber.data), JSON.stringify(subscriber.data));
  await ok("PATCH", `/payroll/${row.id}`, { as: "admin", body: { salary: `secret ${run}` } });
  const [subscriber2, admin2] = await Promise.all([one("subscriber", { ...query, token: subscriber.token }), one("admin", { ...query, token: admin.token })]);
  assert.deepEqual(Object.keys(subscriber2), ["changed", "token"]);
  assert.equal(subscriber2.changed, false, "nothing the subscriber reads changed");
  assert.equal(admin2.changed, true);
  assert.equal(admin2.data.salary, `secret ${run}`);
});

test("a save through core REST (what wp-admin and the block editor send) reaches subscribers", async () => {
  const event = await ok("POST", "/events", { as: "editor", body: { title: `Live ${run}`, seats: 3 } });
  const query: Query = { kind: "events", op: "get", id: event.id };
  const held = await one(undefined, query);
  assert.equal(held.data.title, `Live ${run}`);
  assert.equal((await one(undefined, { ...query, token: held.token })).changed, false);
  const res = await fetch(`${core}/first_events/${event.id}`, {
    method: "POST",
    headers: { ...auth("editor"), "content-type": "application/json" },
    body: JSON.stringify({ title: `Live edited ${run}` }),
  });
  assert.ok(res.ok, `core REST save → ${res.status} ${await res.text()}`);
  const next = await one(undefined, { ...query, token: held.token });
  assert.equal(next.changed, true);
  assert.equal(next.data.title, `Live edited ${run}`);
});

test("a write a hook rolls back counts nothing", async () => {
  const before = counter("job_notes");
  const r = await http("POST", `${api}/job_notes`, { as: "editor", body: { title: "Explode" } });
  assert.equal(r.status, 500);
  assert.equal(counter("job_notes"), before);
});

test("the counter is part of the write's transaction: a write whose counter can't be written doesn't commit", async () => {
  const title = `Uncounted ${run}`;
  sql("RENAME TABLE wp_first__versions TO wp_first__versions_away");
  try {
    const r = await http("POST", `${api}/guest_notes`, { as: "subscriber", body: { body: title } });
    assert.equal(r.status, 500, JSON.stringify(r.json));
  } finally {
    sql("RENAME TABLE wp_first__versions_away TO wp_first__versions");
  }
  assert.deepEqual(sql(`SELECT id FROM wp_first_guest_notes WHERE body = '${title}'`), [], "the row rolled back with its counter");
  const before = counter("guest_notes");
  await ok("POST", "/guest_notes", { as: "subscriber", body: { body: title } });
  assert.equal(counter("guest_notes"), before + 1, "and the next write counts as usual");
});

test("the request is bounded and never cached", async () => {
  const query: Query = { kind: "guestNotes", op: "count" };
  const res = await fetch(`${api}/_live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: [query] }) });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await res.json()).data.poll, { minMs: 2000, maxMs: 30000 });
  const tooMany = await http("POST", `${api}/_live`, { body: { queries: Array(21).fill(query) } });
  assert.deepEqual([tooMany.status, tooMany.json.code, tooMany.json.pointer], [422, "invalid_input", "/queries"]);
  const get = await http("GET", `${api}/_live`);
  assert.deepEqual([get.status, get.json.code], [405, "method_not_allowed"]);
});

test("a page read names a path on this site and a live region; this app has neither, so each is refused, and the other reads are unchanged", async () => {
  // tests/app_router.rs `live_regions_answer_page_reads` covers page reads on an app with `<Live>`
  // regions; here, the refusals on real WordPress + MariaDB, batched with an ordinary read.
  const page = (url: string, region = "notes") => ({ op: "page", args: { url, region } }) as unknown as Query;
  const results = await live(undefined, [
    page("https://evil.example/"),
    page("//evil.example/"),
    page("/", "Not An Id"),
    page("/"),
    { kind: "guestNotes", op: "count" },
  ]);
  assert.deepEqual(results.slice(0, 4).map((r) => [r.error?.status, r.error?.code]), [[422, "invalid_input"], [422, "invalid_input"], [422, "invalid_input"], [404, "not_found"]]);
  assert.equal(typeof results[4]!.data, "number");
  // At most four page reads render per request; the fifth answers `pending` and is asked again.
  const five = await live(undefined, Array.from({ length: 5 }, () => page("/")));
  assert.deepEqual(five.map((r) => r.error?.code ?? (r.pending ? "pending" : null)), ["not_found", "not_found", "not_found", "not_found", "pending"]);
});
