<?php
// `wp eval` fixture for plugin.test.ts. Statement 1 of a migration committed (MySQL DDL can't roll
// back) but its progress marker was lost. The migrator must keep failing on it rather than guess the
// existing table is right, refuse to mark anything but the next pending step, and resume after the
// operator marks it. Prints the outcome of each step as JSON, then cleans up.
declare(strict_types=1);

$plugin = \TypedPress\Wp\Runtime::plugin();
$db = $plugin->connection();
$dir = sys_get_temp_dir() . '/typedpress-resume-' . bin2hex(random_bytes(4));
$id = '20990101000000_probe1_resume';
mkdir("$dir/$id", 0777, true);
file_put_contents("$dir/$id/migration.sql", implode("\n--> statement-breakpoint\n", [
    "CREATE TABLE `{prefix}resume_a` (\n\t`id` BIGINT NOT NULL,\n\tPRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    'ALTER TABLE `{prefix}resume_a` ADD COLUMN `n` INT;',
]));
$migrator = new \TypedPress\Wp\Migrator($db, $dir, $plugin->schema);
$attempt = static function (callable $fn): string {
    try {
        $fn();
        return 'ok';
    } catch (\RuntimeException|\TypedPress\HttpError $e) {
        return $e->getMessage();
    }
};
$out = [];
try {
    // The lost attempt: statement 1's table exists, no marker says so.
    $db->run('CREATE TABLE wp_resume_a (`id` BIGINT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $out['retry'] = str_contains($attempt(fn () => $migrator->migrate()), 'failed at statement 1') ? 'still failing' : 'resumed on its own';
    $out['markWrongStep'] = str_contains($attempt(fn () => $migrator->markApplied("$id:2")), "next pending statement of $id is 1 of 2") ? 'refused' : 'accepted';
    $out['markOtherFile'] = str_contains($attempt(fn () => $migrator->markApplied('20990101000000_probe1_missing:1')), 'not a pending migration') ? 'refused' : 'accepted';
    $out['markPathAlias'] = str_contains($attempt(fn () => $migrator->markApplied('../' . basename($dir) . "/$id:1")), 'not a pending migration') ? 'refused' : 'accepted';
    $out['mark'] = $attempt(fn () => $migrator->markApplied("$id:1"));
    $out['resume'] = $attempt(fn () => $migrator->migrate());
    $out['columns'] = array_column($db->run("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_resume_a' ORDER BY ORDINAL_POSITION"), 'c');
    $out['ledger'] = array_column($db->run("SELECT id FROM wp_tp__migrations WHERE app = ? AND SUBSTRING_INDEX(id, ':', 1) = ? ORDER BY id", [$plugin->schema->name(), $id]), 'id');
} finally {
    $db->run("DELETE FROM wp_tp__migrations WHERE app = ? AND SUBSTRING_INDEX(id, ':', 1) = ?", [$plugin->schema->name(), $id]);
    $db->run('DROP TABLE IF EXISTS wp_resume_a');
    unlink("$dir/$id/migration.sql");
    rmdir("$dir/$id");
    rmdir($dir);
}
echo wp_json_encode($out);
