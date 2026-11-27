<?php

declare(strict_types=1);

/*
 * Slice 4 end-to-end verification of `spacepress/danger` (`DestructiveMigrations` +
 * `MigrationProvider` registry + CLI-only guard + two-phase retirement prerequisite + exact row-count
 * confirmation + JSONL archival + `sp__migrations` audit rows + `raw-sql` opt-in guard).
 */

use SpacePress\Wp\DestructiveMigrations;
use SpacePress\Wp\Migrator;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = array(
	'name'               => 'danger_site',
	'migrationProviders' => array(
		'destructive-migrations' => array(
			'id'             => 'destructive-migrations',
			'cliOnly'        => true,
			'requireArchive' => true,
			'allowRawSql'    => false,
		),
	),
	'collections'        => array(
		'items' => array(
			'key'        => 'items',
			'label'      => 'Items',
			'editor'     => false,
			'drafts'     => false,
			'revisions'  => true,
			'softDelete' => true,
			'table'      => 'sp_items',
			'primaryKey' => 'id',
			'access'     => array(
				'read'    => array( 'role' => 'anyone' ),
				'create'  => array( 'role' => 'anyone' ),
				'update'  => array( 'role' => 'anyone' ),
				'delete'  => array( 'role' => 'anyone' ),
				'restore' => array( 'role' => 'anyone' ),
				'purge'   => array( 'role' => 'anyone' ),
			),
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
			'columns'    => array(
				'id'           => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'title'        => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'author'       => array(
					'type'     => 'integer',
					'readOnly' => true,
					'system'   => true,
				),
				'createdAt'    => array(
					'type'     => 'timestamp',
					'notNull'  => true,
					'default'  => array( 'now' => true ),
					'readOnly' => true,
					'system'   => true,
				),
				'updatedAt'    => array(
					'type'     => 'timestamp',
					'notNull'  => true,
					'default'  => array( 'now' => true ),
					'onUpdate' => array( 'now' => true ),
					'readOnly' => true,
					'system'   => true,
				),
				'deletedAt'    => array(
					'type'     => 'timestamp',
					'readOnly' => true,
					'system'   => true,
				),
				'deletedBy'    => array(
					'type'     => 'integer',
					'readOnly' => true,
					'system'   => true,
				),
				'deletedGroup' => array(
					'type'     => 'text',
					'rules'    => array( 'max' => 36 ),
					'hidden'   => true,
					'readOnly' => true,
					'system'   => true,
				),
				'_live'        => array(
					'type'     => 'boolean',
					'default'  => array( 'value' => true ),
					'hidden'   => true,
					'readOnly' => true,
					'system'   => true,
				),
			),
			'relations'  => array(),
			'hooks'      => array(),
		),
	),
);

$wp     = wpSite( 'danger', array( 'schema' => $schema ) );
$plugin = $wp->plugin();
$conn   = $wp->connection();

// 1. Provider registration in Migrator
check( 'destructive-migrations provider registered automatically when opted in', isset( Migrator::providers()['destructive-migrations'] ) );
eq( 'provider reports cliOnly = true', Migrator::providers()['destructive-migrations']->cliOnly(), true );

// 2. CLI-only guard: refused when not in WP_CLI context
problem(
	'refused outside CLI context (HTTP / activation guard)',
	static fn () => DestructiveMigrations::status( $plugin, null, cliContext: false ),
	403,
	'cli_only'
);

// 3. Opt-in guard: a plugin without migrationProviders refuses every danger command
$disabled_plugin = ( new ReflectionClass( \SpacePress\Wp\Plugin::class ) )->newInstanceWithoutConstructor();
$disabled_schema = $schema;
unset( $disabled_schema['migrationProviders'] );
( function () use ( $disabled_schema, $plugin ) {
	$this->schema = new \SpacePress\Schema( $disabled_schema );
	$this->dir    = $plugin->dir;
} )->call( $disabled_plugin );
problem(
	'refused when spacepress/danger is not opted into',
	static fn () => DestructiveMigrations::status( $disabled_plugin, null, cliContext: true ),
	403,
	'destructive_migrations_disabled'
);

