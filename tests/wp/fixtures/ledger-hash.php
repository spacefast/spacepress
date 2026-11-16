<?php
// `wp eval` fixture for plugin.test.ts: the migration ledger records the hash of each file it applies.
// The ledger starts as runtimes before the column wrote it (keyed, no `sql`), with the blog's rows. A
// second app's plan reads it without adding the column; its migrate adds the column, keeps the old rows
// with no hash, and records its own file's hash. Prints what it saw as JSON, then restores the ledger.
declare(strict_types=1);

$db = \TypedPress\Wp\Runtime::plugin()->connection();
$saved = $db->run('SELECT `app`, `id`, `applied_at` FROM wp_tp__migrations');
$columns = static fn (): array => array_column($db->run("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wp_tp__migrations' ORDER BY ORDINAL_POSITION"), 'c');
$dir = sys_get_temp_dir() . '/typedpress-hash-' . bin2hex(random_bytes(4));
mkdir($dir);
$sql = "CREATE TABLE `{prefix}tp_hashed_notes` (\n\t`id` BIGINT,\n\tPRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
file_put_contents("$dir/0001_init.sql", $sql);
$migrator = new \TypedPress\Wp\Migrator($db, $dir, new \TypedPress\Schema(['version' => 3, 'runtime' => \TypedPress\Wp\Runtime::SERIES, 'name' => 'hashed']));
$out = [];
try {
    $db->run('DROP TABLE wp_tp__migrations');
    $db->run('CREATE TABLE wp_tp__migrations (`app` VARCHAR(191) NOT NULL, `id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, PRIMARY KEY (`app`, `id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    foreach ($saved as $row) {
        $db->run('INSERT INTO wp_tp__migrations (`app`, `id`, `applied_at`) VALUES (?, ?, ?)', [$row['app'], $row['id'], $row['applied_at']]);
    }
    $out['plan'] = $migrator->plan();
    $out['afterPlan'] = $columns();
    $out['applied'] = $migrator->migrate();
    $out['afterMigrate'] = $columns();
    $out['ledger'] = $db->run('SELECT `app`, `id`, `sql` FROM wp_tp__migrations ORDER BY `app`, `id`');
    $out['hash'] = hash('sha256', $sql);
    $out['history'] = $migrator->history();
} finally {
    $db->run('DROP TABLE IF EXISTS wp_tp_hashed_notes');
    $db->run('DROP TABLE wp_tp__migrations');
    $db->run('CREATE TABLE wp_tp__migrations (`app` VARCHAR(191) NOT NULL, `id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, `sql` CHAR(64) NULL, PRIMARY KEY (`app`, `id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    foreach ($saved as $row) {
        $db->run('INSERT INTO wp_tp__migrations (`app`, `id`, `applied_at`) VALUES (?, ?, ?)', [$row['app'], $row['id'], $row['applied_at']]);
    }
    unlink("$dir/0001_init.sql");
    rmdir($dir);
}
echo wp_json_encode($out);
