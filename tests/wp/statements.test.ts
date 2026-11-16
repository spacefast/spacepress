// TypedPress\Wp\Connection on mysqli (MariaDB): every statement is prepared for its own run, so a
// change to the session that WordPress shares with it (sql_mode, through Connection or $wpdb) applies
// to the very next statement. A statement cache was tried and removed (review 2, R2): a statement
// prepared before a `SET SESSION sql_mode` kept the old parse, and WordPress fires no hook for every
// session change it makes (wpdb::set_charset, ::select).
import { test } from "node:test";
import assert from "node:assert/strict";
import { wp } from "./env.ts";

function evaluate(php: string): any {
  return JSON.parse(wp("eval", `
    $db = \\TypedPress\\Wp\\Plugin::instance()->connection();
    $wpdb = $GLOBALS['wpdb'];
    ${php}
  `));
}

// The SQL text is SELECT HEX('a\nb') with a backslash and an n inside the literal (chr(92) in PHP, so
// no PHP or shell quoting turns it into a newline first). Without NO_BACKSLASH_ESCAPES the server reads
// a newline (610A62); with it, a backslash and an n (615C6E62).
const select = `$select = "SELECT HEX('a" . chr(92) . "nb') AS v";`;

test("a sql_mode change through Connection applies to the next identical SELECT", () => {
  const out = evaluate(`
    ${select}
    $mode = $wpdb->get_var('SELECT @@SESSION.sql_mode');
    $db->run("SET SESSION sql_mode = ''");
    $first = $db->run($select)[0]['v'];
    $db->run("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
    $second = $db->run($select)[0]['v'];
    $wpdb->query($wpdb->prepare('SET SESSION sql_mode = %s', $mode));
    echo json_encode([$first, $second]);
  `);
  assert.deepEqual(out, ["610A62", "615C6E62"]);
});

test("a sql_mode change through $wpdb applies to Connection's next identical SELECT", () => {
  const out = evaluate(`
    ${select}
    $mode = $wpdb->get_var('SELECT @@SESSION.sql_mode');
    $wpdb->query("SET SESSION sql_mode = ''");
    $first = $db->run($select)[0]['v'];
    $wpdb->query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'"); // wpdb::set_sql_mode() refuses this mode (its incompatible list)
    $second = $db->run($select)[0]['v'];
    $wpdb->query($wpdb->prepare('SET SESSION sql_mode = %s', $mode));
    echo json_encode([$first, $second]);
  `);
  assert.deepEqual(out, ["610A62", "615C6E62"]);
});

test("rows, affected rows and insert ids are each run's own", () => {
  const out = evaluate(`
    $db->run('CREATE TEMPORARY TABLE tp_stmt_test (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20))');
    $ids = [];
    $counts = [];
    for ($i = 0; $i < 5; $i++) {
      $db->run('INSERT INTO tp_stmt_test (v) VALUES (?)', ["v$i"]);
      $ids[] = $db->insertId();
      $counts[] = (int) $db->run('SELECT COUNT(*) AS n FROM tp_stmt_test')[0]['n'];
    }
    $db->run('UPDATE tp_stmt_test SET v = ? WHERE id > ?', ['x', 2]);
    echo json_encode(['ids' => $ids, 'counts' => $counts, 'changed' => $db->changes()]);
  `);
  assert.deepEqual(out, { ids: [1, 2, 3, 4, 5], counts: [1, 2, 3, 4, 5], changed: 3 });
});
