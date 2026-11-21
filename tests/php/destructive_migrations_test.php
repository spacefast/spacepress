<?php

declare(strict_types=1);

/*
 * Slice 4 end-to-end verification of `@typedpress/destructive-migrations` (`DestructiveMigrations` +
 * `MigrationProvider` registry + CLI-only guard + two-phase retirement prerequisite + exact row-count
 * confirmation + JSONL archival + `tp__migrations` audit rows + `raw-sql` opt-in guard).
 */

use TypedPress\Wp\DestructiveMigrations;
use TypedPress\Wp\Migrator;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = [
    'name' => 'danger_site',
    'migrationProviders' => [
        'destructive-migrations' => [
            'id' => 'destructive-migrations',
            'cliOnly' => true,
            'requireArchive' => true,
            'allowRawSql' => false,
        ],
    ],
    'collections' => [
        'items' => [
            'key' => 'items', 'label' => 'Items', 'editor' => false, 'drafts' => false,
            'revisions' => true, 'softDelete' => true, 'table' => 'tp_items', 'primaryKey' => 'id',
            'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone'], 'restore' => ['role' => 'anyone'], 'purge' => ['role' => 'anyone']],
            'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'author' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'readOnly' => true, 'system' => true],
                'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true], 'readOnly' => true, 'system' => true],
                'deletedAt' => ['type' => 'timestamp', 'readOnly' => true, 'system' => true],
                'deletedBy' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                'deletedGroup' => ['type' => 'text', 'rules' => ['max' => 36], 'hidden' => true, 'readOnly' => true, 'system' => true],
                '_live' => ['type' => 'boolean', 'default' => ['value' => true], 'hidden' => true, 'readOnly' => true, 'system' => true],
            ],
            'relations' => [], 'hooks' => [],
        ],
    ],
];

$wp = wpSite('danger', ['schema' => $schema]);
$plugin = $wp->plugin();
$conn = $wp->connection();

// 1. Provider registration in Migrator
check('destructive-migrations provider registered automatically when opted in', isset(Migrator::providers()['destructive-migrations']));
eq('provider reports cliOnly = true', Migrator::providers()['destructive-migrations']->cliOnly(), true);

// 2. CLI-only guard: refused when not in WP_CLI context
problem('refused outside CLI context (HTTP / activation guard)',
    static fn () => DestructiveMigrations::status($plugin, null, cliContext: false), 403, 'cli_only');

// 3. Opt-in guard: a plugin without migrationProviders refuses every danger command
$disabledPlugin = (new ReflectionClass(\TypedPress\Wp\Plugin::class))->newInstanceWithoutConstructor();
$disabledSchema = $schema;
unset($disabledSchema['migrationProviders']);
(function () use ($disabledSchema, $plugin) {
    $this->schema = new \TypedPress\Schema($disabledSchema);
    $this->dir = $plugin->dir;
})->call($disabledPlugin);
problem('refused when @typedpress/destructive-migrations is not opted into',
    static fn () => DestructiveMigrations::status($disabledPlugin, null, cliContext: true), 403, 'destructive_migrations_disabled');

// 4. Prepare physical retired column & retired table + folder migrations (`ops.json`)
$conn->run('ALTER TABLE `wp_tp_items` ADD COLUMN `legacy_note` LONGTEXT NULL');
$conn->run('CREATE TABLE `wp_tp_old_archive` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `payload` LONGTEXT NOT NULL) ENGINE=InnoDB');
$conn->run("INSERT INTO `wp_tp_old_archive` (`payload`) VALUES ('row-a'), ('row-b')");

$db = $plugin->db();
$i1 = $db->insert('items', ['title' => 'Keep me'], true)[0];
$i2 = $db->insert('items', ['title' => 'Soft delete me'], true)[0];
$conn->run("UPDATE `wp_tp_items` SET `legacy_note` = 'old-1' WHERE `id` = ?", [$i1['id']]);
$conn->run("UPDATE `wp_tp_items` SET `legacy_note` = 'old-2' WHERE `id` = ?", [$i2['id']]);
$db->delete('items', ['id' => $i2['id']], true);

