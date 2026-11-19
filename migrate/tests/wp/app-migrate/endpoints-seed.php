<?php
// The endpoints fixture's 0.8 table, seeded before activation.
declare(strict_types=1);
global $wpdb;
$table = 'sf_spc_migrate_test_notes_' . substr(hash('sha256', "spc_migrate_test\0notes"), 0, 10);
$sql = "CREATE TABLE `$table` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    createdAt TEXT NULL, updatedAt TEXT NULL, body TEXT NULL, tag TEXT NULL,
    PRIMARY KEY (id), KEY by_tag (tag(191), createdAt(191), id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
if ($wpdb->query($sql) === false) { WP_CLI::error($wpdb->last_error); }
foreach ([[1, 'first', 'red'], [2, 'second', 'blue'], [3, 'third', 'red']] as [$id, $body, $tag]) {
    $at = "2026-03-01T00:0$id:00.000Z";
    if ($wpdb->insert($table, ['id' => $id, 'createdAt' => $at, 'updatedAt' => $at, 'body' => $body, 'tag' => $tag]) === false) {
        WP_CLI::error($wpdb->last_error);
    }
}
$marks = 'sf_spc_migrate_test_marks_' . substr(hash('sha256', "spc_migrate_test\0marks"), 0, 10);
$sql = "CREATE TABLE `$marks` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    createdAt TEXT NULL, updatedAt TEXT NULL, owner TEXT NULL, label TEXT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
if ($wpdb->query($sql) === false) { WP_CLI::error($wpdb->last_error); }
echo $table;
