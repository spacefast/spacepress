<?php
// Schema v3 on a fresh prefix: a concurrent migrator waits for the schema lock, the 16 tables are
// InnoDB, a rerun is a no-op that keeps data, and the live-session lookup honours expiry/suspension.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use TypedPress\Identity\{DB, Schema, Sessions, Security};

$connection = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
$connection->set_prefix('zim_' . bin2hex(random_bytes(4)) . '_');
$db = new DB($connection);
$tables = [];
try {
    $connection->query("CREATE TABLE {$connection->options} LIKE {$GLOBALS['wpdb']->options}");
    $database = $db->row('SELECT DATABASE() AS name');
    $lock = hash('sha256', ($database['name'] ?? '') . ':' . $db->prefix);
    $db->row('SELECT GET_LOCK(%s, 10) AS acquired', $lock);
    $process = proc_open(['php', __DIR__ . '/migration-worker.php'], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
    try {
        fwrite($pipes[0], $connection->prefix . "\n");
        fclose($pipes[0]);
        $workerId = (int) fgets($pipes[1]);
        $deadline = microtime(true) + 5;
        while ($connection->get_var($connection->prepare('SELECT STATE FROM information_schema.PROCESSLIST WHERE ID=%d', $workerId)) !== 'User lock') {
            if (microtime(true) >= $deadline) {
                throw new RuntimeException('Concurrent migration did not wait for schema ownership');
            }
        }
        check($connection->get_col($connection->prepare('SHOW TABLES LIKE %s', $connection->esc_like($db->prefix) . '%')) === [], 'a contending migrator creates nothing before it owns the schema lock');
    } finally {
        $db->row('SELECT RELEASE_LOCK(%s) AS released', $lock);
    }
    $output = trim(stream_get_contents($pipes[1]));
    $errors = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    check(proc_close($process) === 0 && $output === 'MIGRATED' && $errors === '', 'the waiting migrator completes after the lock is released');
    $db->insert('accounts', ['wp_user_id' => 123, 'created_at' => time()]);
    $token = Security::token();
    $session = ['id' => bin2hex(random_bytes(16)), 'wp_user_id' => 123, 'secret_hash' => Sessions::digest($token), 'csrf' => str_repeat('a', 64),
        'created_at' => time(), 'expires_at' => time() + 3600, 'verified_at' => time(), 'label' => 'Migration fixture'];
    $db->insert('sessions', $session);
    $sessions = new Sessions($db, new Security($db));
    Schema::migrate($db);
    $tables = $connection->get_col($connection->prepare('SHOW TABLES LIKE %s', $connection->esc_like($db->prefix) . '%'));
    check(count($tables) === 16 && $connection->last_error === '', 'sixteen identity tables, rerun clean');
    foreach ($tables as $table) {
        if ($connection->get_row($connection->prepare('SHOW TABLE STATUS WHERE Name=%s', $table), ARRAY_A)['Engine'] !== 'InnoDB') {
            throw new RuntimeException("$table is not transactional");
        }
    }
    echo "PASS every identity table is InnoDB\n";
    $columns = array_column($connection->get_results("SHOW COLUMNS FROM {$db->prefix}tokens", ARRAY_A), 'Type', 'Field');
    check(($columns['kind'] ?? null) === "enum('access','refresh')" && isset($columns['family'], $columns['replaced_by'], $columns['used_at']), 'v3 tokens carry kind, family, replaced_by and used_at');
    $sessionColumns = array_column($connection->get_results("SHOW COLUMNS FROM {$db->prefix}sessions", ARRAY_A), 'Type', 'Field');
    check(($sessionColumns['wp_token'] ?? null) === 'char(64)', 'v4 sessions carry the WordPress session they came from (wp_token)');
    check(($sessionColumns['previous_secret_hash'] ?? null) === 'char(64)' && isset($sessionColumns['previous_until']), 'v4 sessions keep a reopened secret for a short grace (previous_secret_hash, previous_until)');
    check($connection->get_var("SELECT option_value FROM {$connection->options} WHERE option_name='tp_identity_schema_version'") === '4', 'schema version 4 recorded on the migrated prefix');
    check(($sessions->find($token)['id'] ?? null) === $session['id'], 'a rerun keeps existing sessions live');
    // Storage another schema version wrote is refused untouched, and the refusal says what to do.
    $connection->update($connection->options, ['option_value' => '3'], ['option_name' => 'tp_identity_schema_version']);
    $refusal = null;
    try {
        Schema::migrate($db);
    } catch (\TypedPress\Identity\Failure $failure) {
        $refusal = $failure;
    }
    $connection->update($connection->options, ['option_value' => '4'], ['option_name' => 'tp_identity_schema_version']);
    check($refusal !== null && $refusal->status === 503 && str_contains($refusal->getMessage(), 'is schema version 3 and this build reads only version 4')
        && str_contains($refusal->getMessage(), 'tp_identity_schema_version') && str_contains($refusal->getMessage(), 'tp_identity_* tables'), 'storage of another schema version is refused with the two ways out');
    check(($sessions->find($token)['id'] ?? null) === $session['id'], 'the refusal changes nothing');
    $db->run("UPDATE {$db->prefix}sessions SET expires_at=%d WHERE id=%s", time(), $session['id']);
    check($sessions->find($token) === null, 'session lookup honours expiry');
    $db->run("UPDATE {$db->prefix}sessions SET expires_at=%d WHERE id=%s", time() + 3600, $session['id']);
    $db->run("UPDATE {$db->prefix}sessions SET revoked_at=%d WHERE id=%s", time(), $session['id']);
    check($sessions->find($token) === null, 'session lookup honours revocation');
    $db->run("UPDATE {$db->prefix}sessions SET revoked_at=NULL WHERE id=%s", $session['id']);
    check($sessions->find('') === null && $sessions->find(str_repeat('a', 513)) === null, 'session lookup refuses empty and oversized secrets');
    $db->run("UPDATE {$db->prefix}accounts SET status='suspended' WHERE wp_user_id=123");
    check($sessions->find($token) === null, 'session lookup honours suspension');
} finally {
    foreach ($tables as $table) {
        $connection->query("DROP TABLE `$table`");
    }
    $connection->query("DROP TABLE IF EXISTS `{$connection->options}`");
}
