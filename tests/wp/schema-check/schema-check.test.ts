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
  assert.match(error.refusals[1].fix, /--drop=likes=3/);
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
  // `--drop likes=4` (a space) reaches WP-CLI as a bare flag plus a stray argument: an error, not ignored.
  assert.equal(migrate("--drop", "likes=4").error?.code, "invalid_drop");
  assert.deepEqual(applied("--drop=likes=4,memos.state=2"), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update", "0006_update"]);
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_zero\\_likes'"), []);
  assert.equal(rows("wp_zero_memos"), 2, "dropping a field keeps the rows");
});

test("a table the app didn't create is never altered or dropped without --drop, even when empty", () => {
  install("adoptedField");
  const before = state();
  const field = refused();
  // Renaming one of its columns needs --drop too: another reader of that table would lose it.
  assert.deepEqual(field.refusals.map((r) => [r.code, r.name, r.rows]), [
    ["drop_adopted_table", "tasks.title", 2],
    ["drop_adopted_table", "tasks.note", 1],
  ]);
  assert.match(field.refusals[1].message, new RegExp(adopted));
  // Emptying the column is not consent: the deploy still has to name it.
  sql(`UPDATE ${adopted} SET note = NULL`);
  assert.deepEqual(refused("--drop=tasks.title=2").refusals.map((r) => [r.code, r.rows]), [["drop_adopted_table", 0]]);
  assert.deepEqual(state().columns, before.columns);
  assert.deepEqual(applied("--drop=tasks.title=2,tasks.note=0"), ["0001_init", "0002_update", "0003_update", "0004_update", "0005_update", "0006_update", "0007_update"]);
  assert.deepEqual(sql(`SELECT name FROM ${adopted} ORDER BY id`), [{ name: "kept" }, { name: "also kept" }]);

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

test("a narrower column refuses while values wouldn't fit, and is never truncated", () => {
  install("narrow");
  // Two memos: one that fits in 5 characters, one that doesn't.
  sql("UPDATE wp_zero_memos SET text = 'ok'");
  sql("UPDATE wp_zero_memos SET text = 'far too long' WHERE id = (SELECT MIN(id) FROM (SELECT id FROM wp_zero_memos) AS m)");
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [["value_does_not_fit", "memos.text", 1]]);
  assert.deepEqual(sql("SELECT text FROM wp_zero_memos WHERE text = 'far too long'"), [{ text: "far too long" }], "nothing was truncated");
  sql("UPDATE wp_zero_memos SET text = 'short' WHERE text = 'far too long'");
  assert.deepEqual(applied().at(-1), "0009_update");
});

test("several pending files are checked under the names each statement will see", () => {
  // A site that missed the rename and drop deploys takes 0005 to 0009 together: 0005 renames notes
  // to memos, 0006 drops memos.state and the likes kind. 0006's checks must count the rows still in
  // wp_zero_notes, not find no wp_zero_memos and pass. Storage rewinds to before 0005, as such a site has it.
  sql("RENAME TABLE wp_zero_memos TO wp_zero_notes");
  sql("ALTER TABLE wp_zero_notes CHANGE COLUMN text body LONGTEXT, ADD COLUMN state LONGTEXT DEFAULT ('open') NOT NULL");
  sql("CREATE TABLE wp_zero_likes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, post BIGINT NOT NULL, emoji LONGTEXT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  sql("INSERT INTO wp_zero_likes (post, emoji) VALUES (1, 'x')");
  // 0007 and 0008 changed the adopted table, which this rewind doesn't bring back: keep them applied.
  sql("DELETE FROM wp_zero__migrations WHERE app = 'schema-check' AND id IN ('0005_update', '0006_update', '0009_update')");
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [
    ["drop_has_rows", "memos.state", 2],
    ["drop_has_rows", "likes", 1],
  ]);
  assert.equal(rows("wp_zero_notes"), 2, "nothing ran");
  assert.deepEqual(applied("--drop=memos.state=2,likes=1").at(-1), "0009_update");
  assert.deepEqual(sql("SHOW COLUMNS FROM wp_zero_memos").map((r) => r.Field), ["id", "text"]);
});

test("a refusal at activation keeps the plugin active so --drop can confirm it", () => {
  // Deactivate, then make the next activation hit a refused drop: a memo field the next build drops.
  wp("plugin", "deactivate", "zero-app-schema-check");
  sql("ALTER TABLE wp_zero_memos ADD COLUMN legacy LONGTEXT");
  sql("UPDATE wp_zero_memos SET legacy = 'keep?'");
  // A later build drops it: the migration that build would ship, with its check line.
  const live = process.env.ZERO_SCHEMA_CHECK_LIVE ?? "";
  execFileSync("sh", ["-c", `printf '%s' "$0" > "$1"`,
    '-- zero-check {"check":"drop","name":"memos.legacy","table":"{prefix}zero_memos","column":"legacy","adopted":false}\nALTER TABLE `{prefix}zero_memos` DROP COLUMN `legacy`;',
    `${live}/plugins/zero-app-schema-check/zero/app/migrations/9000_legacy.sql`]);
  const activation = wpTry("plugin", "activate", "zero-app-schema-check");
  assert.match(activation, /Plugin 'zero-app-schema-check' activated/);
  assert.equal(wp("plugin", "is-active", "zero-app-schema-check") === "", true);
  const error = refused();
  assert.deepEqual(error.drop, ["memos.legacy=2"]);
  assert.deepEqual(applied("--drop=memos.legacy=2").at(-1), "9000_legacy");
  assert.deepEqual(sql("SHOW COLUMNS FROM wp_zero_memos").map((r) => r.Field), ["id", "text"]);
});

/** The live text values of wp_zero_tags, by name. */
const tags = () => Object.fromEntries(sql("SELECT name, flag, count FROM wp_zero_tags ORDER BY id").map((r) => [r.name, [r.flag, r.count]]));

test("text becoming a boolean or an integer is checked as text, and integers against their range", () => {
  install("retype");
  assert.ok(applied().includes("0010_update"), "adding text fields needs nothing");
  // MySQL reads 'yes' as 0 and clamps a value past BIGINT's range: each would pass a numeric check.
  sql("INSERT INTO wp_zero_tags (name, flag, count) VALUES ('a', 'yes', '7'), ('b', '1', '99999999999999999999'), ('c', '0', '-9223372036854775808'), ('d', NULL, '007')");
  // Look-alikes the column's accent-insensitive collation equates with '1': each would become 0.
  sql("INSERT INTO wp_zero_tags (name, flag, count) VALUES ('w', '１', '1'), ('x', '١', '1'), ('y', '¹', '1'), ('z', '1 ', '1')");
  // PCRE's `$` matches before a final newline, and '-0' has no sign once stored: both would change.
  sql("INSERT INTO wp_zero_tags (name, flag, count) VALUES ('n', '0', '5\n'), ('m', '0', '-0')");
  install("retyped");
  const before = tags();
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [
    ["value_does_not_fit", "tags.flag", 5],
    ["value_does_not_fit", "tags.count", 4],
  ]);
  assert.deepEqual(tags(), before, "nothing was converted");
  // Fixed by hand: the in-range values (including BIGINT's minimum) then convert unchanged.
  sql("DELETE FROM wp_zero_tags WHERE name IN ('w', 'x', 'y', 'z', 'n', 'm')");
  sql("UPDATE wp_zero_tags SET flag = '1' WHERE flag = 'yes'");
  sql("UPDATE wp_zero_tags SET count = '9223372036854775807' WHERE name = 'b'");
  sql("UPDATE wp_zero_tags SET count = '7' WHERE count = '007'");
  assert.ok(applied().includes("0011_update"));
  assert.deepEqual(tags(), { a: ["1", "7"], b: ["1", "9223372036854775807"], c: ["0", "-9223372036854775808"], d: ["NULL", "7"] });
});