// 4. Prepare physical retired column & retired table + folder migrations (`ops.json`)
$conn->run( 'ALTER TABLE `wp_sp_items` ADD COLUMN `legacy_note` LONGTEXT NULL' );
$conn->run( 'CREATE TABLE `wp_sp_old_archive` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `payload` LONGTEXT NOT NULL) ENGINE=InnoDB' );
$conn->run( "INSERT INTO `wp_sp_old_archive` (`payload`) VALUES ('row-a'), ('row-b')" );

$db = $plugin->db();
$i1 = $db->insert( 'items', array( 'title' => 'Keep me' ), true )[0];
$i2 = $db->insert( 'items', array( 'title' => 'Soft delete me' ), true )[0];
$conn->run( "UPDATE `wp_sp_items` SET `legacy_note` = 'old-1' WHERE `id` = ?", array( $i1['id'] ) );
$conn->run( "UPDATE `wp_sp_items` SET `legacy_note` = 'old-2' WHERE `id` = ?", array( $i2['id'] ) );
$db->delete( 'items', array( 'id' => $i2['id'] ), true );

$mig_dir = sys_get_temp_dir() . '/spacepress-danger-migs-' . getmypid();
$mkdir   = static function ( string $id, array $ops ) use ( $mig_dir ): void {
	@mkdir( "$mig_dir/$id", 0777, true );
	file_put_contents(
		"$mig_dir/$id/ops.json",
		json_encode(
			array(
				'version' => 1,
				'id'      => $id,
				'ops'     => $ops,
			)
		)
	);
	file_put_contents( "$mig_dir/$id/migration.sql", "-- $id\n" );
};
$mkdir(
	'20261121180000_aaaaaa_init',
	array(
		array(
			'op'    => 'createTable',
			'table' => 'items',
			'def'   => array(
				'editor'  => false,
				'drafts'  => false,
				'columns' => array(),
			),
		),
		array(
			'op'    => 'createTable',
			'table' => 'old_archive',
			'def'   => array(
				'editor'  => false,
				'drafts'  => false,
				'columns' => array(),
			),
		),
	)
);
$mkdir(
	'20261121180001_bbbbbb_retire',
	array(
		array(
			'op'     => 'retireColumn',
			'table'  => 'items',
			'column' => 'legacy_note',
			'was'    => array( 'type' => 'text' ),
		),
		array(
			'op'    => 'retireTable',
			'table' => 'old_archive',
		),
	)
);

// 4b. Unapplied retirement migration is refused until `wp spacepress migrate` applies it
problem(
	'unapplied retirement migration is refused before migrate applies it',
	static fn () => DestructiveMigrations::dropColumn(
		$plugin,
		'items',
		'legacy_note',
		array(
			'confirmRows' => 2,
			'reason'      => 'too early',
			'archiveTo'   => sys_get_temp_dir() . '/nope-' . getmypid() . '.jsonl',
		),
		$mig_dir,
		cliContext: true
	),
	409,
	'retirement_not_applied'
);

// Record the retirement migration as applied in sp__migrations
$ledger = Migrator::ensureLedger( $conn, $plugin->schema );
$conn->run( "INSERT INTO `$ledger` (`app`, `id`, `kind`, `applied_at`) VALUES (?, ?, 'schema', ?)", array( 'danger_site', '20261121180001_bbbbbb_retire', '2026-11-21T18:00:01.000Z' ) );

// 5. Status reports retired column (2 non-null values) and retired table (2 rows)
$st = DestructiveMigrations::status( $plugin, $mig_dir, cliContext: true );
eq( 'status lists retired column with live non-null count', array( $st['retiredColumns'][0]['column'], $st['retiredColumns'][0]['nonNullRows'] ), array( 'legacy_note', 2 ) );
eq( 'status lists retired table with live row count', array( $st['retiredTables'][0]['table'], $st['retiredTables'][0]['rows'] ), array( 'old_archive', 2 ) );