$migDir = sys_get_temp_dir() . '/typedpress-danger-migs-' . getmypid();
$mkdir = static function (string $id, array $ops) use ($migDir): void {
    @mkdir("$migDir/$id", 0777, true);
    file_put_contents("$migDir/$id/ops.json", json_encode(['version' => 1, 'id' => $id, 'ops' => $ops]));
    file_put_contents("$migDir/$id/migration.sql", "-- $id\n");
};
$mkdir('20261121180000_aaaaaa_init', [
    ['op' => 'createTable', 'table' => 'items', 'def' => ['editor' => false, 'drafts' => false, 'columns' => []]],
    ['op' => 'createTable', 'table' => 'old_archive', 'def' => ['editor' => false, 'drafts' => false, 'columns' => []]],
]);
$mkdir('20261121180001_bbbbbb_retire', [
    ['op' => 'retireColumn', 'table' => 'items', 'column' => 'legacy_note', 'was' => ['type' => 'text']],
    ['op' => 'retireTable', 'table' => 'old_archive'],
]);

// 5. Status reports retired column (2 non-null values) and retired table (2 rows)
$st = DestructiveMigrations::status($plugin, $migDir, cliContext: true);
eq('status lists retired column with live non-null count', [$st['retiredColumns'][0]['column'], $st['retiredColumns'][0]['nonNullRows']], ['legacy_note', 2]);
eq('status lists retired table with live row count', [$st['retiredTables'][0]['table'], $st['retiredTables'][0]['rows']], ['old_archive', 2]);

// 6. Two-phase retirement prerequisite: active column/table cannot be dropped
problem('active column cannot be dropped without prior retirement',
    static fn () => DestructiveMigrations::dropColumn($plugin, 'items', 'title', ['confirmRows' => 2, 'reason' => 'bad'], $migDir, cliContext: true),
    409, 'not_retired');
problem('active table cannot be dropped without prior retirement',
    static fn () => DestructiveMigrations::dropTable($plugin, 'items', ['confirmRows' => 2, 'reason' => 'bad'], $migDir, cliContext: true),
    409, 'not_retired');

// 7. Confirmation mismatch, missing reason, and requireArchive enforcement
problem('wrong --confirm-rows is refused with confirmation_mismatch',
    static fn () => DestructiveMigrations::dropColumn($plugin, 'items', 'legacy_note', ['confirmRows' => 999, 'reason' => 'cleanup'], $migDir, cliContext: true),
    409, 'confirmation_mismatch');
problem('missing --reason is refused',
    static fn () => DestructiveMigrations::dropColumn($plugin, 'items', 'legacy_note', ['confirmRows' => 2], $migDir, cliContext: true),
    422, 'invalid_input', '/reason');
problem('missing --archive-to is refused when requireArchive is true',
    static fn () => DestructiveMigrations::dropColumn($plugin, 'items', 'legacy_note', ['confirmRows' => 2, 'reason' => 'cleanup'], $migDir, cliContext: true),
    422, 'archive_required');

// 8. --dry-run returns exact plan and live count without mutating database
$dry = DestructiveMigrations::dropColumn($plugin, 'items', 'legacy_note', ['dryRun' => true], $migDir, cliContext: true);
eq('dry-run reports live count and exact confirm flag without executing', [$dry['dryRun'], $dry['nonNullRows'], $dry['confirmFlag']], [true, 2, '--confirm-rows=2']);

