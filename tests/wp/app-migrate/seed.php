<?php
// DDL follows stattic-runtime-core/src/first.rs zero_db_migration_statements,
// scalar encodings follow first-compile/src/runtime-host.ts rowFromDb.
// Seed before activating either Zero plugin, as an existing Space would be.
declare(strict_types=1);
global $wpdb;
$table = 'sf_spc_migrate_test_tasks_3c47092ff0';
$sql = "CREATE TABLE `$table` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    createdAt TEXT NULL, updatedAt TEXT NULL,
    title TEXT NULL, done TEXT NULL, score DOUBLE NULL,
    note TEXT NULL, category TEXT NULL, owner TEXT NULL, parent TEXT NULL,
    PRIMARY KEY (id), KEY by_owner (owner(191), createdAt(191), id), KEY by_done (done(191), createdAt(191), id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
if ($wpdb->query($sql) === false) { WP_CLI::error($wpdb->last_error); }
foreach ([
    ['id' => 41, 'title' => 'Existing first', 'done' => 'false', 'score' => 2.5, 'note' => null, 'category' => 'inbox', 'owner' => 'legacy-user', 'parent' => null],
    ['id' => 42, 'title' => 'Existing second', 'done' => 'true', 'score' => 0, 'note' => 'kept', 'category' => 'archive', 'owner' => 'legacy-user', 'parent' => '41'],
    ['id' => 9007199254740900, 'title' => 'Other owner', 'done' => '0', 'score' => -0.5, 'note' => null, 'category' => null, 'owner' => 'someone-else', 'parent' => null],
] as $row) {
    $row += ['createdAt' => '2026-03-01T00:00:00.123Z', 'updatedAt' => '2026-03-01T00:00:00.123Z'];
    if ($wpdb->insert($table, $row) === false) { WP_CLI::error($wpdb->last_error); }
}
echo wp_json_encode([
    'rows' => $wpdb->get_results("SELECT * FROM `$table` ORDER BY id", ARRAY_A),
    'ddl' => $wpdb->get_row("SHOW CREATE TABLE `$table`", ARRAY_N)[1],
]);
