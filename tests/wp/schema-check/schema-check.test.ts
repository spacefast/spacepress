// The deploy-time schema check (spec §2.9) on WordPress/MariaDB: each step installs the next build
// of one app and runs `wp zero migrate`, the deploy's migration step. A refusal leaves every table,
// row and ledger entry as it was, and names the live count and the fix.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { sql, wp, wpTry } from "../env.ts";

const content = process.env.ZERO_SCHEMA_CHECK_CONTENT ?? "";
const live = process.env.ZERO_SCHEMA_CHECK_LIVE ?? "";
const adopted = "sf_spc_schema_check_tasks_0123456789";

/** Installs a step's build the way a file-copy deploy does: the app plugin's files are replaced. */
function install(step: string) {
  execFileSync("rsync", ["-a", "--delete", `${content}/${step}/`, `${live}/`]);
}

type Refusal = { code: string; name: string; rows: number; fix: string; message: string; drop?: string; migration: string };
type Problem = { status: number; code: string; refusals: Refusal[]; drop: string[] };

function migrate(...flags: string[]): { data?: { applied: string[] }; error?: Problem } {
  return JSON.parse(wpTry("zero", "migrate", ...flags));
}

function refused(...flags: string[]): Problem {
  const out = migrate(...flags);
  assert.ok(out.error, JSON.stringify(out));
  assert.equal(out.error.status, 409);
  assert.equal(out.error.code, "schema_refused");
  return out.error;
}

/**
 * The migration succeeds, and returns this app's ledger. (WordPress's own `init` already applies a
 * new build that needs no confirmation, so the ledger, not this call's `applied`, is the proof.)
 */
function applied(...flags: string[]): string[] {
  const out = migrate(...flags);
  assert.ok(out.data, JSON.stringify(out));
  return ledger();
}

const ledger = () => sql("SELECT id FROM wp_zero__migrations WHERE app = 'schema-check' AND id NOT LIKE '%:%' ORDER BY id").map((r) => r.id);

/** Everything a refusal must leave alone: the tables, their columns, their rows, and the ledger. */
function state() {
  return {
    tables: sql("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'wp\\_zero\\_%' OR TABLE_NAME LIKE 'sf\\_%') ORDER BY 1"),
    columns: sql("SELECT TABLE_NAME AS t, COLUMN_NAME AS c, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'wp\\_zero\\_%' OR TABLE_NAME LIKE 'sf\\_%') ORDER BY 1, 2"),
    adopted: sql(`SELECT * FROM ${adopted} ORDER BY id`),
    ledger: sql("SELECT id FROM wp_zero__migrations WHERE app = 'schema-check' ORDER BY id"),
    likes: sql("SHOW TABLES LIKE 'wp\\_zero\\_likes'").length ? sql("SELECT * FROM wp_zero_likes ORDER BY id") : [],
  };
}

const rows = (table: string, where = "1") => Number(sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)[0].n);

test("the first deploy adopts the existing table and creates the rest", () => {
  // `up` activated the app, which migrated: the adopted rows are there, untouched.
  assert.deepEqual(applied(), ["0001_init"]);
  assert.deepEqual(sql(`SELECT title, note FROM ${adopted} ORDER BY id`), [{ title: "kept", note: "from 0.8" }, { title: "also kept", note: "NULL" }]);
  for (let i = 0; i < 3; i++) wp("zero", "insert", "likes", JSON.stringify({ post: i + 1 }));
  wp("zero", "insert", "notes", JSON.stringify({ body: "first" }));
  wp("zero", "insert", "notes", JSON.stringify({ body: "second" }));
});

test("an additive change applies with no --drop and no refusal", () => {
  install("additive");
  assert.deepEqual(applied(), ["0001_init", "0002_update"]);
  // The required field with a default reached the existing rows.
  assert.deepEqual(sql("SELECT state FROM wp_zero_notes ORDER BY id"), [{ state: "open" }, { state: "open" }]);
  assert.equal(rows("wp_zero_tags"), 0);
});

test("a new required field on rows that lack it is refused with the count and the fix", () => {
  install("required");
  const before = state();
  const error = refused();
  assert.equal(error.refusals.length, 1);
  const [refusal] = error.refusals;
  assert.equal(refusal.code, "required_field_missing");
  assert.equal(refusal.name, "notes.author");
  assert.equal(refusal.rows, 2);
  assert.equal(refusal.migration, "0003_update");
  assert.match(refusal.fix, /\.default\(value\)/);
  // --drop can't accept a required-field refusal: it names no data to delete.
  assert.equal(refused("--drop=notes=2").refusals[0].code, "required_field_missing");
  assert.deepEqual(state(), before, "a refusal changes no table, row or ledger entry");
  // The fix: no rows lack it once there are no rows. (Applied here so the next steps build on it.)
  sql("DELETE FROM wp_zero_notes");
  assert.deepEqual(applied(), ["0001_init", "0002_update", "0003_update"]);
  wp("zero", "insert", "notes", JSON.stringify({ body: "third", author: "ana" }));
  wp("zero", "insert", "notes", JSON.stringify({ body: "fourth", author: "ben" }));
});

