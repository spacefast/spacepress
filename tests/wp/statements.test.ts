// First\Wp\Connection on mysqli (MariaDB): a statement run again in the same request reuses its
// prepared statement, with each run's own parameters and rows; a reconnect starts over; the
// statements kept per request are bounded; a failed statement is not kept. Prepares are counted
// by the server (`Com_stmt_prepare` for this session), not guessed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wp } from "./env.ts";

function evaluate(php: string): any {
  return JSON.parse(wp("eval", `
    $db = \\First\\Wp\\Plugin::instance()->connection();
    $wpdb = $GLOBALS['wpdb'];
    $prepares = static fn (): int => (int) $wpdb->get_row("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'", ARRAY_N)[1];
    ${php}
  `));
}

test("a repeated statement is prepared once, with each run's own parameters and rows", () => {
  const out = evaluate(`
    $before = $prepares();
    $rows = [];
    foreach (['siteurl', 'home', 'blogname', 'siteurl'] as $name) {
      $rows[] = $db->run('SELECT option_value AS v FROM ' . $wpdb->options . ' WHERE option_name = ?', [$name])[0]['v'] ?? null;
    }
    $none = $db->run('SELECT option_value AS v FROM ' . $wpdb->options . ' WHERE option_name = ?', ['no such option']);
    echo json_encode(['prepares' => $prepares() - $before, 'rows' => $rows, 'expected' => [get_option('siteurl'), get_option('home'), get_option('blogname'), get_option('siteurl')], 'none' => $none]);
  `);
  assert.equal(out.prepares, 1);
  assert.deepEqual(out.rows, out.expected);
  assert.deepEqual(out.none, []);
});

test("statements alternate without leaking results, writes report their changes and ids", () => {
  const out = evaluate(`
    $before = $prepares();
    $db->run('CREATE TEMPORARY TABLE first_stmt_test (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20))');
    $ids = [];
    $counts = [];
    for ($i = 0; $i < 5; $i++) {
      $db->run('INSERT INTO first_stmt_test (v) VALUES (?)', ["v$i"]);
      $ids[] = $db->insertId();
      $counts[] = (int) $db->run('SELECT COUNT(*) AS n FROM first_stmt_test')[0]['n'];
    }
    $db->run('UPDATE first_stmt_test SET v = ? WHERE id > ?', ['x', 2]);
    $changed = $db->changes();
    echo json_encode(['ids' => $ids, 'counts' => $counts, 'changed' => $changed, 'prepares' => $prepares() - $before]);
  `);
  assert.deepEqual(out.counts, [1, 2, 3, 4, 5]);
  assert.deepEqual(out.ids, [1, 2, 3, 4, 5]);
  assert.equal(out.changed, 3);
  // CREATE, INSERT, COUNT, UPDATE and ROW_COUNT: each once.
  assert.equal(out.prepares, 5);
});

test("after DDL a kept statement is prepared again and sees the new table shape", () => {
  const out = evaluate(`
    $db->run('CREATE TEMPORARY TABLE first_stmt_ddl (id INT PRIMARY KEY)');
    $db->run('INSERT INTO first_stmt_ddl (id) VALUES (?)', [1]);
    $before = array_keys($db->run('SELECT * FROM first_stmt_ddl WHERE id = ?', [1])[0]);
    $db->run("ALTER TABLE first_stmt_ddl ADD COLUMN extra VARCHAR(10) NOT NULL DEFAULT 'x'");
    $after = $db->run('SELECT * FROM first_stmt_ddl WHERE id = ?', [1])[0];
    echo json_encode(['before' => $before, 'after' => $after]);
  `);
  assert.deepEqual(out, { before: ["id"], after: { id: 1, extra: "x" } });
});

test("a reconnect prepares again on the new connection", () => {
  const out = evaluate(`
    $sql = 'SELECT option_value AS v FROM ' . $wpdb->options . ' WHERE option_name = ?';
    $first = $db->run($sql, ['siteurl'])[0]['v'];
    $wpdb->close();
    $wpdb->db_connect();
    $before = $prepares();
    $second = $db->run($sql, ['siteurl'])[0]['v'];
    echo json_encode(['same' => $first === $second, 'prepares' => $prepares() - $before]);
  `);
  assert.deepEqual(out, { same: true, prepares: 1 });
});

test("the statements kept are bounded, and a failed one is not kept", () => {
  const out = evaluate(`
    $open = static fn (): int => (int) $wpdb->get_row("SHOW GLOBAL STATUS LIKE 'Prepared_stmt_count'", ARRAY_N)[1];
    $start = $open();
    for ($i = 0; $i < 300; $i++) {
      $db->run("SELECT ? + $i AS n", [1]);
    }
    $held = $open() - $start;
    $failed = null;
    try {
      $db->run('SELECT no_such_column FROM ' . $wpdb->options . ' WHERE option_name = ?', ['x']);
    } catch (\\Throwable $e) {
      $failed = get_class($e);
    }
    echo json_encode(['held' => $held, 'failed' => $failed, 'after' => $open() - $start]);
  `);
  assert.ok(out.held > 0 && out.held <= 64, JSON.stringify(out));
  assert.equal(out.failed, "First\\Wp\\DbError");
  assert.equal(out.after, out.held);
});