// 6. Two-phase retirement prerequisite: active column/table cannot be dropped
problem(
	'active column cannot be dropped without prior retirement',
	static fn () => DestructiveMigrations::dropColumn(
		$plugin,
		'items',
		'title',
		array(
			'confirmRows' => 2,
			'reason'      => 'bad',
		),
		$mig_dir,
		cliContext: true
	),
	409,
	'not_retired'
);
problem(
	'active table cannot be dropped without prior retirement',
	static fn () => DestructiveMigrations::dropTable(
		$plugin,
		'items',
		array(
			'confirmRows' => 2,
			'reason'      => 'bad',
		),
		$mig_dir,
		cliContext: true
	),
	409,
	'not_retired'
);

// 7. Confirmation mismatch, missing reason, and requireArchive enforcement
problem(
	'wrong --confirm-rows is refused with confirmation_mismatch',
	static fn () => DestructiveMigrations::dropColumn(
		$plugin,
		'items',
		'legacy_note',
		array(
			'confirmRows' => 999,
			'reason'      => 'cleanup',
		),
		$mig_dir,
		cliContext: true
	),
	409,
	'confirmation_mismatch'
);
problem(
	'missing --reason is refused',
	static fn () => DestructiveMigrations::dropColumn( $plugin, 'items', 'legacy_note', array( 'confirmRows' => 2 ), $mig_dir, cliContext: true ),
	422,
	'invalid_input',
	'/reason'
);
problem(
	'missing --archive-to is refused when requireArchive is true',
	static fn () => DestructiveMigrations::dropColumn(
		$plugin,
		'items',
		'legacy_note',
		array(
			'confirmRows' => 2,
			'reason'      => 'cleanup',
		),
		$mig_dir,
		cliContext: true
	),
	422,
	'archive_required'
);

// 8. --dry-run returns exact plan and live count without mutating database
$dry = DestructiveMigrations::dropColumn( $plugin, 'items', 'legacy_note', array( 'dryRun' => true ), $mig_dir, cliContext: true );
eq( 'dry-run reports live count and exact confirm flag without executing', array( $dry['dryRun'], $dry['nonNullRows'], $dry['confirmFlag'] ), array( true, 2, '--confirm-rows=2' ) );

// 9. drop-column with exact confirmation + --archive-to exports JSONL, drops column, and writes destructive audit row
$col_archive = sys_get_temp_dir() . '/spacepress-danger-col-' . getmypid() . '.jsonl';
$res_col     = DestructiveMigrations::dropColumn(
	$plugin,
	'items',
	'legacy_note',
	array(
		'confirmRows' => 2,
		'reason'      => 'Retired 90 days ago',
		'archiveTo'   => $col_archive,
		'actor'       => 'ops@example.test',
	),
	$mig_dir,
	cliContext: true
);
eq( 'drop-column archives 2 rows and executes DROP COLUMN', array( $res_col['rowsAffected'], $res_col['archived']['rows'] ), array( 2, 2 ) );
$col_lines = file( $col_archive, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES );
eq( 'archived JSONL contains both non-null rows', count( $col_lines ), 2 );
$cols_after = array_column( $conn->run( 'SHOW COLUMNS FROM `wp_sp_items`' ), 'Field' );
check( 'legacy_note column is physically gone after drop-column', ! in_array( 'legacy_note', $cols_after, true ), $cols_after );

// 10. drop-table with exact confirmation + --archive-to exports JSONL, drops table, and audits
$tbl_archive = sys_get_temp_dir() . '/spacepress-danger-tbl-' . getmypid() . '.jsonl';
$res_tbl     = DestructiveMigrations::dropTable(
	$plugin,
	'old_archive',
	array(
		'confirmRows' => 2,
		'reason'      => 'Legacy archive sunset',
		'archiveTo'   => $tbl_archive,
		'actor'       => 'ops@example.test',
	),
	$mig_dir,
	cliContext: true
);
eq( 'drop-table archives 2 rows and drops table', array( $res_tbl['rowsAffected'], $res_tbl['archived']['rows'] ), array( 2, 2 ) );
eq( 'archived table JSONL has 2 rows', count( file( $tbl_archive, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) ), 2 );
eq( 'old_archive table is physically gone', $conn->run( 'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', array( 'wp_sp_old_archive' ) ), array() );

