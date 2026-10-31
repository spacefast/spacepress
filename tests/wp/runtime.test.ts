// Lane K1 (runtime gaps) on real WordPress. Pipeline edge cases are proven in tests/php; this file
// proves what Polylang and MySQL add.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, qs, run } from "./env.ts";

const tree = (rows: any[]) => rows.map((r) => [`${r.locale}:${r.title}`, r.legs.map((l: any) => `${l.locale}:${l.title}`)]);

test("with: a localized `many` resolves to each parent row's locale through Polylang, falling back per group", async () => {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `Legs ${run}` } });
  const fr = await ok("POST", "/tours", { as: "editor", body: { title: `Legs FR ${run}`, locale: "fr", translationOf: en.id } });
  const harbour = await ok("POST", "/legs", { as: "editor", body: { title: "Harbour", tourId: en.id } });
  await ok("POST", "/legs", { as: "editor", body: { title: "Port", locale: "fr", translationOf: harbour.id } });
  await ok("POST", "/legs", { as: "editor", body: { title: "Castle", tourId: en.id } });
  // A leg can name either row of the group; it belongs to the whole group.
  await ok("POST", "/legs", { as: "editor", body: { title: "Garden", tourId: fr.id } });
  const both = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id", with: { legs: { orderBy: { id: "asc" } } } }));
  assert.deepEqual(tree(both), [
    [`en:Legs ${run}`, ["en:Harbour", "en:Castle", "en:Garden"]],
    [`fr:Legs FR ${run}`, ["fr:Port", "en:Castle", "en:Garden"]],
  ]);
  // limit/offset window over the whole group's legs, in SQL (MariaDB), whichever row of the group asks.
  const paged = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id", with: { legs: { orderBy: { id: "asc" }, limit: 2, offset: 1 } } }));
  assert.deepEqual(tree(paged), [[`en:Legs ${run}`, ["en:Castle", "en:Garden"]], [`fr:Legs FR ${run}`, ["en:Castle", "en:Garden"]]]);
  // No German tour: the en row stands in, and so do its en legs.
  const de = await ok("GET", "/tours" + qs({ locale: "de", where: { id: { in: [en.id, fr.id] } }, with: "legs" }));
  assert.deepEqual(tree(de), [[`en:Legs ${run}`, ["en:Harbour", "en:Castle", "en:Garden"]]]);
});