test("a field made required and narrower in one change refuses a too-long value, never truncating it", () => {
  install("requiredNarrow");
  sql("UPDATE wp_zero_tags SET name = 'far too long' WHERE name = 'a'");
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [["value_does_not_fit", "tags.name", 1]]);
  assert.deepEqual(sql("SELECT name FROM wp_zero_tags WHERE name = 'far too long'"), [{ name: "far too long" }], "nothing was truncated");
  // Once it fits, a missing value is the next refusal, and its fix names the command that retries.
  sql("UPDATE wp_zero_tags SET name = NULL WHERE name = 'far too long'");
  const missing = refused().refusals[0];
  assert.equal(missing.code, "required_field_missing");
  assert.match(missing.fix, /wp zero migrate/);
  sql("UPDATE wp_zero_tags SET name = 'a' WHERE name IS NULL");
  assert.ok(applied().includes("0012_update"));
  assert.deepEqual(sql("SELECT name FROM wp_zero_tags ORDER BY id").map((r) => r.name), ["a", "b", "c", "d"]);
});

test("an integer becoming a real refuses what a DOUBLE can't hold, BIGINT's minimum included", () => {
  install("toReal");
  // BIGINT's minimum overflows ABS(); 2^53 + 1 has no exact DOUBLE and would become 2^53.
  sql("UPDATE wp_zero_tags SET count = -9223372036854775808 WHERE name = 'a'");
  sql("UPDATE wp_zero_tags SET count = 9007199254740993 WHERE name = 'd'");
  const before = sql("SELECT name, count FROM wp_zero_tags ORDER BY id");
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [["value_does_not_fit", "tags.count", 4]]);
  assert.deepEqual(sql("SELECT name, count FROM wp_zero_tags ORDER BY id"), before, "nothing was converted");
  // Exactly 2^53 and -2^53 fit; the change then applies and keeps them exact.
  sql("UPDATE wp_zero_tags SET count = 9007199254740992 WHERE name IN ('a', 'b')");
  sql("UPDATE wp_zero_tags SET count = -9007199254740992 WHERE name IN ('c', 'd')");
  assert.ok(applied().includes("0013_update"));
  assert.deepEqual(sql("SELECT name, CAST(count AS DECIMAL(20,0)) AS count FROM wp_zero_tags ORDER BY id"), [
    { name: "a", count: "9007199254740992" }, { name: "b", count: "9007199254740992" },
    { name: "c", count: "-9007199254740992" }, { name: "d", count: "-9007199254740992" },
  ]);
});

