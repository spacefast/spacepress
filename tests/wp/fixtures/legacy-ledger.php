<?php
// `wp eval` fixture for plugin.test.ts: a ledger from before rows were keyed by app. An app named
// "legacy" whose history drops a column and adds it back holds data in that column. Converting the
// ledger must hand the old rows to their owner without replaying a single statement (a replayed
// DROP COLUMN would destroy the data), and must refuse when the owner is unclear.
// Prints {converted, refused} as JSON, then restores the blog's keyed ledger.
declare(strict_types=1);

$db = \Zero\Wp\Runtime::plugin()->connection();
$saved = $db->run('SELECT `app`, `id`, `applied_at` FROM wp_zero__migrations');
$dir = sys_get_temp_dir() . '/zero-legacy-' . bin2hex(random_bytes(4));
mkdir($dir);
file_put_contents("$dir/0001_init.sql", "CREATE TABLE `{prefix}zero_legacy_notes` (\n\t`id` BIGINT,\n\t`body` TEXT,\n\tPRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
file_put_contents("$dir/0002_update.sql", 'ALTER TABLE `{prefix}zero_legacy_notes` DROP COLUMN `body`;');
file_put_contents("$dir/0003_update.sql", 'ALTER TABLE `{prefix}zero_legacy_notes` ADD COLUMN `body` TEXT;');
$migrator = static fn (string $app) => new \Zero\Wp\Migrator($db, $dir, new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Wp\Runtime::SERIES, 'name' => $app]));

/** The site as an older runtime left it: unkeyed ledger, the legacy app's tables and data. */
$legacy = static function () use ($db): void {
    $db->run('DROP TABLE wp_zero__migrations');
    $db->run('CREATE TABLE wp_zero__migrations (`id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    foreach (['0001_init', '0002_update', '0003_update'] as $id) {
        $db->run('INSERT INTO wp_zero__migrations (`id`, `applied_at`) VALUES (?, ?)', [$id, '2026-01-01T00:00:00.000Z']);
    }
    $db->run('DROP TABLE IF EXISTS wp_zero_legacy_notes');
    $db->run('CREATE TABLE wp_zero_legacy_notes (`id` BIGINT PRIMARY KEY, `body` TEXT) ENGINE=InnoDB');
    $db->run("INSERT INTO wp_zero_legacy_notes (`id`, `body`) VALUES (1, 'kept')");
};

$schemaOptions = array_column($db->run("SELECT option_name FROM wp_options WHERE option_name LIKE 'zero\\_%\\_schema'"), 'option_name');
$hidden = [];
foreach ($schemaOptions as $name) {
    $hidden[$name] = get_option($name);
    delete_option($name);
}
try {
    // One recorded app: the old rows are its own, nothing replays, the data survives.
    $legacy();
    update_option('zero_legacy_schema', str_repeat('a', 64), false);
    $applied = $migrator('legacy')->migrate();
    $converted = [
        'applied' => $applied,
        'ledger' => array_map(static fn ($r) => $r['app'] . '/' . $r['id'], $db->run('SELECT `app`, `id` FROM wp_zero__migrations ORDER BY `id`')),
        'data' => $db->run('SELECT `body` FROM wp_zero_legacy_notes WHERE `id` = 1')[0]['body'] ?? null,
    ];

    // Two recorded apps (one named like the runtime's options, which must not hide it): whose
    // history is it? Refuse rather than guess, touching nothing.
    $legacy();
    update_option('zero_runtime-notes_schema', str_repeat('b', 64), false);
    try {
        $migrator('legacy')->migrate();
        $refused = 'converted';
    } catch (\RuntimeException $e) {
        $refused = [
            'unclear' => str_contains($e->getMessage(), 'owner is unclear (legacy, runtime-notes)') || str_contains($e->getMessage(), 'owner is unclear (runtime-notes, legacy)'),
            'keyed' => $migrator('legacy')->keyed(),
            'data' => $db->run('SELECT `body` FROM wp_zero_legacy_notes WHERE `id` = 1')[0]['body'] ?? null,
        ];
    }
} finally {
    delete_option('zero_legacy_schema');
    delete_option('zero_runtime-notes_schema');
    foreach ($hidden as $name => $value) {
        update_option($name, $value, false);
    }
    $db->run('DROP TABLE IF EXISTS wp_zero_legacy_notes');
    $db->run('DROP TABLE wp_zero__migrations');
    $db->run('CREATE TABLE wp_zero__migrations (`app` VARCHAR(191) NOT NULL, `id` VARCHAR(191) NOT NULL, `applied_at` CHAR(24) NOT NULL, PRIMARY KEY (`app`, `id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    foreach ($saved as $row) {
        $db->run('INSERT INTO wp_zero__migrations (`app`, `id`, `applied_at`) VALUES (?, ?, ?)', [$row['app'], $row['id'], $row['applied_at']]);
    }
    array_map('unlink', glob("$dir/*") ?: []);
    rmdir($dir);
}
echo wp_json_encode(['converted' => $converted, 'refused' => $refused]);
