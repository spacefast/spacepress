<?php

declare(strict_types=1);

namespace SpacePress\Wp;

use SpacePress\HttpError;
use SpacePress\Js;

/**
 * Opt-in CLI-only destructive migration provider (`spacepress/danger`, ADR 2026-11-21 §3).
 *
 * Core SpacePress migrations are strictly forward-only and never drop columns, drop tables, or purge
 * data. This provider plugs into {@see Migrator}'s provider registry only when the app opts in via
 * `use: [destructiveMigrations()]` in `spacepress.config.ts`, and enforces:
 *   1. CLI-only execution (refused on HTTP requests and plugin activation).
 *   2. Two-phase retirement prerequisite (columns/tables must already be retired in `ops.json`).
 *   3. Exact live row / non-null value count confirmation (`--confirm-rows=<N>`).
 *   4. Optional (or mandatory when `requireArchive: true`) JSONL archival via `--archive-to=<path>`.
 *   5. Immutable audit rows in `{prefix}sp__migrations` with `kind = 'destructive'`, `actor`, `reason`, `rows_affected`.
 */
final class DestructiveMigrations implements MigrationProvider {

	public const PROVIDER_ID = 'destructive-migrations';

	/**
	 * @param array{id?: string, cliOnly?: bool, requireArchive?: bool, allowRawSql?: bool} $config
	 */
	public function __construct( private readonly array $config = array() ) {
	}

	public function id(): string {
		return self::PROVIDER_ID;
	}

	public function cliOnly(): bool {
		return ( $this->config['cliOnly'] ?? true ) !== false;
	}

	public function describe(): string {
		return 'CLI-only destructive cleanup escape hatch (drop retired columns/tables, purge soft-deleted rows, audited raw SQL)';
	}

	/** Register this provider with Migrator when the app's compiled schema opted into `spacepress/danger`. */
	public static function registerFor( Plugin $plugin ): ?self {
		$cfg = self::providerConfig( $plugin );
		if ( null === $cfg ) {
			return null;
		}
		$provider = new self( $cfg );
		Migrator::registerProvider( $provider );

		return $provider;
	}

	/** @return ?array{id: string, cliOnly: bool, requireArchive: bool, allowRawSql: bool} */
	public static function providerConfig( Plugin $plugin ): ?array {
		$providers = $plugin->schema->raw()['migrationProviders'] ?? null;
		if ( ! is_array( $providers ) || ! isset( $providers[ self::PROVIDER_ID ] ) || ! is_array( $providers[ self::PROVIDER_ID ] ) ) {
			return null;
		}
		$cfg = $providers[ self::PROVIDER_ID ];

		return array(
			'id'             => self::PROVIDER_ID,
			'cliOnly'        => ( $cfg['cliOnly'] ?? true ) !== false,
			'requireArchive' => (bool) ( $cfg['requireArchive'] ?? false ),
			'allowRawSql'    => (bool) ( $cfg['allowRawSql'] ?? false ),
		);
	}

	/** Refuse unless running under WP-CLI (or explicit CLI test harness under CLI SAPI). */
	public static function requireCli( bool $cliContext = false ): void {
		$is_wp_cli   = defined( 'WP_CLI' ) && WP_CLI;
		$is_cli_test = $cliContext && PHP_SAPI === 'cli';
		if ( ! $is_wp_cli && ! $is_cli_test ) {
			throw new HttpError(
				403,
				'cli_only',
				'Destructive migrations are CLI-only and are refused during HTTP requests and plugin activation. Run via `wp spacepress danger` or `spacepress danger`.',
			);
		}
	}

	/** @return array{id: string, cliOnly: bool, requireArchive: bool, allowRawSql: bool} */
	public static function requireEnabled( Plugin $plugin ): array {
		$cfg = self::providerConfig( $plugin );
		if ( null === $cfg ) {
			throw new HttpError(
				403,
				'destructive_migrations_disabled',
				'Destructive migrations are not enabled for this app. Import `destructiveMigrations` from `spacepress/danger` and opt in via `defineConfig({ use: [destructiveMigrations()] })`.',
			);
		}

		return $cfg;
	}