test("a check whose count errors refuses with check_failed, never reading as zero rows", () => {
  // The condition the integer-to-real check used before: ABS() overflows on BIGINT's minimum
  // (MariaDB ERROR 1690), so the count fails. Written by hand, as an older build would have shipped it.
  sql("CREATE TABLE wp_zero_overflow (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, n BIGINT, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  sql("INSERT INTO wp_zero_overflow (n) VALUES (-9223372036854775808), (9007199254740993)");
  const live = process.env.ZERO_SCHEMA_CHECK_LIVE ?? "";
  const file = `${live}/plugins/zero-app-schema-check/zero/app/migrations/9001_overflow.sql`;
  execFileSync("sh", ["-c", `printf '%s' "$0" > "$1"`,
    '-- zero-check {"check":"narrow","name":"overflow.n","table":"{prefix}zero_overflow","column":"n","fits":"ABS({col}) <= 9007199254740992","adopted":false}\nALTER TABLE `{prefix}zero_overflow` MODIFY COLUMN `n` DOUBLE;',
    file]);
  try {
    const before = sql("SELECT n FROM wp_zero_overflow ORDER BY id");
    const error = refused();
    assert.deepEqual(error.refusals.map((r) => [r.code, r.name]), [["check_failed", "overflow.n"]]);
    // wpdb reports the overflow as an empty result, not an error: the count has no row, and refuses.
    assert.match(error.refusals[0].message, /returned no row|out of range|1690/i);
    assert.deepEqual(sql("SELECT n FROM wp_zero_overflow ORDER BY id"), before, "nothing was converted");
    assert.equal(sql("SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_zero_overflow' AND COLUMN_NAME = 'n'")[0].t, "bigint");
    assert.ok(!ledger().includes("9001_overflow"));
  } finally {
    execFileSync("rm", ["-f", file]);
    sql("DROP TABLE wp_zero_overflow");
  }
});

test("text becoming a real converts only plain decimals: '1,5', '1e3' and '5\\n' refuse", () => {
  install("ratioText");
  assert.ok(applied().includes("0014_update"));
  // MySQL would store these as 1, 1, 12, 3, 1000 and 5.
  sql("UPDATE wp_zero_tags SET ratio = '1.5' WHERE name = 'a'");
  sql("UPDATE wp_zero_tags SET ratio = '-0.25' WHERE name = 'b'");
  sql("INSERT INTO wp_zero_tags (name, flag, count, ratio) VALUES ('p', 0, 0, '1,5'), ('q', 0, 0, '1x5'), ('r', 0, 0, '12-34'), ('s', 0, 0, '3 5'), ('t', 0, 0, '1e3'), ('u', 0, 0, '5\n')");
  // The rule integers follow: a value converts only when it reads back as the same text, so '-0',
  // '-0.0' and '1.50' (read back as 0, 0 and 1.5) refuse. '-0.5' is canonical and converts.
  sql("INSERT INTO wp_zero_tags (name, flag, count, ratio) VALUES ('v', 0, 0, '-0'), ('x', 0, 0, '-0.0'), ('y', 0, 0, '1.50'), ('z', 0, 0, '-0.5')");
  install("ratioReal");
  const before = sql("SELECT name, ratio FROM wp_zero_tags ORDER BY id");
  const error = refused();
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [["value_does_not_fit", "tags.ratio", 9]]);
  assert.deepEqual(sql("SELECT name, ratio FROM wp_zero_tags ORDER BY id"), before, "nothing was converted");
  sql("DELETE FROM wp_zero_tags WHERE name IN ('p', 'q', 'r', 's', 't', 'u', 'v', 'x', 'y')");
  assert.ok(applied().includes("0015_update"));
  assert.deepEqual(sql("SELECT name, ratio FROM wp_zero_tags WHERE ratio IS NOT NULL ORDER BY id"), [{ name: "a", ratio: "1.5" }, { name: "b", ratio: "-0.25" }, { name: "z", ratio: "-0.5" }]);
});

