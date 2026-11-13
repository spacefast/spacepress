#!/usr/bin/env node
// Request cost of reactive queries on the tests/wp stack (docs/decisions/2026-11-13-reactive-queries.md).
// Run against a stack that is already up (tests/wp/run.sh with FIRST_WP_KEEP=1):
//   node tests/wp/bench-live.mjs [--requests 200]
// Prints, per request shape: median and p95 wall time from this process, response bytes, and SQL
// statements per request (MariaDB's `Questions` counter, less what reading the counter itself costs).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const harness = JSON.parse(readFileSync(process.env.FIRST_WP_HARNESS ?? join(here, ".harness.json"), "utf8"));
const api = `${harness.url}/__first/api/v1`;
const requests = Number(process.argv[process.argv.indexOf("--requests") + 1]) || 200;
const basic = (role) => ({ Authorization: "Basic " + btoa(`${role}:${harness.users[role].appPassword}`) });
const questions = () => Number(execFileSync(join(here, "harness.sh"), ["sql", "SHOW GLOBAL STATUS LIKE 'Questions'"], { encoding: "utf8" }).trim().split("\n").at(-1).split("\t")[1]);

async function call(method, url, headers = {}, body) {
  const res = await fetch(url, { method, headers: body === undefined ? headers : { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
  return text;
}
const live = async (headers, queries) => JSON.parse(await call("POST", `${api}/_live`, headers, { queries })).data.results;

// 50 rows to list, so the comparison is against a list a page would really show.
const have = JSON.parse(await call("GET", `${api}/guest_notes?limit=100`)).data.length;
for (let i = have; i < 50; i++) await call("POST", `${api}/guest_notes`, basic("subscriber"), { body: `bench ${i}` });

const list = { kind: "guestNotes", op: "list", args: { orderBy: { id: "desc" }, limit: 50 } };
const ten = Array.from({ length: 10 }, (_, i) => ({ kind: "guestNotes", op: "list", args: { orderBy: { id: "desc" }, limit: 50, offset: i } }));
const masked = { kind: "payroll", op: "list", args: { limit: 50 } };
const tokens = (queries) => queries.map((q, i) => ({ ...q, token: held[i].token }));
let held;

const shapes = [
  ["_live: 1 list, not modified (counter)", async () => { held = await live({}, [list]); return () => call("POST", `${api}/_live`, {}, { queries: [{ ...list, token: held[0].token }] }); }],
  ["_live: 10 lists, not modified (counter)", async () => { held = await live({}, ten); const q = tokens(ten); return () => call("POST", `${api}/_live`, {}, { queries: q }); }],
  ["_live: 1 list, not modified (signed in, counter)", async () => { held = await live(basic("subscriber"), [list]); return () => call("POST", `${api}/_live`, basic("subscriber"), { queries: [{ ...list, token: held[0].token }] }); }],
  ["_live: 1 list, not modified (hidden field: the read runs)", async () => { held = await live(basic("subscriber"), [masked]); return () => call("POST", `${api}/_live`, basic("subscriber"), { queries: [{ ...masked, token: held[0].token }] }); }],
  ["_live: 1 list, changed (50 rows)", async () => () => call("POST", `${api}/_live`, {}, { queries: [list] })],
  ["GET /me, signed out (the API's floor: WordPress boots, nothing is read)", async () => () => call("GET", `${api}/me`)],
  ["GET /me, signed in (the floor with an application password)", async () => () => call("GET", `${api}/me`, basic("subscriber"))],
  ["GET /guest_notes?limit=50 (what watch() polls today)", async () => () => call("GET", `${api}/guest_notes?limit=50&orderBy=-id`)],
  ["GET / (a WordPress page render)", async () => () => call("GET", `${harness.url}/`)],
];

const idle = (() => { const a = questions(); return questions() - a; })();
const rows = [];
for (const [name, prepare] of shapes) {
  const request = await prepare();
  for (let i = 0; i < 20; i++) await request();
  const times = [];
  let bytes = 0;
  const before = questions();
  for (let i = 0; i < requests; i++) {
    const t = performance.now();
    bytes = (await request()).length;
    times.push(performance.now() - t);
  }
  const sql = (questions() - before - idle) / requests;
  times.sort((a, b) => a - b);
  rows.push({ request: name, "p50 ms": times[Math.floor(requests / 2)].toFixed(1), "p95 ms": times[Math.floor(requests * 0.95)].toFixed(1), bytes, "SQL statements": sql.toFixed(1) });
}
console.table(rows);