	/**
	 * Fold all `<id>/ops.json` folders in sorted order to compute retired columns and retired tables
	 * eligible for two-phase destructive cleanup.
	 *
	 * @return array{
	 *   retiredColumns: array<string, array{table: string, column: string, retiredIn: string, def: array}>,
	 *   retiredTables: array<string, array{table: string, retiredIn: string}>,
	 *   tableStorageNames: array<string, string>,
	 * }
	 */
	public static function retiredState( string $migrationsDir ): array {
		$files = glob( rtrim( $migrationsDir, '/' ) . '/*/ops.json' ) ?: array();
		$by_id = array();
		foreach ( $files as $file ) {
			$id = basename( dirname( $file ) );
			if ( '' !== $id && '.' !== $id && '..' !== $id ) {
				$by_id[ $id ] = $file;
			}
		}
		ksort( $by_id, SORT_STRING );

		$retiredColumns = array();
		$retiredTables  = array();
		$physical_names = array();

		foreach ( $by_id as $id => $file ) {
			$doc = json_decode( (string) file_get_contents( $file ), true );
			if ( ! is_array( $doc ) || ! is_array( $doc['ops'] ?? null ) ) {
				continue;
			}
			foreach ( $doc['ops'] as $op ) {
				if ( ! is_array( $op ) || ! is_string( $op['op'] ?? null ) ) {
					continue;
				}
				$t = is_string( $op['table'] ?? null ) ? $op['table'] : '';
				switch ( $op['op'] ) {
					case 'createTable':
						if ( '' !== $t ) {
							$def = is_array( $op['def'] ?? null ) ? $op['def'] : array();
							if ( is_string( $op['physicalTable'] ?? null ) && '' !== $op['physicalTable'] ) {
								$physical_names[ $t ] = $op['physicalTable'];
							} elseif ( is_string( $def['existingTable'] ?? null ) && '' !== $def['existingTable'] ) {
								$physical_names[ $t ] = $def['existingTable'];
							} elseif ( is_array( $def['join'] ?? null ) ) {
								$physical_names[ $t ] = '{prefix}sp__join_' . $t;
							} else {
								$storage              = is_string( $def['storageName'] ?? null ) && '' !== $def['storageName'] ? $def['storageName'] : $t;
								$physical_names[ $t ] = '{prefix}sp_' . $storage;
							}
							unset( $retiredTables[ $t ] );
						}
						break;
					case 'retireColumn':
						$c = is_string( $op['column'] ?? null ) ? $op['column'] : '';
						if ( '' !== $t && '' !== $c ) {
							$retiredColumns[ "$t.$c" ] = array(
								'table'     => $t,
								'column'    => $c,
								'retiredIn' => (string) $id,
								'def'       => is_array( $op['was'] ?? null ) ? $op['was'] : array(),
							);
						}
						break;
					case 'unretireColumn':
					case 'purgeRetiredColumn':
						$c = is_string( $op['column'] ?? null ) ? $op['column'] : '';
						unset( $retiredColumns[ "$t.$c" ] );
						break;
					case 'retireTable':
						if ( '' !== $t ) {
							if ( is_string( $op['physicalTable'] ?? null ) && '' !== $op['physicalTable'] ) {
								$physical_names[ $t ] = $op['physicalTable'];
							}
							$retiredTables[ $t ] = array(
								'table'     => $t,
								'retiredIn' => (string) $id,
							);
							foreach ( array_keys( $retiredColumns ) as $k ) {
								if ( str_starts_with( $k, "$t." ) ) {
									unset( $retiredColumns[ $k ] );
								}
							}
						}
						break;
					case 'unretireTable':
					case 'purgeRetiredTable':
						unset( $retiredTables[ $t ] );
						break;
				}
			}
		}

		return array(
			'retiredColumns'    => $retiredColumns,
			'retiredTables'     => $retiredTables,
			'tableStorageNames' => $physical_names,
		);
	}

	/** Inspect retired columns, retired tables, live counts, and destructive audit history. */
	public static function status( Plugin $plugin, ?string $migrationsDir = null, bool $cliContext = false ): array {
		self::requireCli( $cliContext );
		$cfg   = self::requireEnabled( $plugin );
		$dir   = $migrationsDir ?? ( $plugin->dir . '/sp/app/migrations' );
		$state = self::retiredState( $dir );
		$conn  = $plugin->connection();

		$columns = array();
		foreach ( $state['retiredColumns'] as $info ) {
			$phys_table = self::physicalTable( $plugin, $info['table'], $state['tableStorageNames'] );
			$live       = self::column_exists( $conn, $phys_table, $info['column'] )
				? self::count_non_null( $conn, $phys_table, $info['column'] )
				: null;
			$columns[]  = $info + array(
				'physicalTable' => $phys_table,
				'nonNullRows'   => $live,
				'presentInDb'   => null !== $live,
			);
		}

		$tables = array();
		foreach ( $state['retiredTables'] as $info ) {
			$phys_table = self::physicalTable( $plugin, $info['table'], $state['tableStorageNames'] );
			$live       = self::table_exists( $conn, $phys_table ) ? self::count_rows( $conn, $phys_table ) : null;
			$tables[]   = $info + array(
				'physicalTable' => $phys_table,
				'rows'          => $live,
				'presentInDb'   => null !== $live,
			);
		}

		$audit  = array();
		$ledger = $conn->prefix() . 'sp__migrations';
		if ( self::table_exists( $conn, $ledger ) ) {
			$audit = $conn->run(
				"SELECT `id`, `kind`, `applied_at`, `sql`, `actor`, `reason`, `rows_affected` FROM `$ledger` WHERE `app` = ? AND `kind` = 'destructive' ORDER BY `id` DESC LIMIT 50",
				array( $plugin->schema->name() ),
			);
		}

		return array(
			'provider'       => $cfg,
			'retiredColumns' => $columns,
			'retiredTables'  => $tables,
			'audit'          => $audit,
		);
	}