test("text becoming BIGINT UNSIGNED refuses values from 2^63, which ALTER would clamp", () => {
  install("memoText");
  assert.ok(applied().includes("0016_update"));
  // 2^63 - 1 fits; 2^63 and 10^19 are valid BIGINT UNSIGNED, but MariaDB's ALTER clamps them to 2^63 - 1.
  sql("DELETE FROM wp_zero_tags WHERE name = 'z'");
  sql("UPDATE wp_zero_tags SET memo = '9223372036854775807' WHERE name = 'a'");
  sql("UPDATE wp_zero_tags SET memo = '9223372036854775808' WHERE name = 'b'");
  sql("UPDATE wp_zero_tags SET memo = '10000000000000000000' WHERE name = 'c'");
  install("memoRef");
  const before = sql("SELECT name, memo FROM wp_zero_tags ORDER BY id");
  const error = refused();
  // Two refuse: 2^63 - 1 fits.
  assert.deepEqual(error.refusals.map((r) => [r.code, r.name, r.rows]), [["value_does_not_fit", "tags.memo", 2]]);
  assert.deepEqual(sql("SELECT name, memo FROM wp_zero_tags ORDER BY id"), before, "nothing was converted or clamped");
  // Fixed: the reference points at a memo, and the rest are empty.
  const memo = sql("SELECT MIN(id) AS id FROM wp_zero_memos")[0].id;
  sql(`UPDATE wp_zero_tags SET memo = '${memo}' WHERE name = 'a'`);
  sql("UPDATE wp_zero_tags SET memo = NULL WHERE name IN ('b', 'c')");
  assert.ok(applied().includes("0017_update"));
  assert.deepEqual(sql("SELECT name, memo FROM wp_zero_tags WHERE memo IS NOT NULL"), [{ name: "a", memo }]);
});

