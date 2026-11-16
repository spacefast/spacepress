// TypedPress\Wp\Connection on mysqli (MariaDB): a statement run again in the same request reuses its
// prepared statement, with each run's own parameters and rows; a reconnect starts over; the
// statements kept per request are bounded; a failed statement is not kept. Prepares are counted
// by the server (`Com_stmt_prepare` for this session), not guessed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wp } from "./env.ts";

function evaluate(php: string): any {
  return JSON.parse(wp("eval", `
    $db = \\TypedPress\\Wp\\Plugin::instance()->connection();
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
    $db->run('CREATE TEMPORARY TABLE tp_stmt_test (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(20))');
    $ids = [];
    $counts = [];
    for ($i = 0; $i < 5; $i++) {
      $db->run('INSERT INTO tp_stmt_test (v) VALUES (?)', ["v$i"]);
      $ids[] = $db->insertId();
      $counts[] = (int) $db->run('SELECT COUNT(*) AS n FROM tp_stmt_test')[0]['n'];
    }
    $db->run('UPDATE tp_stmt_test SET v = ? WHERE id > ?', ['x', 2]);
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
    $db->run('CREATE TEMPORARY TABLE tp_stmt_ddl (id INT PRIMARY KEY)');
    $db->run('INSERT INTO tp_stmt_ddl (id) VALUES (?)', [1]);
    $select = 'SELECT * FROM tp_stmt_ddl WHERE id = ?';
    $db->run($select, [1]);
    $kept = $prepares();
    $before = array_keys($db->run($select, [1])[0]);
    $kept = $prepares() - $kept;
    $db->run("ALTER TABLE tp_stmt_ddl ADD COLUMN extra VARCHAR(10) NOT NULL DEFAULT 'x'");
    $reprepares = static fn (): int => (int) $wpdb->get_row("SHOW SESSION STATUS LIKE 'Com_stmt_reprepare'", ARRAY_N)[1];
    [$at, $server] = [$prepares(), $reprepares()];
    $after = $db->run($select, [1])[0];
    echo json_encode(['kept' => $kept, 'before' => $before, 'after' => $after, 'prepared' => $prepares() - $at, 'serverReprepared' => $reprepares() - $server]);
  `);
  // Run again before the DDL: no prepare (it was kept). After the DDL the connection closed what it
  // kept and prepares the SELECT anew, so the server never runs a statement prepared on the old shape
  // (MariaDB re-prepares one itself, Com_stmt_reprepare; that is what this checks the runtime avoids).
  assert.deepEqual(out, { kept: 0, before: ["id"], after: { id: 1, extra: "x" }, prepared: 1, serverReprepared: 0 });
});

test("a reconnect discards the kept statement and prepares again on the new connection", () => {
  const out = evaluate(`
    $sql = 'SELECT option_value AS v FROM ' . $wpdb->options . ' WHERE option_name = ?';
    $first = $db->run($sql, ['siteurl'])[0]['v'];
    $at = $prepares();
    $db->run($sql, ['home']);
    $kept = $prepares() - $at;
    $wpdb->close();
    $wpdb->db_connect();
    // A new session: its own counter starts again.
    $before = $prepares();
    $second = $db->run($sql, ['siteurl'])[0]['v'];
    $third = $db->run($sql, ['siteurl'])[0]['v'];
    echo json_encode(['kept' => $kept, 'same' => $first === $second && $second === $third, 'prepares' => $prepares() - $before]);
  `);
  // Kept before the reconnect (0 prepares for the second run); prepared once on the new connection, then kept.
  assert.deepEqual(out, { kept: 0, same: true, prepares: 1 });
});

test("the statements kept are bounded", () => {
  const out = evaluate(`
    // Every distinct statement is prepared once; past 64 the least recently used are closed, so
    // running the first one again prepares it again, while the most recent is still kept.
    for ($i = 0; $i < 100; $i++) {
      $db->run("SELECT ? + $i AS n", [1]);
    }
    $at = $prepares();
    $db->run('SELECT ? + 99 AS n', [1]);
    $recent = $prepares() - $at;
    $at = $prepares();
    $db->run('SELECT ? + 0 AS n', [1]);
    $evicted = $prepares() - $at;
    echo json_encode(['recent' => $recent, 'evicted' => $evicted]);
  `);
  assert.deepEqual(out, { recent: 0, evicted: 1 });
});

test("a kept statement whose execute fails is closed, and the next run prepares it again", () => {
  const out = evaluate(`
    $db->run('CREATE TEMPORARY TABLE tp_stmt_fail (id INT PRIMARY KEY)');
    $insert = 'INSERT INTO tp_stmt_fail (id) VALUES (?)';
    $db->run($insert, [1]);
    $at = $prepares();
    $db->run($insert, [2]);
    $kept = $prepares() - $at;
    $failed = null;
    try {
      $db->run($insert, [2]); // a duplicate key: prepared already, fails at execute
    } catch (\\Throwable $e) {
      $failed = [get_class($e), $e->getCode()];
    }
    $at = $prepares();
    $db->run($insert, [3]);
    $after = $prepares() - $at;
    $rows = array_column($db->run('SELECT id FROM tp_stmt_fail ORDER BY id'), 'id');
    echo json_encode(['kept' => $kept, 'failed' => $failed, 'reprepared' => $after, 'rows' => $rows]);
  `);
  assert.deepEqual(out, { kept: 0, failed: ["TypedPress\\Wp\\DbError", 1062], reprepared: 1, rows: [1, 2, 3] });
});