	/**
	 * Drop a previously retired column after verifying two-phase retirement, live non-null count,
	 * optional/mandatory JSONL archival, and recording a destructive audit row in `sp__migrations`.
	 *
	 * @param array{confirmRows?: ?int, reason?: ?string, archiveTo?: ?string, actor?: ?string, dryRun?: bool} $opts
	 */
	public static function dropColumn(
		Plugin $plugin,
		string $table,
		string $column,
		array $opts = array(),
		?string $migrationsDir = null,
		bool $cliContext = false,
	): array {
		self::requireCli( $cliContext );
		$cfg   = self::requireEnabled( $plugin );
		$dir   = $migrationsDir ?? ( $plugin->dir . '/sp/app/migrations' );
		$state = self::retiredState( $dir );

		if ( ! isset( $state['retiredColumns'][ "$table.$column" ] ) ) {
			throw new HttpError(
				409,
				'not_retired',
				"Refusing to drop active column `$table.$column`: two-phase retirement is required. Remove `$column` from `spacepress.config.ts` and deploy a forward-only retirement migration first.",
			);
		}

		$conn       = $plugin->connection();
		$retiredIn  = $state['retiredColumns'][ "$table.$column" ]['retiredIn'];
		$phys_table = self::physicalTable( $plugin, $table, $state['tableStorageNames'] );
		if ( self::is_active_physical_column( $plugin, $phys_table, $column ) ) {
			throw new HttpError(
				409,
				'active_column',
				"Refusing to drop column `$phys_table.$column`: it is still bound by an active collection in the compiled schema.",
			);
		}
		if ( ! self::column_exists( $conn, $phys_table, $column ) ) {
			throw HttpError::notFound( "Column `$phys_table.$column` does not exist in the database (already dropped)." );
		}

		$live_count = self::count_non_null( $conn, $phys_table, $column );
		$q_table    = '`' . str_replace( '`', '``', $phys_table ) . '`';
		$q_col      = '`' . str_replace( '`', '``', $column ) . '`';
		$ddl        = "ALTER TABLE $q_table DROP COLUMN $q_col;";

		if ( ( $opts['dryRun'] ?? false ) === true ) {
			return array(
				'dryRun'        => true,
				'warning'       => "DESTRUCTIVE: Will permanently drop column `$phys_table.$column` ($live_count non-null values).",
				'table'         => $table,
				'physicalTable' => $phys_table,
				'column'        => $column,
				'nonNullRows'   => $live_count,
				'sql'           => $ddl,
				'confirmFlag'   => "--confirm-rows=$live_count",
			);
		}

		self::require_applied_retirement( $plugin, $retiredIn, "column `$table.$column`" );
		self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "dropping column `$phys_table.$column` ($live_count non-null values)" );
		$reason       = self::require_reason( $opts['reason'] ?? null );
		$archive_path = self::resolve_archive( $cfg, $opts['archiveTo'] ?? null );

