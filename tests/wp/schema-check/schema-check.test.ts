import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { first, sql, wpTry } from "../env.ts";

const content = process.env.TP_SCHEMA_CHECK_CONTENT ?? "";
const live = process.env.TP_SCHEMA_CHECK_LIVE ?? "";
const migrations = "plugins/typedpress-app-schema-check/tp/app/migrations";

function install(step: string) {
  execFileSync("rsync", ["-a", "--delete", `${content}/${step}/`, `${live}/`]);
}

const ledger = () => sql("SELECT id FROM wp_tp__migrations WHERE app = 'schema-check' ORDER BY id").map((row) => row.id);
const notes = () => sql("SELECT id, body, state, category FROM wp_tp_notes ORDER BY id");
const tasks = () => sql("SELECT id, title, note FROM wp_external_tasks ORDER BY id");
const likes = () => sql("SELECT id, post, emoji FROM wp_tp_likes ORDER BY id");

function migrated(step: string) {
  first("migrate");
  const planned = readdirSync(join(content, step, migrations)).sort();
  assert.deepEqual(ledger(), planned);
  return planned;
}

function withMigration(id: string, statements: string[], check: () => void) {
  const folder = join(live, migrations, id);
  const path = join(folder, "migration.sql");
  mkdirSync(folder);
  try {
    writeFileSync(path, statements.join("\n--> statement-breakpoint\n"));
    check();
  } finally {
    unlinkSync(path);
    rmdirSync(folder);
  }
}

test("the first deploy adopts the existing table and creates its own tables", () => {
  const [initial, ...later] = migrated("initial");
  assert.match(initial, /^[0-9]{14}_[0-9a-hjkmnp-tv-z]{6}_init$/);
  assert.deepEqual(later, []);
  assert.deepEqual(tasks(), [
    { id: "1", title: "kept", note: "existing row" },
    { id: "2", title: "also kept", note: "NULL" },
  ]);
  assert.deepEqual(first("find", "tasks").map((row: { title: string }) => row.title).sort(), ["also kept", "kept"]);
  first("insert", "likes", '{"post":1}');
  first("insert", "notes", '{"body":"first","count":"7","total":-1}');
  first("insert", "notes", '{"body":"second","state":"closed"}');
});

test("the additive deploy widens text, backfills defaults and preserves existing values", () => {
  const before = ledger();
  install("additive");
  const after = migrated("additive");
  assert.deepEqual(after.slice(0, -1), before);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(notes(), [
    { id: "1", body: "first", state: "open", category: "general" },
    { id: "2", body: "second", state: "closed", category: "general" },
  ]);
  assert.deepEqual(likes(), [{ id: "1", post: "1", emoji: "NULL" }]);
  assert.deepEqual(first("find", "tags"), []);
  assert.equal(sql("SHOW COLUMNS FROM wp_tp_notes LIKE 'body'")[0].Type, "varchar(100)");
});

test("a renamed TypeScript export and field aliases leave the original tables and rows in place", () => {
  const before = { notes: notes(), tasks: tasks(), ledger: ledger() };
  install("renamed");
  assert.deepEqual(migrated("renamed"), before.ledger);
  assert.deepEqual(notes(), before.notes);
  assert.deepEqual(tasks(), before.tasks);
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp_tp_memos'"), []);
  assert.deepEqual(first("find", "notes").map((row: { text: string }) => row.text).sort(), ["first", "second"]);
  assert.deepEqual(first("find", "tasks").map((row: { name: string }) => row.name).sort(), ["also kept", "kept"]);
  first("insert", "notes", '{"body":"old name"}');
  assert.equal(notes().at(-1)?.body, "old name");
});

test("retiring a kind, field or an adopted binding keeps their stored data", () => {
  const before = { notes: notes(), tasks: tasks(), likes: likes(), ledger: ledger() };
  install("retired");
  const after = migrated("retired");
  assert.deepEqual(after.slice(0, -1), before.ledger);
  assert.equal(after.length, before.ledger.length + 1);
  assert.deepEqual(notes(), before.notes);
  assert.deepEqual(tasks(), before.tasks);
  assert.deepEqual(likes(), before.likes);
  assert.ok(first("find", "notes").every((row: object) => !("category" in row)));
  first("insert", "notes", '{"text":"new memo"}');
  assert.equal(notes().at(-1)?.body, "new memo");
});