test("a field of a table the app didn't create changes type only with --drop, even when empty", () => {
  install("readoptField");
  assert.ok(applied().includes("0018_update"), "adopting the table and its field needs nothing");
  install("readoptRetype");
  const columns = sql("SHOW COLUMNS FROM sf_spc_schema_check_retype");
  const retype = refused();
  assert.deepEqual(retype.refusals.map((r) => [r.code, r.name, r.rows]), [["drop_adopted_table", "tasks.rank", 0]]);
  assert.match(retype.refusals[0].message, /sf_spc_schema_check_retype/);
  assert.deepEqual(sql("SHOW COLUMNS FROM sf_spc_schema_check_retype"), columns, "a refused retype changed the table");
  assert.ok(applied("--drop=tasks.rank=0").includes("0019_update"));
  const rank = sql("SHOW COLUMNS FROM sf_spc_schema_check_retype").find((c) => c.Field === "rank");
  assert.equal(String(rank?.Type).toLowerCase(), "longtext", "the confirmed retype made rank text");
  assert.deepEqual(sql("SELECT name FROM sf_spc_schema_check_retype"), [{ name: "from 0.8" }], "the adopted rows are kept");
});

test("a migration that failed after a rename resumes: later checks find the table under its new name", () => {
  // One file: rename notes2 to memos2, then a step that fails (a constraint over an orphan row),
  // then a drop whose check names the table as it was before the plan. Built here by hand, the shape
  // `zero build` plans for a `was` rename plus a new reference and a removed field.
  const live = process.env.ZERO_SCHEMA_CHECK_LIVE ?? "";
  const file = `${live}/plugins/zero-app-schema-check/zero/app/migrations/9002_resume.sql`;
  sql("CREATE TABLE wp_zero_notes2 (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, body LONGTEXT, ref BIGINT UNSIGNED, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  sql("INSERT INTO wp_zero_notes2 (body, ref) VALUES ('kept', 424242)");
  const statements = [
    '-- zero-check {"check":"rename","table":"{prefix}zero_notes2","to":"{prefix}zero_memos2"}\nRENAME TABLE `{prefix}zero_notes2` TO `{prefix}zero_memos2`;',
    "ALTER TABLE `{prefix}zero_memos2` ADD CONSTRAINT `zero_memos2_ref_fk` FOREIGN KEY (`ref`) REFERENCES `{prefix}zero_memos` (`id`);",
    '-- zero-check {"check":"drop","name":"memos2.body","table":"{prefix}zero_notes2","column":"body","adopted":false}\nALTER TABLE `{prefix}zero_memos2` DROP COLUMN `body`;',
  ];
  execFileSync("sh", ["-c", `printf '%s' "$0" > "$1"`, statements.join("\n--> statement-breakpoint\n"), file]);
  try {
    // The drop's check counts the row still in notes2, so it needs --drop; the constraint then fails.
    const failed = migrate("--drop=memos2.body=1");
    assert.ok(failed.error, JSON.stringify(failed));
    assert.notEqual(failed.error.code, "schema_refused", "the check passed; the constraint failed");
    assert.deepEqual(sql("SELECT id FROM wp_zero__migrations WHERE app = 'schema-check' AND id LIKE '9002%'").map((r) => r.id), ["9002_resume:1"]);
    // The cause fixed. The retry checks the drop against memos2, where the row now is: still 1 row.
    sql("UPDATE wp_zero_memos2 SET ref = NULL");
    const again = refused();
    assert.deepEqual(again.refusals.map((r) => [r.code, r.name, r.rows]), [["drop_has_rows", "memos2.body", 1]]);
    assert.ok(applied("--drop=memos2.body=1").includes("9002_resume"));
    assert.deepEqual(sql("SHOW COLUMNS FROM wp_zero_memos2").map((r) => r.Field), ["id", "ref"]);
  } finally {
    execFileSync("rm", ["-f", file]);
    sql("DROP TABLE IF EXISTS wp_zero_memos2");
    sql("DROP TABLE IF EXISTS wp_zero_notes2");
  }
});