		return Migrator::locked(
			$conn,
			$plugin->schemaLock(),
			static function () use ( $plugin, $conn, $table, $phys_table, $column, $q_table, $q_col, $ddl, $opts, $reason, $archive_path ): array {
				$live_count = self::count_non_null( $conn, $phys_table, $column );
				self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "dropping column `$phys_table.$column` ($live_count non-null values)" );
				$archived = 0;
				if ( null !== $archive_path ) {
					$rows     = $conn->run( "SELECT * FROM $q_table WHERE $q_col IS NOT NULL" );
					$archived = self::write_jsonl( $archive_path, $rows );
				}
				$id = self::begin_audit( $plugin, "drop_col_{$table}_{$column}", $ddl, $opts['actor'] ?? null, $reason, $live_count );
				$conn->run( $ddl );
				self::finish_audit( $plugin, $id, $live_count );

				return array(
					'id'            => $id,
					'kind'          => 'destructive',
					'operation'     => 'drop-column',
					'table'         => $table,
					'physicalTable' => $phys_table,
					'column'        => $column,
					'rowsAffected'  => $live_count,
					'archived'      => null !== $archive_path ? array(
						'path' => $archive_path,
						'rows' => $archived,
					) : null,
					'sql'           => $ddl,
				);
			}
		);
	}

	/**
	 * Drop a previously retired SQL table after verifying two-phase retirement, live row count,
	 * optional/mandatory JSONL archival, and recording a destructive audit row in `sp__migrations`.
	 *
	 * @param array{confirmRows?: ?int, reason?: ?string, archiveTo?: ?string, actor?: ?string, dryRun?: bool} $opts
	 */
	public static function dropTable(
		Plugin $plugin,
		string $table,
		array $opts = array(),
		?string $migrationsDir = null,
		bool $cliContext = false,
	): array {
		self::requireCli( $cliContext );
		$cfg   = self::requireEnabled( $plugin );
		$dir   = $migrationsDir ?? ( $plugin->dir . '/sp/app/migrations' );
		$state = self::retiredState( $dir );

		if ( $plugin->schema->hasCollection( $table ) || ! isset( $state['retiredTables'][ $table ] ) ) {
			throw new HttpError(
				409,
				'not_retired',
				"Refusing to drop active table `$table`: two-phase retirement is required. Remove `$table` from `spacepress.config.ts` and deploy a forward-only retirement migration first.",
			);
		}

		$conn       = $plugin->connection();
		$retiredIn  = $state['retiredTables'][ $table ]['retiredIn'];
		$phys_table = self::physicalTable( $plugin, $table, $state['tableStorageNames'] );
		if ( self::is_active_physical_table( $plugin, $phys_table ) ) {
			throw new HttpError(
				409,
				'active_table',
				"Refusing to drop table `$phys_table`: it is still owned by an active collection in the compiled schema.",
			);
		}
		$is_managed = str_starts_with( $phys_table, $conn->prefix() . 'sp_' ) && ! str_starts_with( $phys_table, $conn->prefix() . 'sp__' );
		$is_join    = str_starts_with( $phys_table, $conn->prefix() . 'sp__join_' );
		if ( ! $is_managed && ! $is_join ) {
			throw new HttpError( 403, 'protected_table', "Refusing to drop non-app or system table `$phys_table`." );
		}
		if ( ! self::table_exists( $conn, $phys_table ) ) {
			throw HttpError::notFound( "Table `$phys_table` does not exist in the database (already dropped)." );
		}

		$live_count = self::count_rows( $conn, $phys_table );
		$q_table    = '`' . str_replace( '`', '``', $phys_table ) . '`';
		$ddl        = "DROP TABLE $q_table;";

		if ( ( $opts['dryRun'] ?? false ) === true ) {
			return array(
				'dryRun'        => true,
				'warning'       => "DESTRUCTIVE: Will permanently drop table `$phys_table` ($live_count rows).",
				'table'         => $table,
				'physicalTable' => $phys_table,
				'rows'          => $live_count,
				'sql'           => $ddl,
				'confirmFlag'   => "--confirm-rows=$live_count",
			);
		}

		self::require_applied_retirement( $plugin, $retiredIn, "table `$table`" );
		self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "dropping table `$phys_table` ($live_count rows)" );
		$reason       = self::require_reason( $opts['reason'] ?? null );
		$archive_path = self::resolve_archive( $cfg, $opts['archiveTo'] ?? null );

		return Migrator::locked(
			$conn,
			$plugin->schemaLock(),
			static function () use ( $plugin, $conn, $table, $phys_table, $q_table, $ddl, $opts, $reason, $archive_path ): array {
				$live_count = self::count_rows( $conn, $phys_table );
				self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "dropping table `$phys_table` ($live_count rows)" );
				$archived = 0;
				if ( null !== $archive_path ) {
					$rows     = $conn->run( "SELECT * FROM $q_table" );
					$archived = self::write_jsonl( $archive_path, $rows );
				}
				$id = self::begin_audit( $plugin, "drop_tbl_{$table}", $ddl, $opts['actor'] ?? null, $reason, $live_count );
				$conn->run( $ddl );
				self::finish_audit( $plugin, $id, $live_count );

				return array(
					'id'            => $id,
					'kind'          => 'destructive',
					'operation'     => 'drop-table',
					'table'         => $table,
					'physicalTable' => $phys_table,
					'rowsAffected'  => $live_count,
					'archived'      => null !== $archive_path ? array(
						'path' => $archive_path,
						'rows' => $archived,
					) : null,
					'sql'           => $ddl,
				);
			}
		);
	}

	/**
	 * Permanently purge soft-deleted rows of a kind (optionally filtered by `--older-than=<duration>`),
	 * with live count confirmation, optional/mandatory archival, and an audit row in `sp__migrations`.
	 *
	 * @param array{olderThan?: ?string, confirmRows?: ?int, reason?: ?string, archiveTo?: ?string, actor?: ?string, dryRun?: bool} $opts
	 */
	public static function purgeDeleted(
		Plugin $plugin,
		string $kind,
		array $opts = array(),
		bool $cliContext = false,
	): array {
		self::requireCli( $cliContext );
		$cfg = self::requireEnabled( $plugin );
		if ( ! $plugin->schema->hasCollection( $kind ) ) {
			throw HttpError::notFound( "Unknown kind `$kind`." );
		}
		$spec = $plugin->schema->collection( $kind );
		if ( ! ( $spec['softDelete'] ?? false ) ) {
			throw HttpError::invalidInput( "Kind `$kind` does not use soft deletes." );
		}

		$query     = array(
			'deleted' => 'only',
			'limit'   => 10000,
		);
		$olderThan = $opts['olderThan'] ?? null;
		if ( is_string( $olderThan ) && '' !== $olderThan ) {
			$seconds        = self::parse_duration( $olderThan );
			$cutoff         = Js::iso( Js::now() - ( $seconds * 1000 ) );
			$query['where'] = array( 'deletedAt' => array( 'lte' => $cutoff ) );
		}

		$db         = $plugin->db();
		$rows       = $db->findMany( $kind, $query );
		$live_count = count( $rows );

		if ( ( $opts['dryRun'] ?? false ) === true ) {
			return array(
				'dryRun'      => true,
				'warning'     => "DESTRUCTIVE: Will permanently purge $live_count soft-deleted row(s) from `$kind`.",
				'kind'        => $kind,
				'rows'        => $live_count,
				'olderThan'   => $olderThan,
				'confirmFlag' => "--confirm-rows=$live_count",
			);
		}

		self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "purging $live_count soft-deleted rows from `$kind`" );
		$reason       = self::require_reason( $opts['reason'] ?? null );
		$archive_path = self::resolve_archive( $cfg, $opts['archiveTo'] ?? null );
		$conn         = $plugin->connection();
		$cutoff       = isset( $query['where']['deletedAt']['lte'] ) ? (string) $query['where']['deletedAt']['lte'] : null;

		return Migrator::locked(
			$conn,
			$plugin->schemaLock(),
			static function () use ( $plugin, $db, $kind, $spec, $query, $olderThan, $cutoff, $opts, $reason, $archive_path ): array {
				$rows       = $db->findMany( $kind, $query );
				$live_count = count( $rows );
				self::require_confirmation( $live_count, $opts['confirmRows'] ?? null, "purging $live_count soft-deleted rows from `$kind`" );

				$archived = 0;
				if ( null !== $archive_path ) {
					$archived = self::write_jsonl( $archive_path, $rows );
				}

				$summary_sql = "-- purge-deleted $kind ($live_count rows" . ( $olderThan ? ", olderThan=$olderThan" : '' ) . ')';
				$id          = self::begin_audit( $plugin, "purge_{$kind}", $summary_sql, $opts['actor'] ?? null, $reason, $live_count );
				$pk          = $spec['primaryKey'];
				$purged      = 0;
				foreach ( $rows as $row ) {
					$where = array( $pk => $row[ $pk ] );
					if ( null !== $cutoff ) {
						$where['deletedAt'] = array( 'lte' => $cutoff );
					}
					$gone    = $db->transaction( static fn (): array => $db->purge( $kind, $where, returning: true, onlyDeleted: true ) ?? array() );
					$purged += count( $gone );
				}
				self::finish_audit( $plugin, $id, $purged );

				return array(
					'id'           => $id,
					'kind'         => 'destructive',
					'operation'    => 'purge-deleted',
					'collection'   => $kind,
					'rowsAffected' => $purged,
					'archived'     => null !== $archive_path ? array(
						'path' => $archive_path,
						'rows' => $archived,
					) : null,
				);
			}
		);
	}

	/**
	 * Execute an explicit raw SQL escape-hatch statement (only when `allowRawSql: true`), audited in `sp__migrations`.
	 *
	 * @param array{confirmRows?: ?int, reason?: ?string, actor?: ?string, dryRun?: bool} $opts
	 */
	public static function rawSql(
		Plugin $plugin,
		string $sql,
		array $opts = array(),
		bool $cliContext = false,
	): array {
		self::requireCli( $cliContext );
		$cfg = self::requireEnabled( $plugin );
		if ( ! $cfg['allowRawSql'] ) {
			throw new HttpError(
				403,
				'raw_sql_disabled',
				'Raw SQL escape hatch is disabled. Enable it explicitly via `destructiveMigrations({ allowRawSql: true })`.',
			);
		}
		$trimmed = trim( $sql );
		if ( '' === $trimmed ) {
			throw HttpError::invalidInput( '--sql must be a non-empty SQL statement' );
		}
		$conn     = $plugin->connection();
		$rendered = str_replace( '{prefix}', $conn->prefix(), $trimmed );
		if ( ( $opts['dryRun'] ?? false ) === true ) {
			return array(
				'dryRun'  => true,
				'warning' => 'DESTRUCTIVE: Will execute raw SQL directly against the site database.',
				'sql'     => $rendered,
			);
		}
		$reason = self::require_reason( $opts['reason'] ?? null );

		return Migrator::locked(
			$conn,
			$plugin->schemaLock(),
			static function () use ( $plugin, $conn, $trimmed, $rendered, $opts, $reason ): array {
				$id = self::begin_audit( $plugin, 'raw_sql', $trimmed, $opts['actor'] ?? null, $reason, 0 );
				$conn->run( $rendered );
				$rowsAffected = max( 0, $conn->changes() );
				self::finish_audit( $plugin, $id, $rowsAffected );

				return array(
					'id'           => $id,
					'kind'         => 'destructive',
					'operation'    => 'raw-sql',
					'sql'          => $rendered,
					'rowsAffected' => $rowsAffected,
				);
			}
		);
	}

	/**
	 * WP-CLI entry point: `wp spacepress danger <status|plan|drop-column|drop-table|purge-deleted|raw-sql>`.
	 *
	 * @param list<string> $args
	 * @param array<string, mixed> $flags
	 * @return array{int, string}
	 */
	public static function wpCli( Plugin $plugin, array $args, array $flags, bool $cliContext = false ): array {
		try {
			$sub            = $args[0] ?? 'status';
			$opts           = array(
				'confirmRows' => isset( $flags['confirm-rows'] ) && is_numeric( $flags['confirm-rows'] ) ? (int) $flags['confirm-rows'] : null,
				'reason'      => is_string( $flags['reason'] ?? null ) ? $flags['reason'] : null,
				'archiveTo'   => is_string( $flags['archive-to'] ?? null ) ? $flags['archive-to'] : null,
				'actor'       => is_string( $flags['actor'] ?? null ) ? $flags['actor'] : null,
				'olderThan'   => is_string( $flags['older-than'] ?? null ) ? $flags['older-than'] : null,
				'dryRun'      => ( $flags['dry-run'] ?? false ) === true || ( $flags['dry-run'] ?? '' ) === 'true',
			);
			$migrations_dir = is_string( $flags['migrations-dir'] ?? null ) ? $flags['migrations-dir'] : null;

			$data = match ( $sub ) {
				'status', 'plan' => self::status( $plugin, $migrations_dir, $cliContext ),
				'drop-column' => self::dropColumn(
					$plugin,
					$args[1] ?? throw HttpError::invalidInput( 'Usage: wp spacepress danger drop-column <table> <column> --confirm-rows=<N> --reason="..."' ),
					$args[2] ?? throw HttpError::invalidInput( 'Usage: wp spacepress danger drop-column <table> <column> --confirm-rows=<N> --reason="..."' ),
					$opts,
					$migrations_dir,
					$cliContext,
				),
				'drop-table' => self::dropTable(
					$plugin,
					$args[1] ?? throw HttpError::invalidInput( 'Usage: wp spacepress danger drop-table <table> --confirm-rows=<N> --reason="..."' ),
					$opts,
					$migrations_dir,
					$cliContext,
				),
				'purge-deleted' => self::purgeDeleted(
					$plugin,
					$args[1] ?? throw HttpError::invalidInput( 'Usage: wp spacepress danger purge-deleted <kind> --confirm-rows=<N> --reason="..."' ),
					$opts,
					$cliContext,
				),
				'raw-sql' => self::rawSql(
					$plugin,
					is_string( $flags['sql'] ?? null ) ? $flags['sql'] : throw HttpError::invalidInput( 'Usage: wp spacepress danger raw-sql --sql="<statement>" --reason="..."' ),
					$opts,
					$cliContext,
				),
				default => throw HttpError::invalidInput( "Unknown danger subcommand `$sub`. Use status, plan, drop-column, drop-table, purge-deleted, or raw-sql." ),
			};

			return array( 0, (string) Js::jsonStringify( array( 'data' => $data ) ) );
		} catch ( \Throwable $e ) {
			return array( 1, (string) Js::jsonStringify( array( 'error' => \SpacePress\App::problem( $e ) ) ) );
		}
	}

	// ================================================================ internals

	private static function physicalTable( Plugin $plugin, string $table, array $physical_names ): string {
		$prefix = $plugin->connection()->prefix();
		if ( isset( $physical_names[ $table ] ) && is_string( $physical_names[ $table ] ) && '' !== $physical_names[ $table ] ) {
			return str_replace( '{prefix}', $prefix, $physical_names[ $table ] );
		}
		if ( $plugin->schema->hasCollection( $table ) ) {
			$spec = $plugin->schema->collection( $table );
			if ( is_string( $spec['existingTable'] ?? null ) && '' !== $spec['existingTable'] ) {
				return $spec['existingTable'];
			}
			if ( is_string( $spec['table'] ?? null ) && '' !== $spec['table'] ) {
				return $prefix . $spec['table'];
			}
		}

		// Compiler always prepends `sp_` for managed tables (even when storageName starts with `sp_`).
		return $prefix . 'sp_' . $table;
	}

	private static function is_active_physical_table( Plugin $plugin, string $phys_table ): bool {
		$prefix = $plugin->connection()->prefix();
		foreach ( $plugin->schema->collections() as $spec ) {
			$owned = null;
			if ( is_string( $spec['existingTable'] ?? null ) && '' !== $spec['existingTable'] ) {
				$owned = $spec['existingTable'];
			} elseif ( is_string( $spec['table'] ?? null ) && '' !== $spec['table'] ) {
				$owned = $prefix . $spec['table'];
			}
			if ( null !== $owned && strcasecmp( $owned, $phys_table ) === 0 ) {
				return true;
			}
			foreach ( $spec['columns'] ?? array() as $col ) {
				if ( ( $col['type'] ?? null ) === 'refList' && is_string( $col['references']['join'] ?? null ) ) {
					$join = $col['references']['join'];
					if ( ! str_starts_with( $join, 'term:' ) && strcasecmp( $prefix . 'sp__join_' . $join, $phys_table ) === 0 ) {
						return true;
					}
				}
			}
		}

		return false;
	}

	private static function is_active_physical_column( Plugin $plugin, string $phys_table, string $column ): bool {
		$prefix = $plugin->connection()->prefix();
		foreach ( $plugin->schema->collections() as $spec ) {
			$owned = null;
			if ( is_string( $spec['existingTable'] ?? null ) && '' !== $spec['existingTable'] ) {
				$owned = $spec['existingTable'];
			} elseif ( is_string( $spec['table'] ?? null ) && '' !== $spec['table'] ) {
				$owned = $prefix . $spec['table'];
			}
			if ( null === $owned || strcasecmp( $owned, $phys_table ) !== 0 ) {
				continue;
			}
			foreach ( $spec['columns'] ?? array() as $logical => $col ) {
				$phys = is_string( $col['column'] ?? null ) && '' !== $col['column'] ? $col['column'] : (string) $logical;
				if ( strcasecmp( $phys, $column ) === 0 ) {
					return true;
				}
			}
		}

		return false;
	}

	private static function require_applied_retirement( Plugin $plugin, string $retiredIn, string $target ): void {
		$conn   = $plugin->connection();
		$ledger = $conn->prefix() . 'sp__migrations';
		if ( ! self::table_exists( $conn, $ledger ) ) {
			throw new HttpError(
				409,
				'retirement_not_applied',
				"Refusing to drop $target: retirement migration `$retiredIn` has not been applied to this database yet. Run `wp spacepress migrate` first.",
			);
		}
		$rows = $conn->run(
			"SELECT 1 FROM `$ledger` WHERE `app` = ? AND `id` = ? LIMIT 1",
			array( $plugin->schema->name(), $retiredIn ),
		);
		if ( array() === $rows ) {
			throw new HttpError(
				409,
				'retirement_not_applied',
				"Refusing to drop $target: retirement migration `$retiredIn` has not been applied to this database yet. Run `wp spacepress migrate` first.",
			);
		}
	}

	private static function table_exists( Connection $conn, string $table ): bool {
		return $conn->run(
			'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
			array( $table ),
		) !== array();
	}

	private static function column_exists( Connection $conn, string $table, string $column ): bool {
		if ( ! self::table_exists( $conn, $table ) ) {
			return false;
		}
		$q = '`' . str_replace( '`', '``', $table ) . '`';
		foreach ( $conn->run( "SHOW COLUMNS FROM $q" ) as $col ) {
			if ( strcasecmp( (string) ( $col['Field'] ?? '' ), $column ) === 0 ) {
				return true;
			}
		}

		return false;
	}

	private static function count_rows( Connection $conn, string $table ): int {
		$q = '`' . str_replace( '`', '``', $table ) . '`';

		return (int) ( $conn->run( "SELECT COUNT(*) AS n FROM $q" )[0]['n'] ?? 0 );
	}

	private static function count_non_null( Connection $conn, string $table, string $column ): int {
		$q_table = '`' . str_replace( '`', '``', $table ) . '`';
		$q_col   = '`' . str_replace( '`', '``', $column ) . '`';

		return (int) ( $conn->run( "SELECT COUNT(*) AS n FROM $q_table WHERE $q_col IS NOT NULL" )[0]['n'] ?? 0 );
	}

	private static function require_confirmation( int $live_count, ?int $confirmed, string $action ): void {
		if ( null === $confirmed || $confirmed !== $live_count ) {
			$given = null === $confirmed ? 'none' : (string) $confirmed;
			throw new HttpError(
				409,
				'confirmation_mismatch',
				"DESTRUCTIVE OPERATION REFUSED: $action requires exact row-count confirmation. Live count is $live_count (got $given). Re-run with `--confirm-rows=$live_count` after verifying backups.",
			);
		}
	}

	private static function require_reason( ?string $reason ): string {
		$trimmed = trim( (string) $reason );
		if ( '' === $trimmed ) {
			throw HttpError::invalidInput( 'A non-empty `--reason="..."` is required for the destructive migration audit trail.', '/reason' );
		}

		return $trimmed;
	}

	/** @param array{requireArchive: bool} $cfg */
	private static function resolve_archive( array $cfg, ?string $archiveTo ): ?string {
		$path = trim( (string) $archiveTo );
		if ( '' === $path ) {
			if ( $cfg['requireArchive'] ) {
				throw new HttpError(
					422,
					'archive_required',
					'This app configured `destructiveMigrations({ requireArchive: true })`: pass `--archive-to=/path/to/backup.jsonl` before executing.',
				);
			}

			return null;
		}

		return $path;
	}

	private static function write_jsonl( string $path, array $rows ): int {
		if ( str_contains( $path, '://' ) || str_contains( $path, "\0" ) ) {
			throw HttpError::invalidInput( "Archive path must be a local filesystem path: `$path`.", '/archive-to' );
		}
		$dir = dirname( $path );
		if ( ! is_dir( $dir ) && ! @mkdir( $dir, 0755, true ) && ! is_dir( $dir ) ) {
			throw new \RuntimeException( "Could not create archive directory `$dir`." );
		}
		$fh = @fopen( $path, 'xb' );
		if ( false === $fh ) {
			throw new \RuntimeException( "Could not create archive file `$path` (it already exists or is not writable). Choose a fresh archive filename." );
		}
		try {
			foreach ( $rows as $row ) {
				$line    = (string) Js::jsonStringify( $row ) . "\n";
				$written = fwrite( $fh, $line );
				if ( $written !== strlen( $line ) ) {
					throw new \RuntimeException( "Short write while archiving to `$path`." );
				}
			}
			if ( ! fflush( $fh ) ) {
				throw new \RuntimeException( "Could not flush archive file `$path`." );
			}
		} catch ( \Throwable $e ) {
			fclose( $fh );
			@unlink( $path );
			throw $e;
		}
		fclose( $fh );

		return count( $rows );
	}

	private static function parse_duration( string $raw ): int {
		if ( ! preg_match( '/^([1-9]\d*)(s|m|h|d|w|y)$/', trim( $raw ), $m ) ) {
			throw HttpError::invalidInput( "Invalid --older-than duration `$raw`; use e.g. 30d, 12h, 1y.", '/older-than' );
		}
		$mult = array(
			's' => 1,
			'm' => 60,
			'h' => 3600,
			'd' => 86400,
			'w' => 604800,
			'y' => 31536000,
		)[ $m[2] ];

		return (int) $m[1] * $mult;
	}

	/** Record durable audit intent before executing destructive DDL/SQL. */
	private static function begin_audit( Plugin $plugin, string $slug, string $sql, ?string $actor, string $reason, int $expected_rows ): string {
		$conn       = $plugin->connection();
		$ledger     = Migrator::ensureLedger( $conn, $plugin->schema );
		$now        = Js::iso( Js::now() );
		$ts         = gmdate( 'YmdHis' );
		$hash       = substr( hash( 'sha256', "$ts|$slug|$sql|$reason|" . random_bytes( 8 ) ), 0, 6 );
		$clean_slug = trim( (string) preg_replace( '/[^a-z0-9_]+/', '_', strtolower( $slug ) ), '_' );
		$id         = "{$ts}_{$hash}_{$clean_slug}";
		$who        = trim( (string) ( $actor ?? '' ) );
		if ( '' === $who ) {
			$who = function_exists( 'get_current_user' ) ? (string) get_current_user() : 'cli';
		}
		$conn->run(
			"INSERT INTO `$ledger` (`app`, `id`, `kind`, `applied_at`, `sql`, `actor`, `reason`, `rows_affected`) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)",
			array( $plugin->schema->name(), $id, $now, hash( 'sha256', $sql ), $who, $reason, $expected_rows ),
		);

		return $id;
	}

	/** Finalize the audit row with `kind = 'destructive'` and the observed affected row count. */
	private static function finish_audit( Plugin $plugin, string $id, int $rowsAffected ): void {
		$conn   = $plugin->connection();
		$ledger = $conn->prefix() . 'sp__migrations';
		$conn->run(
			"UPDATE `$ledger` SET `kind` = 'destructive', `rows_affected` = ? WHERE `app` = ? AND `id` = ?",
			array( $rowsAffected, $plugin->schema->name(), $id ),
		);
	}
}