test("a live preflight counts missing and incompatible values before applying any statement", () => {
  const id = "99991231235959_000000_preflight";
  sql("UPDATE wp_tp_notes SET count = '007' WHERE id = 1");
  const before = { notes: notes(), ledger: ledger(), counts: sql("SELECT count FROM wp_tp_notes ORDER BY id") };
  withMigration(id, [
    "ALTER TABLE `{prefix}tp_notes` ADD COLUMN `first_step` LONGTEXT;",
    '-- typedpress-check {"check":"required","name":"notes.reviewer","table":"{prefix}tp_notes"}\nALTER TABLE `{prefix}tp_notes` ADD COLUMN `reviewer` LONGTEXT NOT NULL;',
    '-- typedpress-check {"check":"narrow","name":"notes.count","table":"{prefix}tp_notes","column":"count","fits":"BINARY CAST(CAST({col} AS SIGNED) AS CHAR) = BINARY {col}"}\nALTER TABLE `{prefix}tp_notes` MODIFY COLUMN `count` BIGINT;',
  ], () => {
    const result = JSON.parse(wpTry("typedpress", "migrate"));
    assert.equal(result.error?.code, "schema_refused");
    assert.equal(result.error.refusals.length, 2);
    const [required, narrow] = result.error.refusals;
    assert.deepEqual([required.code, required.name, required.rows, required.migration], ["required_field_missing", "notes.reviewer", before.notes.length, id]);
    assert.match(required.fix, /\.default\(value\)/);
    assert.deepEqual([narrow.code, narrow.name, narrow.rows, narrow.migration], ["value_does_not_fit", "notes.count", 1, id]);
    assert.deepEqual(notes(), before.notes);
    assert.deepEqual(ledger(), before.ledger);
    assert.deepEqual(sql("SELECT count FROM wp_tp_notes ORDER BY id"), before.counts);
    assert.deepEqual(sql("SHOW COLUMNS FROM wp_tp_notes LIKE 'first_step'"), []);
  });
  first("migrate");
});

test("a count that overflows refuses the migration and preserves the stored value", () => {
  sql("UPDATE wp_tp_notes SET total = -9223372036854775808 WHERE id = 1");
  const totals = sql("SELECT total FROM wp_tp_notes ORDER BY id");
  const before = ledger();
  withMigration("99991231235959_000000_overflow", [
    '-- typedpress-check {"check":"narrow","name":"notes.total","table":"{prefix}tp_notes","column":"total","fits":"ABS({col}) <= 9007199254740992"}\nALTER TABLE `{prefix}tp_notes` MODIFY COLUMN `total` DOUBLE;',
  ], () => {
    const result = JSON.parse(wpTry("typedpress", "migrate"));
    assert.equal(result.error?.code, "schema_refused");
    assert.equal(result.error.refusals.length, 1);
    const [refusal] = result.error.refusals;
    assert.deepEqual([refusal.code, refusal.name], ["check_failed", "notes.total"]);
    assert.match(refusal.message, /returned no row|out of range|1690/i);
    assert.deepEqual(sql("SELECT total FROM wp_tp_notes ORDER BY id"), totals);
    assert.deepEqual(ledger(), before);
  });
  first("migrate");
});

test("the runtime refuses a destructive migration even with matching row confirmation", () => {
  const before = { notes: notes(), ledger: ledger() };
  withMigration("99991231235959_000000_drop", [
    "ALTER TABLE `{prefix}tp_notes` ADD COLUMN `first_step` LONGTEXT;",
    "ALTER TABLE `{prefix}tp_notes` DROP COLUMN `category`;",
  ], () => {
    const result = JSON.parse(wpTry('--exec=putenv("TP_DEBUG=1");', "typedpress", "migrate", `--drop=notes.category=${before.notes.length}`));
    assert.equal(result.error?.code, "internal");
    assert.match(result.error.detail, /Refusing destructive DDL \(DROP COLUMN\)/);
    assert.deepEqual(notes(), before.notes);
    assert.deepEqual(ledger(), before.ledger);
    assert.deepEqual(sql("SHOW COLUMNS FROM wp_tp_notes LIKE 'first_step'"), []);
  });
  first("migrate");
});