// 11. purge-deleted permanently purges soft-deleted rows with archive & audit
$purge_archive = sys_get_temp_dir() . '/spacepress-danger-purge-' . getmypid() . '.jsonl';
$res_purge     = DestructiveMigrations::purgeDeleted(
	$plugin,
	'items',
	array(
		'confirmRows' => 1,
		'reason'      => 'GDPR erasure',
		'archiveTo'   => $purge_archive,
		'actor'       => 'ops@example.test',
	),
	cliContext: true
);
eq( 'purge-deleted archives and permanently purges 1 soft-deleted row', array( $res_purge['rowsAffected'], $res_purge['archived']['rows'] ), array( 1, 1 ) );
eq( 'soft-deleted row is gone while active row remains', array( count( $db->findMany( 'items', array( 'deleted' => 'only' ) ) ), count( $db->findMany( 'items' ) ) ), array( 0, 1 ) );

// 12. raw-sql is refused while allowRawSql = false
problem(
	'raw-sql is refused when allowRawSql is false',
	static fn () => DestructiveMigrations::rawSql( $plugin, 'DELETE FROM `{prefix}sp_items` WHERE 1 = 0', array( 'reason' => 'nope' ), cliContext: true ),
	403,
	'raw_sql_disabled'
);

// 13. Audit rows recorded in sp__migrations with kind = 'destructive', actor, reason, rows_affected
$audit = $conn->run( "SELECT `kind`, `actor`, `reason`, `rows_affected`, `sql` FROM `wp_sp__migrations` WHERE `app` = 'danger_site' AND `kind` = 'destructive' ORDER BY `reason` ASC" );
eq( 'all 3 destructive operations wrote audit rows to sp__migrations', count( $audit ), 3 );
eq(
	'audit rows capture actor, reason, rows_affected, and sql hash',
	array_map( static fn ( array $r ) => array( $r['kind'], $r['actor'], $r['reason'], (int) $r['rows_affected'], strlen( (string) $r['sql'] ) ), $audit ),
	array(
		array( 'destructive', 'ops@example.test', 'GDPR erasure', 1, 64 ),
		array( 'destructive', 'ops@example.test', 'Legacy archive sunset', 2, 64 ),
		array( 'destructive', 'ops@example.test', 'Retired 90 days ago', 2, 64 ),
	)
);

// 14. When allowRawSql is true, raw-sql executes and writes a destructive audit row
$raw_schema = $schema;
$raw_schema['migrationProviders']['destructive-migrations']['allowRawSql'] = true;
$raw_plugin = ( new ReflectionClass( \SpacePress\Wp\Plugin::class ) )->newInstanceWithoutConstructor();
( function () use ( $raw_schema, $plugin ) {
	$this->schema = new \SpacePress\Schema( $raw_schema );
	$this->dir    = $plugin->dir;
} )->call( $raw_plugin );
$raw_res = DestructiveMigrations::rawSql(
	$raw_plugin,
	'DELETE FROM `{prefix}sp_items` WHERE 1 = 0',
	array(
		'reason'      => 'No-op raw SQL test',
		'actor'       => 'dba@example.test',
		'confirmRows' => 0,
	),
	cliContext: true
);
eq( 'raw-sql executes and audits when allowRawSql is enabled', array( $raw_res['kind'], $raw_res['operation'] ), array( 'destructive', 'raw-sql' ) );

// 15. WP-CLI dispatcher (`wp spacepress danger status`) works cleanly
[$code, $json] = DestructiveMigrations::wpCli( $plugin, array( 'status' ), array( 'migrations-dir' => $mig_dir ), cliContext: true );
$decoded       = json_decode( $json, true );
eq( 'wpCli danger status returns exit 0 and lists all 4 audit rows', array( $code, count( $decoded['data']['audit'] ?? array() ) ), array( 0, 4 ) );

// Cleanup temp files
@unlink( $col_archive );
@unlink( $tbl_archive );
@unlink( $purge_archive );
foreach ( glob( "$mig_dir/*/*" ) ?: array() as $f ) {
	@unlink( $f );
}
foreach ( glob( "$mig_dir/*" ) ?: array() as $d ) {
	@rmdir( $d );
}
@rmdir( $mig_dir );

finish( 'destructive_migrations' );
