// The build-time loader's paging against an in-memory stand-in for `POST /__first/api/v1/_live`
// (same answers: a sealed token per read, "not modified" when the read's rows are the same, and
// "pending" now and then): random inserts with high and low keys, deletes, edits and rows leaving
// and joining the filter. After every build the entries must be exactly the rows, none stale, and
// the pages must not grow with every row ever written. loader.test.mjs runs the same loader on a
// real site.
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstLoader } from "../src/index.js";

const DESC = { data: { kinds: { notes: { type: "table", key: "notes", route: "/wp/v2/notes", primaryKey: "id", columns: {}, relations: {} } } } };
test("paging keeps every row exactly once and the pages near rows / size, through random writes", async () => {
for (const seed0 of [1, 2, 3, 4, 5, 6, 7, 8]) {
  let seed = seed0; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const db = new Map(); let next = 1000;
  for (let i = 0; i < 120; i++) { db.set(next, { id: next, v: 0, on: true }); next += 2; }
  const fetch = async (url, init) => {
    if (new URL(url).pathname.endsWith("/v1")) return new Response(JSON.stringify(DESC));
    const { queries } = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { results: queries.map((q) => {
      if (rnd() < 0.1) return { pending: true };
      const w = q.args.where; const conds = w?.AND ?? (w ? [w] : []); const lo = conds.find((x) => x.id?.gt !== undefined)?.id.gt; const hi = conds.find((x) => x.id?.lte !== undefined)?.id.lte;
      const rows = [...db.values()].filter((r) => r.on && (lo === undefined || r.id > lo) && (hi === undefined || r.id <= hi)).sort((a, b) => a.id - b.id).slice(0, q.args.limit);
      const t = JSON.stringify([lo ?? null, hi ?? null, rows]); return q.token === t ? { changed: false, token: t } : { changed: true, token: t, data: rows };
    }) } }));
  };
  const state = { entries: new Map(), meta: new Map() };
  const ctx = { store: { get: (i) => state.entries.get(i), set: (e) => state.entries.set(e.id, e), has: (i) => state.entries.has(i), keys: () => [...state.entries.keys()], delete: (i) => state.entries.delete(i) },
    meta: { get: (k) => state.meta.get(k), set: (k, v) => state.meta.set(k, v), delete: (k) => state.meta.delete(k) }, logger: { info() {} }, parseData: async ({ data }) => data, generateDigest: (d) => JSON.stringify(d) };
  const loader = firstLoader("notes", { site: "http://x", fetch, pageSize: 10, id: "id" });
  let maxPages = 0;
  for (let b = 0; b < 300; b++) {
    const ops = Math.floor(rnd() * 8);
    for (let k = 0; k < ops; k++) {
      const ids = [...db.keys()]; const pick = ids[Math.floor(rnd() * ids.length)]; const r = rnd();
      if (r < 0.25) db.delete(pick);
      else if (r < 0.45) { db.set(next, { id: next, v: 0, on: true }); next += 2; }
      else if (r < 0.55) { const low = 1 + Math.floor(rnd() * 999) * 2 + 1001 + (Math.floor(rnd()*100)*2+1); if (!db.has(low)) db.set(low, { id: low, v: 0, on: true }); }
      else if (r < 0.8) db.get(pick).v++;
      else db.get(pick).on = !db.get(pick).on;
    }
    await loader.load(ctx);
    const want = [...db.values()].filter((r) => r.on).map((r) => String(r.id)).sort();
    const got = [...state.entries.keys()].sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) assert.fail(`seed ${seed0} build ${b}: entries differ`);
    for (const r of db.values()) if (r.on && state.entries.get(String(r.id)).data.v !== r.v) assert.fail(`seed ${seed0} build ${b}: stale ${r.id}`);
    const pages = JSON.parse(state.meta.get("first:pages")).pages;
    maxPages = Math.max(maxPages, pages.length - Math.ceil(want.length / 10));
  }
  assert.ok(maxPages <= 20, `seed ${seed0}: ${maxPages} pages over rows / size`);
}
});