test("an optional field becoming required is refused while rows lack it", () => {
  install("tighten");
  sql("UPDATE wp_zero_likes SET emoji = 'heart' WHERE id = 1");
  const before = state();
  const error = refused();
  // The same deploy also drops notes.author, which holds 2 values: both refusals come back at once.
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [
    ["required_field_missing", "likes.emoji", 2],
    ["drop_has_rows", "notes.author", 2],
  ]);
  assert.match(error.refusals[0].fix, /^Fill those rows/);
  assert.deepEqual(error.drop, ["notes.author=2"]);
  assert.deepEqual(state(), before);
  sql("UPDATE wp_zero_likes SET emoji = 'star' WHERE emoji IS NULL");
  assert.equal(refused().refusals[0].code, "drop_has_rows", "the required field passes once filled; the drop still asks");
  assert.deepEqual(applied("--drop=notes.author=2"), ["0001_init", "0002_update", "0003_update", "0004_update"]);
  assert.equal(sql("SELECT IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_zero_likes' AND COLUMN_NAME = 'emoji'")[0].n, "NO");
});

test(".was() renames a kind and a field in place, keeping every row", () => {
  install("rename");
  const notes = sql("SELECT id, body FROM wp_zero_notes ORDER BY id");
  assert.deepEqual(applied(), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update"]);
  assert.deepEqual(sql("SELECT id, text AS body FROM wp_zero_memos ORDER BY id"), notes);
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_zero\\_notes'"), []);
  assert.equal(JSON.parse(wp("zero", "find", "memos")).data.length, 2);
});

test("dropping a kind or field that holds rows needs --drop with the exact live count", () => {
  install("drop");
  const before = state();
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [
    ["drop_has_rows", "memos.state", 2],
    ["drop_has_rows", "likes", 3],
  ]);
  assert.match(error.refusals[1].fix, /--drop likes=3/);
  assert.deepEqual(error.drop, ["memos.state=2", "likes=3"]);
  // One confirmation is not both: the other still refuses, and nothing runs.
  assert.deepEqual(refused("--drop=likes=3").refusals.map((r) => r.name), ["memos.state"]);
  // A stale count refuses with the live one: someone added a like since the deploy was planned.
  // (SQL: while a refusal is pending, Zero's own writes are refused too.)
  sql("INSERT INTO wp_zero_likes (post, emoji) VALUES (9, 'new')");
  const stale = refused("--drop=likes=3,memos.state=2");
  assert.deepEqual(stale.refusals.map((r) => [r.code, r.rows, r.drop]), [["drop_count_mismatch", 4, "likes=4"]]);
  assert.deepEqual(state().ledger, before.ledger);
  assert.equal(rows("wp_zero_likes"), 4, "a stale count deleted nothing");
  const invalid = migrate("--drop=likes");
  assert.equal(invalid.error?.code, "invalid_drop");
  assert.deepEqual(applied("--drop=likes=4,memos.state=2"), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update", "0006_update"]);
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_zero\\_likes'"), []);
  assert.equal(rows("wp_zero_memos"), 2, "dropping a field keeps the rows");
});

test("a table the app didn't create is never altered or dropped without --drop, even when empty", () => {
  install("adoptedField");
  const before = state();
  const field = refused();
  assert.deepEqual(field.refusals.map((r) => [r.code, r.name, r.rows]), [["drop_adopted_table", "tasks.note", 1]]);
  assert.match(field.refusals[0].message, new RegExp(adopted));
  // Emptying the column is not consent: the deploy still has to name it.
  sql(`UPDATE ${adopted} SET note = NULL`);
  assert.deepEqual(refused().refusals.map((r) => [r.code, r.rows]), [["drop_adopted_table", 0]]);
  assert.deepEqual(state().columns, before.columns);
  assert.deepEqual(applied("--drop=tasks.note=0"), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update", "0006_update", "0007_update"]);
  assert.deepEqual(sql(`SELECT title FROM ${adopted} ORDER BY id`), [{ title: "kept" }, { title: "also kept" }]);

  // Removing the kind: refused with its rows, then refused when empty too.
  install("adoptedKind");
  const kind = refused();
  assert.deepEqual(kind.refusals.map((r) => [r.code, r.name, r.rows]), [["drop_adopted_table", "tasks", 2]]);
  sql(`DELETE FROM ${adopted}`);
  assert.deepEqual(refused().refusals.map((r) => [r.code, r.rows]), [["drop_adopted_table", 0]]);
  assert.deepEqual(sql(`SHOW TABLES LIKE '${adopted}'`), [{ [`Tables_in_wordpress (${adopted})`]: adopted }]);
  assert.deepEqual(applied("--drop=tasks=0"), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update", "0006_update", "0007_update", "0008_update"]);
  assert.deepEqual(sql(`SHOW TABLES LIKE '${adopted}'`), []);
});
