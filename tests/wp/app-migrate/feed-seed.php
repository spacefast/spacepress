<?php
// The feed fixture's 0.8 table, seeded before the migrated plugin is activated. Ties on
// createdAt and score exercise every keyset branch the 0.8 runner generated.
declare(strict_types=1);
global $wpdb;
$table = 'sf_spc_migrate_test_posts_' . substr(hash('sha256', "spc_migrate_test\0posts"), 0, 10);
$sql = "CREATE TABLE `$table` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    createdAt TEXT NULL, updatedAt TEXT NULL,
    channel TEXT NULL, body TEXT NULL, score DOUBLE NULL,
    PRIMARY KEY (id), KEY by_channel (channel(191), score, createdAt(191), id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
if ($wpdb->query($sql) === false) { WP_CLI::error($wpdb->last_error); }
$rows = [];
foreach ([[1, 'a', 3, '01'], [2, 'a', 1, '02'], [3, 'b', 9, '02'], [4, 'a', 1, '02'], [5, 'a', 2, '03'], [6, 'a', 1, '01'], [7, 'b', 0, '04']] as [$id, $channel, $score, $minute]) {
    $at = "2026-03-01T00:$minute:00.000Z";
    $rows[] = ['id' => $id, 'createdAt' => $at, 'updatedAt' => $at, 'channel' => $channel, 'body' => "post $id", 'score' => $score];
}
foreach ($rows as $row) {
    if ($wpdb->insert($table, $row) === false) { WP_CLI::error($wpdb->last_error); }
}
echo $table;
