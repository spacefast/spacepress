// The search index on real WordPress + MariaDB under concurrent writers: every create commits and
// is found by search afterwards. The in-process suite (tests/php/search_test.php) covers what is
// indexed and who may match it; this one covers what SQLite can't show, InnoDB's locks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, http, run, sql } from "./env.ts";

test("concurrent creates never deadlock on the search index, and each one is found by search", async () => {
  // Rows created at once get neighbouring ids. Writing a row's entries used to start by deleting
  // its whole key range, which on InnoDB locks the gap a neighbour's insert needs: about one write
  // in forty failed with a deadlock at this concurrency.
  const writers = 24;
  const rounds = 3;
  const failures: string[] = [];
  for (let round = 0; round < rounds; round++) {
    const created = await Promise.all(
      Array.from({ length: writers }, (_, i) =>
        http("POST", `${api}/guest_notes`, { as: i % 2 ? "editor" : "subscriber", body: { body: `Concurrent ${run} r${round} w${i}` } }),
      ),
    );
    for (const r of created) if (r.status !== 201) failures.push(`${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  assert.deepEqual(failures, [], "every concurrent create commits");

  // Each row's entry is in the index: the search finds all of them, and no row twice.
  const found = await http("GET", `${api}/guest_notes?search=${encodeURIComponent(`Concurrent ${run}`)}&limit=100`, { as: "editor" });
  assert.equal(found.status, 200, JSON.stringify(found.json));
  const bodies = found.json.data.map((r: { body: string }) => r.body).sort();
  assert.equal(bodies.length, writers * rounds);
  assert.equal(new Set(bodies).size, writers * rounds);
  const entries = sql(`SELECT COUNT(*) AS n FROM wp_sp__search WHERE kind = 'guest_notes' AND body LIKE 'Concurrent ${run} %'`);
  assert.equal(Number(entries[0].n), writers * rounds, "one entry per row and field");
});

test("an update replaces a row's entry in place, and clearing the field removes it", async () => {
  const note = (await http("POST", `${api}/guest_notes`, { as: "editor", body: { body: `Before ${run}` } })).json.data;
  const entry = () => sql(`SELECT body FROM wp_sp__search WHERE kind = 'guest_notes' AND item = '${note.id}'`).map((r) => r.body);
  assert.deepEqual(entry(), [`Before ${run}`]);
  assert.equal((await http("PATCH", `${api}/guest_notes/${note.id}`, { as: "editor", body: { body: `After ${run}` } })).status, 200);
  assert.deepEqual(entry(), [`After ${run}`], "replaced, not added");
  assert.equal((await http("PATCH", `${api}/guest_notes/${note.id}`, { as: "editor", body: { body: "" } })).status, 200);
  assert.deepEqual(entry(), [], "a field with no text has no entry");
  assert.equal((await http("DELETE", `${api}/guest_notes/${note.id}`, { as: "editor" })).status, 200);
});