// 9. drop-column with exact confirmation + --archive-to exports JSONL, drops column, and writes destructive audit row
$colArchive = sys_get_temp_dir() . '/typedpress-danger-col-' . getmypid() . '.jsonl';
$resCol = DestructiveMigrations::dropColumn($plugin, 'items', 'legacy_note', [
    'confirmRows' => 2,
    'reason' => 'Retired 90 days ago',
    'archiveTo' => $colArchive,
    'actor' => 'ops@example.test',
], $migDir, cliContext: true);
eq('drop-column archives 2 rows and executes DROP COLUMN', [$resCol['rowsAffected'], $resCol['archived']['rows']], [2, 2]);
$colLines = file($colArchive, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
eq('archived JSONL contains both non-null rows', count($colLines), 2);
$colsAfter = array_column($conn->run('SHOW COLUMNS FROM `wp_tp_items`'), 'Field');
check('legacy_note column is physically gone after drop-column', !in_array('legacy_note', $colsAfter, true), $colsAfter);

// 10. drop-table with exact confirmation + --archive-to exports JSONL, drops table, and audits
$tblArchive = sys_get_temp_dir() . '/typedpress-danger-tbl-' . getmypid() . '.jsonl';
$resTbl = DestructiveMigrations::dropTable($plugin, 'old_archive', [
    'confirmRows' => 2,
    'reason' => 'Legacy archive sunset',
    'archiveTo' => $tblArchive,
    'actor' => 'ops@example.test',
], $migDir, cliContext: true);
eq('drop-table archives 2 rows and drops table', [$resTbl['rowsAffected'], $resTbl['archived']['rows']], [2, 2]);
eq('archived table JSONL has 2 rows', count(file($tblArchive, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)), 2);
eq('old_archive table is physically gone', $conn->run('SHOW TABLES LIKE ?', ['wp_tp_old_archive']), []);

// 11. purge-deleted permanently purges soft-deleted rows with archive & audit
$purgeArchive = sys_get_temp_dir() . '/typedpress-danger-purge-' . getmypid() . '.jsonl';
$resPurge = DestructiveMigrations::purgeDeleted($plugin, 'items', [
    'confirmRows' => 1,
    'reason' => 'GDPR erasure',
    'archiveTo' => $purgeArchive,
    'actor' => 'ops@example.test',
], cliContext: true);
eq('purge-deleted archives and permanently purges 1 soft-deleted row', [$resPurge['rowsAffected'], $resPurge['archived']['rows']], [1, 1]);
eq('soft-deleted row is gone while active row remains', [count($db->findMany('items', ['deleted' => 'only'])), count($db->findMany('items'))], [0, 1]);

// 12. raw-sql is refused while allowRawSql = false
problem('raw-sql is refused when allowRawSql is false',
    static fn () => DestructiveMigrations::rawSql($plugin, 'DELETE FROM `{prefix}tp_items` WHERE 1 = 0', ['reason' => 'nope'], cliContext: true),
    403, 'raw_sql_disabled');

// 13. Audit rows recorded in tp__migrations with kind = 'destructive', actor, reason, rows_affected
$audit = $conn->run("SELECT `kind`, `actor`, `reason`, `rows_affected`, `sql` FROM `wp_tp__migrations` WHERE `app` = 'danger_site' AND `kind` = 'destructive' ORDER BY `reason` ASC");
eq('all 3 destructive operations wrote audit rows to tp__migrations', count($audit), 3);
eq('audit rows capture actor, reason, rows_affected, and sql hash',
    array_map(static fn (array $r) => [$r['kind'], $r['actor'], $r['reason'], (int) $r['rows_affected'], strlen((string) $r['sql'])], $audit),
    [
        ['destructive', 'ops@example.test', 'GDPR erasure', 1, 64],
        ['destructive', 'ops@example.test', 'Legacy archive sunset', 2, 64],
        ['destructive', 'ops@example.test', 'Retired 90 days ago', 2, 64],
    ]);

// 14. When allowRawSql is true, raw-sql executes and writes a destructive audit row
$rawSchema = $schema;
$rawSchema['migrationProviders']['destructive-migrations']['allowRawSql'] = true;
$rawPlugin = (new ReflectionClass(\TypedPress\Wp\Plugin::class))->newInstanceWithoutConstructor();
(function () use ($rawSchema, $plugin) {
    $this->schema = new \TypedPress\Schema($rawSchema);
    $this->dir = $plugin->dir;
})->call($rawPlugin);
$rawRes = DestructiveMigrations::rawSql($rawPlugin, 'DELETE FROM `{prefix}tp_items` WHERE 1 = 0', ['reason' => 'No-op raw SQL test', 'actor' => 'dba@example.test', 'confirmRows' => 0], cliContext: true);
eq('raw-sql executes and audits when allowRawSql is enabled', [$rawRes['kind'], $rawRes['operation']], ['destructive', 'raw-sql']);

// 15. WP-CLI dispatcher (`wp typedpress danger status`) works cleanly
[$code, $json] = DestructiveMigrations::wpCli($plugin, ['status'], ['migrations-dir' => $migDir], cliContext: true);
$decoded = json_decode($json, true);
eq('wpCli danger status returns exit 0 and lists all 4 audit rows', [$code, count($decoded['data']['audit'] ?? [])], [0, 4]);

// Cleanup temp files
@unlink($colArchive);
@unlink($tblArchive);
@unlink($purgeArchive);
foreach (glob("$migDir/*/*") ?: [] as $f) {
    @unlink($f);
}
foreach (glob("$migDir/*") ?: [] as $d) {
    @rmdir($d);
}
@rmdir($migDir);

finish('destructive_migrations');
