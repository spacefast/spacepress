<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * The one pipeline (§3.3): every read and write (REST, CLI, hooks, actions, editor saves) goes through
 * here, so defaults, coercion, rules, access, drafts, revisions, FK actions and hooks always run the
 * same way. Storage is a Store; Db never builds SQL itself (Sql does) and never parses driver errors.
 *
 * A null $viewer means trusted (hooks, actions, CLI): no access checks, every status visible.
 * The request's user (`actor`) is what hooks/validators see as ctx.user, trusted or not.
 * A viewer without a user is anonymous. The actor only supplies hook and revision attribution.
 */
final class Db {

	private const MAX_HOOK_DEPTH = 8;
	private const QUERY_OPTS     = array( 'where', 'orderBy', 'limit', 'offset', 'columns', 'with', 'search', 'searchFields', 'deleted' );

	private static ?self $instance = null;
	private static ?self $current  = null;

	private int $depth    = 0;
	private ?array $actor = null;
	/** @var list<BulkUpdate> open updates, innermost last */
	private array $bulk = array();
	/** Active cascade soft-delete group inherited by viewer-checked child deletes. */
	private ?string $activeDeleteGroup = null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** Prevents re-entering group child restore while restoring children of a deletedGroup. */
	private bool $restoringGroup = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	/** @var array<string, array<int|string, int|string>> primary keys currently being deleted, by collection */
	private array $deleting = array();
	/** @var ?array<string, array<int|string, int>> deletion order within the current traversal */
	private ?array $deleted = null;
	/** @var array<string, array<int|string, array>> deleted row snapshots within the current traversal */
	private array $deletedRows  = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private int $deleteSequence = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	public function __construct(
		private readonly Store $store,
		private readonly Schema $schema,
		private readonly Media $media,
	) {
	}

	public static function setInstance( self $db ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		self::$instance = $db;
		Access::clearCache();
	}

	/** Identity of the active Db instance (0 when none is bound), for Access cache scoping. */
	public static function currentId(): int { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$db = self::$current ?? self::$instance;

		return null !== $db ? spl_object_id( $db ) : 0;
	}

	/**
	 * The Db that `db()` names: the one running the current operation, else the app's. Extensions
	 * (field access, sync, locales, files…) read the schema and query through `db()`, so a second Db
	 * (another app, a test fixture) gets its own schema and store, never the booted app's.
	 */
	public static function instance(): self {
		static $booting = false;
		if ( null === self::$current && null === self::$instance && ! $booting ) {
			// On WordPress the app boots on first use (a hook that reads through `db()` before any
			// request handler did), not on every request.
			$booting = true;
			try {
				Wp\Plugin::instance()?->app();
			} finally {
				$booting = false;
			}
		}

		return self::$current ?? self::$instance ?? throw new \LogicException( 'SpacePress\Db is not initialised; call App::boot() first' );
	}

	/** Run $fn with this Db as `db()`; the previous one is restored after, even on a throw. */
	public function current( callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$previous      = self::$current;
		self::$current = $this;
		try {
			return $fn();
		} finally {
			self::$current = $previous;
		}
	}

	public function store(): Store {
		return $this->store;
	}

	public function schema(): Schema {
		return $this->schema;
	}

	public function media(): Media {
		return $this->media;
	}

	/** The user hooks and validators see as ctx.user for the rest of this request/command. */
	public function setActor( ?array $user ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->actor = $user;
	}

	public function actor(): ?array {
		return $this->actor;
	}

	/** @return array{user: ?array} */
	public function hookCtx(): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return array( 'user' => $this->actor );
	}

	/**
	 * When the update writing row $from right now also covers row $pk and hasn't written it yet, write
	 * $pk now: its own patch (with the update's viewer, access and field rules), plus $values, trusted
	 * values that win over the patch (a translation group's synced values). That update then skips
	 * $pk, so its hooks run once. False when no such update is open.
	 */
	public function updateWithin( string $collection, int|string $from, int|string $pk, array $values ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$bulk = null;
		foreach ( array_reverse( $this->bulk ) as $open ) {
			if ( $open->collection === $collection && $open->current === self::key( $from ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
				$bulk = $open;
				break;
			}
		}
		$key = self::key( $pk );
		if ( null === $bulk || ! isset( $bulk->pending[ $key ] ) ) {
			return false;
		}
		unset( $bulk->pending[ $key ] );
		$opts     = array(
			'where' => array( $bulk->spec['primaryKey'] => $pk ),
			'limit' => 1,
		);
		$existing = $this->select_decoded( $collection, $opts, '', null )[0] ?? null;
		if ( null !== $existing ) {
			// Through nested(): the early write counts toward MAX_HOOK_DEPTH like the write it replaces.
			$bulk->done[ $key ] = $this->nested( fn () => Js::atInstant( fn () => $this->update_one( $collection, $bulk->spec, $existing, $bulk->set, $bulk->viewer, $values, $bulk->errorViewer ) ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}

		return true;
	}

	/** Run $fn in one store transaction (joins an open one). Any throwable rolls back. */
	public function transaction( callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		return $this->current(
			function () use ( $fn ): mixed {
				try {
					return $this->store->transaction( $fn );
				} catch ( \Throwable $e ) {
					Access::clearCache();
					throw $e;
				}
			}
		);
	}

	/**
	 * {@see transaction()} for work that usually only reads: on WordPress the transaction starts at
	 * the first write ({@see Wp\Connection::reading()}), so work that writes nothing sends the
	 * database neither START TRANSACTION nor COMMIT.
	 */
	public function reading( callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$store = $this->store;

		return $this->current( static fn () => $store instanceof Wp\CompositeStore ? $store->db->reading( $fn ) : $store->transaction( $fn ) );
	}

	/**
	 * Lazy scheduled promotion (§6.3) for every drafts collection. No hooks, no revisions.
	 *
	 * @return array<string, list<int|string>> collection => promoted pks (only non-empty)
	 */
	public function promoteDue(): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$now = Js::iso( Js::now() );
		$out = array();
		foreach ( $this->schema->collections() as $name => $spec ) {
			if ( $spec['drafts'] ?? false ) {
				$pks = $this->store->promoteDue( (string) $name, $now );
				if ( array() !== $pks ) {
					$out[ $name ] = $pks;
					Realtime\Module::promoted( (string) $name, $pks );
					foreach ( $pks as $pk ) {
						$this->afterPromotion( (string) $name, $pk );
					}
				}
			}
		}

		return $out;
	}

	// ================================================================ reads

	/** @return list<array> */
	public function findMany( string $collection, array|JsObject $opts = array(), ?Viewer $viewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current(
			function () use ( $collection, $opts, $viewer ): array {
				$opts = Seam::query( $collection, $opts, $this->schema );
				$rows = $this->fetch( $collection, $opts, '', $viewer );

				return $this->project( $rows, $collection, $opts, '' );
			}
		);
	}

	public function findFirst( string $collection, array|JsObject $opts = array(), ?Viewer $viewer = null ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$opts = Seam::query( $collection, $opts, $this->schema );
		return $this->findMany( $collection, array( 'limit' => 1 ) + $opts, $viewer )[0] ?? null;
	}

	/**
	 * Full decoded rows (relations/media from `with` attached, `columns` not yet applied).
	 * With $partition = [column, encoded values], rows are restricted to column IN values and
	 * limit/offset apply per distinct column value.
	 *
	 * @param ?array{string, list<mixed>} $partition
	 * @param list<array> $guards extra filters (access) — read guards are added here when $viewer is set
	 * @return list<array>
	 */
	private function fetch( string $collection, array &$opts, string $ptr, ?Viewer $viewer, ?array $partition = null, array $guards = array(), ?array &$decoded = null, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$published_only = false;
		$decoded        = $this->select_decoded( $collection, $opts, $ptr, $viewer, $partition, $guards, prune: true, published_only: $published_only, forUpdate: $forUpdate ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		// What a page render read (its purges): only a read that named its rows and found them all
		// depends on those rows alone.
		$named = Render\Reads::recording() ? $this->named( $collection, $opts, $partition, $published_only ) : null;
		$rows  = Render\Reads::exact( $collection, null !== $named && count( $decoded ) === $named, static fn (): array => Extensions::read( $decoded, $collection, $viewer ) );
		if ( isset( $opts['with'] ) && array() !== $rows ) {
			$rows = $this->attach( $collection, $rows, $opts['with'], $ptr . '/with', $viewer, $decoded );
		}

		return $rows;
	}

	/**
	 * How many rows a read names by a unique key, or null when it names none: `where` (or the key a
	 * relation joins on) holds the primary key, or a unique column, to one value or a list of them.
	 * Every other condition only narrows that set. A unique column counts only where one value is
	 * one row: not in a hierarchical kind (a slug per parent), and in a kind with drafts only for a
	 * read that sees published rows alone ({@see publishedOnly()}: drafts may share a value until
	 * one is published). A localized kind names none.
	 *
	 * A read that found exactly the rows it named answers differently only after a write to one of
	 * them: another row can take a found key's value only once the found row gave it up. A named
	 * row that is missing (or hidden from the viewer) can appear with a write to any row.
	 *
	 * @param ?array{string, list<mixed>} $partition
	 */
	private function named( string $collection, array $opts, ?array $partition, bool $published_only ): ?int {
		// A localized read may answer with another row of the named row's translation group.
		if ( $this->localized( $collection ) ) {
			return null;
		}
		$spec   = $this->schema->collection( $collection );
		$pk     = (string) $spec['primaryKey'];
		$unique = array();
		if ( ! ( $spec['hierarchical'] ?? false ) ) {
			foreach ( $spec['columns'] as $name => $column ) {
				if ( ( $column['unique'] ?? false ) && (string) $name !== $pk ) {
					$unique[ (string) $name ] = true;
				}
			}
		}
		$one   = static fn ( mixed $v ): bool => is_int( $v ) || is_string( $v ) || ( is_float( $v ) && floor( $v ) === $v );
		$where = is_array( $opts['where'] ?? null ) ? $opts['where'] : array();
		// A relation's rows are named by the key it joins on, when that is a key of theirs (the
		// row a foreign key refers to); a parent's children are joined on a column that is not.
		$by = array_intersect_key( null !== $partition ? array( $partition[0] => array( 'in' => $partition[1] ) ) : $where, array( $pk => true ) + $unique );
		foreach ( $by as $column => $value ) {
			if ( is_array( $value ) && array_keys( $value ) === array( 'eq' ) ) {
				$value = $value['eq'];
			}
			$count = match ( true ) {
				$one( $value ) => 1,
				is_array( $value ) && array_keys( $value ) === array( 'in' ) && is_array( $value['in'] ) && array_is_list( $value['in'] )
					&& array_filter( $value['in'], static fn ( mixed $v ): bool => ! $one( $v ) ) === array() => count( array_unique( array_map( self::key( ... ), $value['in'] ) ) ),
				default => null,
			};
			if ( null !== $count && ( $column === $pk || ! ( $spec['drafts'] ?? false ) || $published_only ) ) {
				return $count;
			}
		}

		return null;
	}

	/**
	 * Whether $viewer reads only the published rows of a kind with drafts under a shorthand read rule.
	 * WordPress's own posts: who reads a draft is core's answer, applied by the store's guards.
	 */
	private function drafts_hidden( array $spec, array $rule, Viewer $viewer ): bool {
		return ( $spec['drafts'] ?? false ) && Access::isShorthand( $rule ) && ! ( $spec['native'] ?? false )
			&& ( null === $viewer->user || Schema::roleRank( $viewer->user['role'] ) < Schema::roleRank( 'editor' ) );
	}

	/**
	 * Select full storage rows without presentation transforms; write guards remain SQL filters.
	 * $filterViewer confines a write selector's relation filters to rows that viewer may read.
	 */
	private function select_decoded( string $collection, array &$opts, string $ptr, ?Viewer $viewer, ?array $partition = null, array $guards = array(), ?Viewer $filter_viewer = null, bool $prune = false, ?bool &$published_only = null, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->current(
			function () use ( $collection, &$opts, $ptr, $viewer, $partition, $guards, $filter_viewer, $prune, &$published_only, $forUpdate ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$spec = $this->schema->hasCollection( $collection ) ? $this->schema->collection( $collection ) : null;
				$only = null;
				$q    = $this->compile_read( $collection, $opts, $ptr, $viewer, $partition, $guards, $filter_viewer, $prune, $only, $published_only, forUpdate: $forUpdate ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( null !== $partition && array() === $partition[1] ) {
					return array();
				}
				$columns = null === $only ? $spec['columns'] : array_intersect_key( $spec['columns'], $only );

				return array_map(
					static fn ( array $raw ) => Schema::decodeRow( $columns, $raw ),
					$this->with_links( $collection, $this->store->select( $collection, $q ), $only, $forUpdate ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				);
			}
		);
	}

	/**
	 * The columns a read's SQL must select when it asks for some (`columns`), or null for every column:
	 * the ones `columns` keeps, the primary key, what `with` loads and the keys it joins on, the
	 * partition column a relation groups children by, a localized kind's locale and translations, and
	 * what read extensions read. Null whenever any of those can't be known: no or an invalid `columns`
	 * (project() refuses it after the read, as before), a read extension that didn't say what it reads,
	 * or a field read rule written as a function (it sees the whole row).
	 *
	 * @return ?array<string, true>
	 */
	private function selected( string $collection, array $opts, ?Viewer $viewer, ?array $partition ): ?array {
		$columns = $opts['columns'] ?? null;
		$spec    = $this->schema->collection( $collection );
		$known   = $spec['columns'];
		if ( ! is_array( $columns ) || ( array() !== $columns && array_is_list( $columns ) ) || array_diff_key( $columns, $known ) !== array() ) {
			return null;
		}
		$extra = Extensions::readColumns( $collection, $viewer );
		if ( null === $extra ) {
			return null;
		}
		if ( null !== $viewer ) {
			foreach ( $known as $def ) {
				if ( isset( $def['access']['read'] ) && ! Access::isShorthand( $def['access']['read'] ) ) {
					return null;
				}
			}
		}
		$included = array_keys( array_filter( $columns, static fn ( $on ) => true === $on ) );
		$keep     = array() !== $included ? $included : array_keys( array_diff_key( $known, array_filter( $columns, static fn ( $on ) => false === $on ) ) );
		$keep[]   = $spec['primaryKey'];
		if ( null !== $partition ) {
			$keep[] = $partition[0];
		}
		$relations = $spec['relations'] ?? array();
		foreach ( is_array( $opts['with'] ?? null ) ? $opts['with'] : array() as $name => $on ) {
			if ( false === $on || null === $on ) {
				continue;
			}
			$keep[] = (string) $name;
			if ( isset( $relations[ $name ] ) && ! isset( $relations[ $name ]['through'] ) ) {
				$keep[] = (string) $relations[ $name ]['from'];
			}
		}
		array_push( $keep, ...$extra );
		if ( $this->localized( $collection ) ) {
			array_push( $keep, 'locale', 'translations' );
		}

		return array_fill_keys( array_keys( array_intersect_key( $known, array_flip( array_map( 'strval', $keep ) ) ) ), true );
	}

	/**
	 * `findMany($collection, ['where' => $where], $viewer)`'s row count as SQL (`n`): the same read
	 * rule, draft visibility and query extensions (a filter through a hidden field is the same 403),
	 * without reading the rows. Read extensions never drop rows (onRead keeps membership), so this is
	 * the list's count. The caller runs it on the store's connection.
	 *
	 * @return array{sql: string, params: list<int|float|string|null>}
	 */
	public function countQuery( string $collection, mixed $where = null, ?Viewer $viewer = null, array $extra = array(), bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		return $this->current(
			function () use ( $collection, $where, $viewer, $extra, $forUpdate ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$opts = Seam::query( $collection, ( null === $where ? array() : array( 'where' => $where ) ) + $extra, $this->schema );
				// The inner SELECT scans the referencing rows and their index ranges. Locking only the
				// aggregate would leave the inner read on the transaction's old snapshot.
				$q        = $this->compile_read( $collection, $opts, '', $viewer, count: true, forUpdate: $forUpdate ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$q['sql'] = 'SELECT COUNT(*) AS n FROM (' . $q['sql'] . ') first_count';

				return $q;
			}
		);
	}

	/** {@see countQuery()}, run: how many rows `findMany($collection, ['where' => $where] + $extra, $viewer)` would return. */
	public function count( string $collection, mixed $where = null, ?Viewer $viewer = null, array $extra = array() ): int {
		$q     = $this->countQuery( $collection, $where, $viewer, $extra );
		$store = $this->store;
		if ( ! $store instanceof Wp\CompositeStore ) {
			throw new \LogicException( 'count() needs the WordPress store' );
		}

		// A count reads no rows, so the read hooks don't see it: a render that counts a kind still
		// depends on every write to it (its purges, and live regions).
		Render\Reads::listed( $collection );

		return (int) ( $store->db->run( $q['sql'], $q['params'] )[0]['n'] ?? 0 );
	}

	/** One read compiled: query extensions, option checks, the viewer's read guards. */
	private function compile_read( string $collection, array &$opts, string $ptr, ?Viewer $viewer, ?array $partition = null, array $guards = array(), ?Viewer $filter_viewer = null, bool $prune = false, ?array &$only = null, ?bool &$published_only = null, bool $count = false, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->current(
			function () use ( $collection, &$opts, $ptr, $viewer, $partition, $guards, $filter_viewer, $prune, &$only, &$published_only, $count, $forUpdate ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( ! $this->schema->hasCollection( $collection ) ) {
					throw HttpError::invalidQuery( "Unknown collection '$collection'", '' === $ptr ? null : $ptr );
				}
				$spec = $this->schema->collection( $collection );
				// A viewer-bound mutation selector is a query too: extensions see its viewer.
				Extensions::query( $collection, $opts, $viewer ?? $filter_viewer, $ptr );
				foreach ( $opts as $k => $_ ) {
					if ( ! in_array( $k, self::QUERY_OPTS, true ) ) {
						throw HttpError::invalidQuery( "Unknown query option '$k'", $ptr . HttpError::seg( $k ) );
					}
				}
				$deleted = $opts['deleted'] ?? 'exclude';
				if ( ! in_array( $deleted, array( 'exclude', 'include', 'only' ), true ) ) {
					throw HttpError::invalidQuery( "deleted must be 'exclude', 'include', or 'only'", $ptr . '/deleted' );
				}
				if ( 'exclude' !== $deleted && ! ( $spec['softDelete'] ?? false ) ) {
					throw HttpError::invalidQuery( "`$collection` does not use softDelete", $ptr . '/deleted' );
				}
				if ( 'exclude' !== $deleted && null !== $viewer ) {
					$restore_rule = Access::collectionRules( $spec )['restore'];
					$allowed      = $this->current( fn () => Access::evaluate( $restore_rule, $viewer, 'restore', null, $spec['columns'], $collection ) );
					if ( false === $allowed ) {
						throw Access::deny( $viewer->user, "read deleted $collection rows" );
					}
					if ( is_array( $allowed ) ) {
						$guards[] = $allowed;
					}
				}
				$build = function () use ( $collection, &$opts, $ptr, $viewer, $partition, &$guards, $filter_viewer, $prune, &$only, &$published_only, $spec, $deleted, $count, $forUpdate ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					if ( null !== $viewer ) {
						array_push( $guards, ...$this->readGuards( $collection, $viewer, for_select: true, deleted: $deleted ) );
					}
					if ( null !== $published_only && Render\Reads::recording() && ( $spec['drafts'] ?? false ) ) {
						// Reuse the applied read guard. Calling an authored rule again could produce a
						// different filter or repeat its side effects.
						foreach ( array( $opts['where'] ?? null, ...$guards ) as $filter ) {
							if ( is_array( $filter ) && in_array( $filter['status'] ?? null, array( 'published', array( 'eq' => 'published' ) ), true ) ) {
								$published_only = true;
								break;
							}
						}
					}
					$fv = $filter_viewer ?? $viewer;
					// `search`: the rows whose searchable fields this reader may read hold every word, as one
					// more condition on this same read (docs/decisions/2026-11-13-search-index.md).
					if ( array_key_exists( 'search', $opts ) ) {
						$search = $opts['search'];
						unset( $opts['search'] );
						if ( null !== $search && ! is_string( $search ) ) {
							throw HttpError::invalidQuery( 'search must be a string', $ptr . '/search' );
						}
						if ( is_string( $search ) && trim( $search ) !== '' ) {
							array_push( $guards, ...Search\Module::guard( $collection, $search, $fv, $opts['searchFields'] ?? null ) );
						}
					}
					unset( $opts['searchFields'] );
					// After the query extensions: they may consume options (`with` on a file column) the selection reads.
					$only = match ( true ) {
						$count => array( $spec['primaryKey'] => true ),
						$prune => $this->selected( $collection, $opts, $viewer, $partition ),
						default => null,
					};

					return Sql::select(
						$this->schema,
						$this->store,
						$collection,
						$opts,
						$partition,
						$ptr,
						$guards,
						null === $fv ? null : fn ( string $target ): array => $this->readGuards( $target, $fv, for_select: true ),
						$only,
						$forUpdate // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					);
				};

				return 'exclude' !== $deleted ? $this->with_trash_for( $collection, $build ) : $build();
			}
		);
	}

	/** Mutation results and revision snapshots may bypass selects, or follow hooks that replace caches. */
	private function present( array $rows, string $collection, ?Viewer $viewer ): array {
		Extensions::lookup( $collection, array_column( $rows, $this->schema->collection( $collection )['primaryKey'] ) );

		return Extensions::read( $rows, $collection, $viewer );
	}

	/**
	 * Does $viewer's read/update/delete rule (+ draft visibility for read; $data as a write's rule
	 * sees it) cover row $pk? For surfaces that ask the pipeline's question outside it: core `/wp/v2`
	 * and WordPress capabilities. A rule that denies outright is false, like a row it filters out.
	 */
	public function permits( string $collection, string $op, int|string $pk, Viewer $viewer, ?array $data = null ): bool {
		try {
			$guards = 'read' === $op ? $this->readGuards( $collection, $viewer, for_select: true ) : $this->write_guards( $collection, $op, $viewer, $data );
		} catch ( HttpError ) {
			return false;
		}

		return $this->keys_matching( $collection, array( $this->schema->collection( $collection )['primaryKey'] => $pk ), $guards ) !== array();
	}

	/**
	 * The primary keys $viewer's read or update rule (+ draft visibility for read) covers, or null when
	 * it covers every row. Throws 401/403 when the rule denies. Rows as stored: no locale or other
	 * query extension narrows them. For integer primary keys a candidate narrows this first read
	 * and $remaining can read the complete set later under the same evaluated guards.
	 *
	 * @param-out ?\Closure(): list<int|string> $remaining
	 * @return ?list<int|string>
	 */
	public function permittedKeys( string $collection, string $op, Viewer $viewer, ?int $candidate = null, ?\Closure &$remaining = null ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$remaining = null;
		$read      = $this->preparePermittedKeys( $collection, $op, $viewer );
		return null === $read ? null : $read( $candidate, $remaining );
	}

	/**
	 * Evaluate the rule now. A REST permission check validates its SQL filters, and only needs to
	 * know whether the rule refused. Its later item or list read can execute the same decision.
	 * Null means unrestricted; an outright refusal throws.
	 */
	public function preparePermittedKeys( string $collection, string $op, Viewer $viewer, bool $validate = false ): ?\Closure { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$guards = 'read' === $op ? $this->readGuards( $collection, $viewer, select_when_restricted: true ) : $this->write_guards( $collection, $op, $viewer, null );
		if ( array() === $guards ) {
			return null;
		}
		$spec  = $this->schema->collection( $collection );
		$pk    = $spec['primaryKey'];
		$query = $validate ? $this->current( fn () => $this->key_query( $collection, null, $guards ) ) : null;
		$all   = fn (): array => $this->keys_matching( $collection, null, $guards, $query );

		return function ( ?int $candidate, ?\Closure &$remaining ) use ( $collection, $guards, $pk, $spec, $all ): array {
			if ( null !== $candidate && 'integer' === $spec['columns'][ $pk ]['type'] ) {
				$remaining = $all;
				return $this->keys_matching( $collection, array( $pk => $candidate ), $guards );
			}
			return $all();
		};
	}

	/** @return list<int|string> primary keys of rows matching $where and every guard, as stored */
	private function keys_matching( string $collection, ?array $where, array $guards, ?array $query = null ): array {
		return $this->current(
			fn () => array_column(
				$this->store->select( $collection, $query ?? $this->key_query( $collection, $where, $guards ) ),
				$this->schema->collection( $collection )['primaryKey'],
			)
		);
	}

	private function key_query( string $collection, ?array $where, array $guards, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$pk = $this->schema->collection( $collection )['primaryKey'];
		return Sql::select( $this->schema, $this->store, $collection, null === $where ? array() : array( 'where' => $where ), guards: $guards, only: array( $pk => true ), forUpdate: $forUpdate ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	/**
	 * The row filters $viewer's reads of $collection are confined to: the read rule's filter, draft
	 * visibility (`['status' => 'published']`) and the store's own guards. Empty when the viewer
	 * reads every row; a 401/403 when the rule refuses the viewer.
	 *
	 * @return list<array|SqlPredicate>
	 */
	public function readScope( string $collection, Viewer $viewer ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->readGuards( $collection, $viewer );
	}

	/** The read rule (+ draft visibility) as filters; throws 401/403 when the rule is false. */
	private function readGuards( string $collection, Viewer $viewer, bool $for_select = false, string $deleted = 'exclude', bool $select_when_restricted = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$spec = $this->schema->collection( $collection );
		$rule = Access::collectionRules( $spec )['read'];
		$r    = $this->current( fn () => Access::evaluate( $rule, $viewer, 'read', null, $spec['columns'], $collection ) );
		if ( false === $r ) {
			throw Access::deny( $viewer->user, "read $collection" );
		}
		$guards = is_array( $r ) ? array( $r ) : array();
		if ( $this->drafts_hidden( $spec, $rule, $viewer ) ) {
			if ( 'exclude' === $deleted ) {
				$guards[] = array( 'status' => 'published' );
			} elseif ( 'include' === $deleted && ( $spec['softDelete'] ?? false ) ) {
				$guards[] = array( 'OR' => array( array( 'status' => 'published' ), array( 'deletedAt' => array( 'isNotNull' => true ) ) ) );
			}
		}

		// If the app already restricts the scope, the keys must go through SQL anyway.
		return array( ...$guards, ...$this->store->readGuards( $collection, $viewer, $for_select || ( $select_when_restricted && array() !== $guards ) ) );
	}

	/**
	 * A `ref().many()` column holds no value of its own: its value is its links, the target ids in
	 * position order (storage form: JSON text), read with one query per such column.
	 *
	 * @param list<array<string, mixed>> $raw storage rows
	 * @return list<array<string, mixed>>
	 */
	private function with_links( string $collection, array $raw, ?array $only = null, bool $forUpdate = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$spec = $this->schema->collection( $collection );
		$pk   = $spec['primaryKey'];
		foreach ( array() === $raw ? array() : $spec['columns'] as $name => $col ) {
			if ( 'refList' !== $col['type'] || ( null !== $only && ! isset( $only[ $name ] ) ) ) {
				continue;
			}
			$ids = array();
			foreach ( $this->links()->links( $col['references']['join'], 'owner_id', array_column( $raw, $pk ), $forUpdate ) as $link ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$ids[ $link['owner_id'] ][] = $link['target_id'];
			}
			foreach ( $raw as &$row ) {
				$row[ $name ] = (string) json_encode( $ids[ (int) $row[ $pk ] ] ?? array() );
			}
			unset( $row );
		}

		return $raw;
	}

	private function links(): Links {
		return $this->store instanceof Links ? $this->store : throw new \LogicException( 'This store keeps no ref().many() links' );
	}

	/**
	 * A relation through a many-ref's join table: one query for the links, one for the related rows.
	 * The field's own list keeps position order unless `orderBy` sorts it; a reverse list follows the
	 * related rows' order. limit/offset apply per row.
	 */
	private function attach_through( array $rows, string $name, array $rel, array $opts, string $ptr, ?Viewer $viewer, callable $source_for, string $pk ): array {
		['table' => $join, 'from' => $from, 'to' => $to] = $rel['through'];
		foreach ( array( 'limit', 'offset' ) as $k ) {
			if ( isset( $opts[ $k ] ) && ( ! Js::isInteger( $opts[ $k ] ) || $opts[ $k ] < 0 ) ) {
				throw HttpError::invalidQuery( "$k must be a non-negative integer", $ptr . '/' . $k );
			}
		}
		[$limit, $offset] = array( isset( $opts['limit'] ) ? (int) $opts['limit'] : null, (int) ( $opts['offset'] ?? 0 ) );
		unset( $opts['limit'], $opts['offset'] );
		$owners = array_values( array_unique( array_map( static fn ( array $row ) => (int) $source_for( $row )[ $pk ], $rows ) ) );
		$linked = array();
		foreach ( $this->links()->links( $join, $from, $owners ) as $link ) {
			$linked[ $link[ $from ] ][] = $link[ $to ];
		}
		$target   = $this->schema->collection( $rel['collection'] );
		$child_pk = $target['primaryKey'];
		$ids      = array_values( array_unique( array_merge( array(), ...array_values( $linked ) ) ) );
		$values   = array_map( static fn ( $id ) => Schema::encode( $target['columns'][ $child_pk ], $id, $child_pk, '' ), $ids );
		// Read from the side that doesn't store the links: which rows are linked changes with a
		// write to any row of the other kind, so a page render that read them listed that kind.
		if ( 'target_id' === $from ) {
			Render\Reads::listed( $rel['collection'] );
		}
		$children   = $this->fetch( $rel['collection'], $opts, $ptr, $viewer, array( $child_pk, $values ), decoded: $child_decoded );
		$child_keys = array_map( static fn ( array $row ) => (int) $row[ $child_pk ], $child_decoded );
		$by_id      = array_combine( $child_keys, $this->project( $children, $rel['collection'], $opts, $ptr ) );
		$rank       = array_flip( $child_keys );
		$sorted     = 'target_id' === $from || isset( $opts['orderBy'] );
		foreach ( $rows as &$row ) {
			$list = array_values( array_filter( $linked[ (int) $source_for( $row )[ $pk ] ] ?? array(), static fn ( int $id ) => isset( $by_id[ $id ] ) ) );
			if ( $sorted ) {
				usort( $list, static fn ( int $a, int $b ) => $rank[ $a ] <=> $rank[ $b ] );
			}
			$row[ $name ] = array_map( static fn ( int $id ) => $by_id[ $id ], array_slice( $list, $offset, $limit ) );
		}
		unset( $row );

		return $rows;
	}

	/** Load each requested relation with one query, never N+1; populate media columns in place. */
	private function attach( string $collection, array $rows, mixed $with, string $ptr, ?Viewer $viewer, array $decoded ): array {
		if ( ! is_array( $with ) || ( array() !== $with && array_is_list( $with ) ) ) {
			throw HttpError::invalidQuery( 'with must be an object', $ptr );
		}
		$spec      = $this->schema->collection( $collection );
		$relations = $spec['relations'] ?? array();
		// Read transforms may remove a foreign key; keep linkage private while attaching relations.
		$sources    = array_column( $decoded, null, $spec['primaryKey'] );
		$source_for = static fn ( array $row ): array => $sources[ $row[ $spec['primaryKey'] ] ];
		foreach ( $with as $name => $opts ) {
			$name      = (string) $name;
			$rptr      = $ptr . HttpError::seg( $name );
			$media_col = $spec['columns'][ $name ] ?? null;
			if ( null !== $media_col && in_array( $media_col['type'], array( 'media', 'mediaList' ), true ) ) {
				if ( true === $opts ) {
					$rows = $this->populate_media( $rows, $name, 'mediaList' === $media_col['type'] );
				} elseif ( false !== $opts && null !== $opts ) {
					throw HttpError::invalidQuery( 'Media columns take `true`', $rptr );
				}
				continue;
			}
			$rel = $relations[ $name ] ?? throw HttpError::invalidQuery( "Unknown relation '$name'", $rptr );
			if ( false === $opts || null === $opts ) {
				continue;
			}
			$opts = true === $opts ? array() : $opts;
			if ( ! is_array( $opts ) ) {
				throw HttpError::invalidQuery( 'Relation options must be true or an object', $rptr );
			}
			if ( isset( $rel['through'] ) ) {
				$rows = $this->attach_through( $rows, $name, $rel, $opts, $rptr, $viewer, $source_for, $spec['primaryKey'] );
				continue;
			}
			// A `many` relation between localized collections resolves per parent (§7.3): a parent's
			// children in that parent row's locale, falling back per translation group like a top-level
			// read, one query per distinct parent locale (a nested `locale` overrides that). References
			// name one specific row, so when the relation starts at the parent's primary key, children of
			// any row in the parent's translation group belong to it, and limit/offset window per group.
			$parent_pk      = $spec['primaryKey'];
			$localized_many = 'many' === $rel['kind'] && $this->localized( $collection ) && $this->localized( $rel['collection'] );
			$per_locale     = $localized_many && ! array_key_exists( 'locale', $opts );
			$by_group       = $localized_many && $rel['from'] === $parent_pk;
			$default        = $per_locale ? $this->schema->locales()['default'] : null;
			$bucket_of      = static fn ( array $source ): string => $per_locale ? (string) ( $source['locale'] ?? $default ) : '';
			// A parent's window: its translation group (named by its smallest member), else its own key.
			$window_of = static function ( array $source ) use ( $by_group, $parent_pk, $rel ): string {
				if ( ! $by_group ) {
					return self::key( $source[ $rel['from'] ] );
				}
				$members = array_values( Locale\Module::members( $source, $parent_pk ) );
				usort( $members, static fn ( $a, $b ) => strcmp( self::key( $a ), self::key( $b ) ) );

				return self::key( $members[0] ?? $source[ $parent_pk ] );
			};
			$buckets   = array();
			foreach ( $rows as $row ) {
				$source               = $source_for( $row );
				$bucket               = $bucket_of( $source );
				$buckets[ $bucket ] ??= array();
				$window               = $window_of( $source );
				foreach ( $by_group ? Locale\Module::members( $source, $parent_pk ) : array( $source[ $rel['from'] ] ) as $v ) {
					if ( null !== $v ) {
						$buckets[ $bucket ][ self::key( $v ) ] = array( $v, $window );
					}
				}
			}
			if ( array() === $buckets ) {
				$buckets[ $per_locale ? (string) $default : '' ] = array(); // still checks access and options on the target
			}
			$target_cols = $this->schema->collection( $rel['collection'] )['columns'];
			$child_pk    = $this->schema->collection( $rel['collection'] )['primaryKey'];
			$groups      = array();
			foreach ( $buckets as $bucket => $keys ) {
				$bucket_opts   = $per_locale ? array( 'locale' => (string) $bucket ) + $opts : $opts;
				$values        = array_map(
					static fn ( array $k ) => Schema::encode( array( 'type' => $target_cols[ $rel['to'] ]['type'] ), $k[0], $rel['to'], '' ),
					array_values( $keys ),
				);
				$partition     = $by_group ? array( $rel['to'], $values, array_column( array_values( $keys ), 1 ) ) : array( $rel['to'], $values );
				$children      = $this->fetch( $rel['collection'], $bucket_opts, $rptr, $viewer, $partition, decoded: $child_decoded );
				$child_sources = array_column( $child_decoded, null, $child_pk );
				foreach ( $this->project( $children, $rel['collection'], $bucket_opts, $rptr ) as $i => $child ) {
					$to = self::key( $child_sources[ $children[ $i ][ $child_pk ] ][ $rel['to'] ] );
					$groups[ $bucket ][ $keys[ $to ][1] ?? $to ][] = $child;
				}
			}
			foreach ( $rows as &$row ) {
				$source       = $source_for( $row );
				$group        = null === $source[ $rel['from'] ] ? array() : ( $groups[ $bucket_of( $source ) ][ $window_of( $source ) ] ?? array() );
				$row[ $name ] = 'many' === $rel['kind'] ? $group : ( $group[0] ?? null );
			}
			unset( $row );
		}

		return $rows;
	}

	private function localized( string $collection ): bool {
		return $this->schema->locales() !== null && ( $this->schema->collection( $collection )['localized'] ?? false );
	}

	private function populate_media( array $rows, string $col, bool $list ): array { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.listFound -- Preserve the existing PHP parameter name.
		$ids = array();
		foreach ( $rows as $row ) {
			if ( ! array_key_exists( $col, $row ) ) {
				continue;
			}
			foreach ( $list ? ( $row[ $col ] ?? array() ) : array( $row[ $col ] ) as $id ) {
				if ( null !== $id ) {
					$ids[ $id ] = true;
				}
			}
		}
		$media = $this->media->getMany( array_keys( $ids ) );
		foreach ( $rows as &$row ) {
			if ( ! array_key_exists( $col, $row ) ) {
				continue;
			}
			if ( $list ) {
				$row[ $col ] = null === $row[ $col ] ? null : array_values( array_filter( array_map( static fn ( $id ) => $media[ $id ] ?? null, $row[ $col ] ) ) );
			} else {
				$row[ $col ] = null === $row[ $col ] ? null : ( $media[ $row[ $col ] ] ?? null );
			}
		}
		unset( $row );

		return $rows;
	}

	/** Apply the Drizzle `columns` selection (relations attached by `with` are kept). */
	private function project( array $rows, string $collection, array $opts, string $ptr ): array {
		$columns = $opts['columns'] ?? null;
		if ( null === $columns ) {
			return $rows;
		}
		$known = $this->schema->collection( $collection )['columns'];
		if ( ! is_array( $columns ) || ( array() !== $columns && array_is_list( $columns ) ) ) {
			throw HttpError::invalidQuery( 'columns must be an object', $ptr . '/columns' );
		}
		foreach ( $columns as $name => $on ) {
			if ( ! isset( $known[ $name ] ) ) {
				throw HttpError::invalidQuery( "Unknown column '$name'", $ptr . '/columns' . HttpError::seg( $name ) );
			}
		}
		$included = array_keys( array_filter( $columns, static fn ( $on ) => true === $on ) );
		$drop     = array() !== $included
			? array_diff( array_keys( $known ), $included )
			: array_keys( array_filter( $columns, static fn ( $on ) => false === $on ) );
		// A `ref()` field loaded by `with` holds the row in its id's place: `with` asked for it.
		$with = is_array( $opts['with'] ?? null ) ? array_keys( array_filter( $opts['with'], static fn ( $on ) => false !== $on && null !== $on ) ) : array();
		$drop = array_diff( $drop, array_map( 'strval', $with ) );
		$drop = array_flip( $drop );

		return array_map( static fn ( array $row ) => array_diff_key( $row, $drop ), $rows );
	}

	// ================================================================ writes

	/**
	 * @param ?callable(callable(): array): array $around per-row persistence continuation, after access checks
	 * @return ?list<array>
	 */
	public function insert( string $collection, array|JsObject|JsArray $values, bool $returning = false, ?Viewer $viewer = null, ?callable $around = null ): ?array {
		// Only the row containers unwrap here: a json() value inside a row keeps its `{}`.
		$values = Seam::container( $values );
		$rows   = array() !== $values && array_is_list( $values ) ? array_map( fn ( $r ) => Seam::toPhp( $r, $this->schema->collection( $collection )['columns'] ), $values ) : array( Seam::toPhp( $values, $this->schema->collection( $collection )['columns'] ) );

		return $this->nested(
			function () use ( $collection, $rows, $returning, $viewer, $around ) {
				$spec = $this->schema->collection( $collection );
				$out  = array();
				foreach ( $rows as $data ) {
					if ( ! is_array( $data ) || ( array() !== $data && array_is_list( $data ) ) ) {
						throw HttpError::invalidInput( 'Each row must be an object', '' );
					}
					$data = array_filter( $data, static fn ( mixed $v ): bool => JsUndefined::Value !== $v );
					$data = Schema::resolveAliases( $spec, $data );
					// One instant per row: every `now` default, nested ones and publishedAt included.
					$out[] = Js::atInstant( fn () => $this->create_one( $collection, $spec, $data, $viewer, $around ) );
				}

				return $returning ? $this->present( $out, $collection, $viewer ) : null;
			}
		);
	}

	/** @return ?list<array> */
	public function update( string $collection, array|JsObject $set, array|JsObject $where, bool $returning = false, ?Viewer $viewer = null, ?Viewer $errorViewer = null ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		[$set, $where] = array( Seam::container( $set ), Seam::filter( $collection, $where, $this->schema ) );
		// Flattened before the access rule sees the patch: rules get plain arrays outside json() values.
		// In update(), `undefined` means untouched (omitted) while `null` clears nullable fields.
		$set = Seam::toPhp( $set, $this->schema->collection( $collection )['columns'] );
		if ( is_array( $set ) ) {
			$set = array_filter( $set, static fn ( mixed $v ): bool => JsUndefined::Value !== $v );
		}
		$set = Schema::resolveAliases( $this->schema->collection( $collection ), $set );
		return $this->nested(
			function () use ( $collection, $set, $where, $returning, $viewer, $errorViewer ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$spec   = $this->schema->collection( $collection );
				$guards = null === $viewer ? array() : $this->write_guards( $collection, 'update', $viewer, $set );
				$out    = array();
				$opts   = array( 'where' => $where );
				// A referential update must use the same current rows the delete preflight locked.
				$rows         = $this->select_decoded( $collection, $opts, '', null, null, $guards, $viewer, forUpdate: null !== $viewer && array() !== $this->deleting );
				$pk           = $spec['primaryKey'];
				$bulk         = new BulkUpdate( $collection, $spec, $set, $viewer, array_map( static fn ( array $row ) => self::key( $row[ $pk ] ), $rows ), $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$this->bulk[] = $bulk;
				try {
					foreach ( $rows as $existing ) {
						$key = self::key( $existing[ $pk ] );
						if ( isset( $bulk->done[ $key ] ) ) {
							$out[] = $bulk->done[ $key ]; // written early by updateWithin
							continue;
						}
						unset( $bulk->pending[ $key ] );
						$bulk->current = $key;
						$out[]         = Js::atInstant( fn () => $this->update_one( $collection, $spec, $existing, $set, $viewer, errorViewer: $errorViewer ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					}
				} finally {
					array_pop( $this->bulk );
				}

				return $returning ? $this->present( $out, $collection, $viewer ) : null;
			}
		);
	}

	/** @return ?list<array> */
	public function delete( string $collection, array|JsObject $where, bool $returning = false, ?Viewer $viewer = null ): ?array {
		$where = Seam::filter( $collection, $where, $this->schema );
		return $this->nested(
			function () use ( $collection, $where, $returning, $viewer ) {
				$guards = null === $viewer ? array() : $this->write_guards( $collection, 'delete', $viewer, null );
				$opts   = array( 'where' => $where );
				$rows   = $this->select_decoded( $collection, $opts, '', null, null, $guards, $viewer, forUpdate: null !== $viewer );
				$out    = $this->delete_rows( $collection, $rows, $viewer );

				return $returning ? $this->present( $out, $collection, $viewer ) : null;
			}
		);
	}

	/**
	 * Restore soft-deleted rows matching $where (and any cascade-deleted children sharing their deletedGroup).
	 * Requires `restore` access (which defaults to `delete` access).
	 *
	 * @return ?list<array>
	 */
	public function restore( string $collection, array|JsObject $where, bool $returning = false, ?Viewer $viewer = null ): ?array {
		$where = Seam::filter( $collection, $where, $this->schema );
		return $this->nested(
			function () use ( $collection, $where, $returning, $viewer ) {
				$spec = $this->schema->collection( $collection );
				if ( ! ( $spec['softDelete'] ?? false ) ) {
					throw HttpError::invalidQuery( "`$collection` does not use softDelete" );
				}
				$guards = null === $viewer ? array() : $this->write_guards( $collection, 'restore', $viewer, null );
				$opts   = array(
					'where'   => $where,
					'deleted' => 'only',
				);
				$rows   = $this->select_decoded( $collection, $opts, '', null, null, $guards, $viewer );
				$out    = array();
				foreach ( $rows as $row ) {
					$out[] = $this->restore_one( $collection, $row, $viewer );
				}

				return $returning ? $this->present( $out, $collection, $viewer ) : null;
			}
		);
	}

	/**
	 * Permanently delete rows matching $where (active or soft-deleted). Default access is `"system"` (denied to untrusted callers).
	 *
	 * @return ?list<array>
	 */
	public function purge( string $collection, array|JsObject $where, bool $returning = false, ?Viewer $viewer = null, bool $onlyDeleted = false ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$where = Seam::filter( $collection, $where, $this->schema );
		return $this->nested(
			function () use ( $collection, $where, $returning, $viewer, $onlyDeleted ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$spec   = $this->schema->collection( $collection );
				$guards = null === $viewer ? array() : $this->write_guards( $collection, 'purge', $viewer, null );
				$opts   = array( 'where' => $where );
				if ( $spec['softDelete'] ?? false ) {
					$opts['deleted'] = $onlyDeleted ? 'only' : 'include'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				}
				$rows = $this->select_decoded( $collection, $opts, '', null, null, $guards, $viewer, forUpdate: null !== $viewer );
				$this->purge_rows( $collection, $rows, $viewer );

				return $returning ? $this->present( $rows, $collection, $viewer ) : null;
			}
		);
	}

	/** update/delete rule → filters for the row select; throws 401/403 when false. */
	private function write_guards( string $collection, string $op, Viewer $viewer, ?array $data ): array {
		$r = $this->current( fn () => Access::evaluate( Access::collectionRules( $this->schema->collection( $collection ) )[ $op ], $viewer, $op, $data, $this->schema->collection( $collection )['columns'], $collection ) );
		if ( false === $r ) {
			throw Access::deny( $viewer->user, "$op $collection rows" );
		}

		return is_array( $r ) ? array( $r ) : array();
	}

	/** The canonical default preview and write share constraint preflight before generators run. */
	public function withDefaults( string $collection, array $data, ?Viewer $viewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current(
			function () use ( $collection, $data, $viewer ): array {
				$columns     = $this->schema->collection( $collection )['columns'];
				$generations = array();
				foreach ( $columns as $name => $col ) {
					if ( ! array_key_exists( $name, $data ) && isset( $col['default'] ) ) {
						$generations[ $name ] = $col['default'];
					}
				}
				$this->requireGeneratedVisibility( $collection, $generations, $viewer );
				foreach ( $generations as $name => $generation ) {
					$data[ $name ] = Schema::generate( $generation, $columns[ $name ] );
				}

				return $data;
			}
		);
	}

	private function create_one( string $collection, array $spec, array $data, ?Viewer $viewer, ?callable $around = null ): array {
		$columns  = $spec['columns'];
		$provided = $data;
		Extensions::input( 'create', $collection, $data, null, $viewer, $provided );
		$this->reject_unknown( $columns, $data );
		$status_given = array_key_exists( 'status', $data );
		$data         = $this->withDefaults( $collection, $data, $viewer );
		if ( isset( $columns['author'] ) && ( $columns['author']['system'] ?? false ) && ( $columns['author']['readOnly'] ?? false ) && ! array_key_exists( 'author', $data ) ) {
			$data['author'] = $this->actor['id'] ?? null;
		}
		if ( $spec['drafts'] ?? false ) {
			$data = $this->draft_rules( $data, $status_given ? null : 'published', null );
		}
		Extensions::write( 'create', $collection, $data, null, $viewer, $provided );
		$this->reject_unknown( $columns, $data, null, true );
		$fills = $spec['beforeCreateFills'] ?? array();
		foreach ( $columns as $name => $col ) {
			if ( Schema::isRequired( $col ) && ! array_key_exists( $name, $data ) && ! in_array( $name, $fills, true )
				&& ( $spec['slug'] ?? null ) !== $name ) {
				throw HttpError::invalidInput( "$name is required", HttpError::seg( $name ) );
			}
		}
		if ( null !== $viewer ) {
			$this->current( fn () => Access::require( Access::collectionRules( $spec )['create'], $viewer, 'create', $data, "create $collection rows", $columns ) );
		}
		$write = fn (): array => $this->persist_create( $collection, $spec, $data, $viewer );

		return null === $around ? $write() : $around( $write );
	}

	private function persist_create( string $collection, array $spec, array $data, ?Viewer $viewer ): array {
		$columns = $spec['columns'];
		$ctx     = $this->hookCtx();
		if ( isset( $spec['hooks']['beforeCreate'] ) ) {
			$slot = $spec['hooks']['beforeCreate'];
			if ( is_string( $slot ) ) {
				$fn = '\\SpacePressApp\\' . $slot;
				// Fields a runtime schema change added (spec §2.10) are kept aside: the compiled hook
				// never saw them, and a replacement object it returns must not drop them.
				[$data, $runtime] = RuntimeSchema\Loader::split( $spec, $data, RuntimeSchema\Loader::compiled() ?? array( 'collections' => array() ) );
				$js_ctx           = Seam::ctx( $ctx + array( 'data' => $data ), $columns );
				$data             = $js_ctx->p['data'];
				$result           = $fn( $data, $js_ctx );
				$data             = Seam::rowToPhp( $collection, $result instanceof JsObject ? $result : $data ) + $runtime;
			} else {
				$result = $slot( $data, $ctx );
				if ( is_array( $result ) ) {
					$data = $result; }
			}
			$this->reject_unknown( $columns, $data, null, true );
		}

		$norm = array();
		foreach ( $columns as $name => $col ) {
			$name = (string) $name;
			if ( $this->derives_slug( $spec, $name, $data, ! array_key_exists( $name, $data ) ) ) {
				continue;
			}
			if ( array_key_exists( $name, $data ) ) {
				$norm[ $name ] = Schema::normalize( $col, $data[ $name ], $name, HttpError::seg( $name ) );
			} elseif ( Schema::isRequired( $col ) ) {
				throw HttpError::invalidInput( "$name is required", HttpError::seg( $name ) );
			}
		}
		$this->requireUniqueVisibility( $collection, $norm, $viewer, true );
		$slug_col = $spec['slug'] ?? null;
		if ( null !== $slug_col && ! array_key_exists( $slug_col, $norm ) ) {
			$norm[ $slug_col ] = $this->derive_slug( $collection, $spec, $norm, null );
		}
		$full = $norm + array_fill_keys( array_keys( $columns ), null );
		$this->check_values( $columns, $norm, $full, $viewer );
		$this->requireUniqueVisibility( $collection, $norm, $viewer );

		$insert = $links = array(); // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
		foreach ( $norm as $name => $v ) {
			if ( 'refList' === $columns[ $name ]['type'] ) {
				$links[ $name ] = $v ?? array();
				continue;
			}
			$insert[ $name ] = Schema::store( $columns[ $name ], $v );
		}
		try {
			$pk = $this->store->insert( $collection, $insert );
			$this->writeLinks( $columns, $pk, $links );
		} catch ( \Throwable $e ) {
			throw $this->store->mapError( $e );
		}
		Access::clearCache();
		[$row, $raw]  = $this->read_by_pk( $collection, $spec, $pk );
		$pk_column    = $spec['primaryKey'];
		$allocatedKey = ( $columns[ $pk_column ]['autoIncrement'] ?? false ) && ! array_key_exists( $pk_column, $insert ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$this->record_revision( $collection, $spec, $pk, $raw, 'create', null, $row, $allocatedKey ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$this->hook( $collection, $spec, 'afterCreate', $row );
		$this->published( $collection, $spec, $row, null );
		Extensions::written( 'create', $collection, $row, null );

		return $row;
	}

	/** @param array $values trusted values applied over $patch after access and field rules (updateWithin) */
	private function update_one( string $collection, array $spec, array $existing, array $patch, ?Viewer $viewer, array $values = array(), ?Viewer $errorViewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$columns  = $spec['columns'];
		$pk       = $spec['primaryKey'];
		$provided = $patch;
		Extensions::input( 'update', $collection, $patch, $existing, $viewer, $provided );
		$this->check_patch( $spec, $existing, $patch );
		$generations = array();
		foreach ( $columns as $name => $col ) {
			if ( isset( $col['onUpdate'] ) && ! array_key_exists( $name, $patch ) ) {
				$generations[ $name ] = $col['onUpdate'];
			}
		}
		$this->requireGeneratedVisibility( $collection, $generations, $viewer ?? $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		foreach ( $columns as $name => $col ) {
			if ( isset( $col['onUpdate'] ) && ! array_key_exists( $name, $patch ) ) {
				$patch[ $name ] = Schema::generate( $col['onUpdate'], $col );
			}
		}
		if ( ( $spec['drafts'] ?? false ) && ( array_key_exists( 'status', $patch ) || array_key_exists( 'publishedAt', $patch ) ) ) {
			$patch = $this->draft_rules( $patch, null, $existing );
		}
		$previous = $existing;
		Extensions::write( 'update', $collection, $patch, $previous, $viewer, $provided );
		$patch = $values + $patch;
		$this->check_patch( $spec, $previous, $patch, true );
		$ctx = $this->hookCtx();
		if ( isset( $spec['hooks']['beforeUpdate'] ) ) {
			$slot = $spec['hooks']['beforeUpdate'];
			if ( is_string( $slot ) ) {
				$fn                = '\\SpacePressApp\\' . $slot;
				[$patch, $runtime] = RuntimeSchema\Loader::split( $spec, $patch, RuntimeSchema\Loader::compiled() ?? array( 'collections' => array() ) );
				$js_ctx            = Seam::ctx( $ctx + array( 'data' => $patch ), $columns );
				$patch             = $js_ctx->p['data'];
				$result            = $fn( $patch, Seam::rowToJs( $collection, $existing ), $js_ctx );
				$patch             = Seam::rowToPhp( $collection, $result instanceof JsObject ? $result : $patch ) + $runtime;
			} else {
				$result = $slot( $patch, $existing, $ctx );
				if ( is_array( $result ) ) {
					$patch = $result; }
			}
			$this->check_patch( $spec, $previous, $patch, true );
		}
		unset( $patch[ $pk ] );
		$norm = array();
		foreach ( $patch as $name => $value ) {
			$name = (string) $name;
			if ( $this->derives_slug( $spec, $name, $patch, false ) ) {
				continue;
			}
			$norm[ $name ] = Schema::normalize( $columns[ $name ], $value, $name, HttpError::seg( $name ) );
		}
		$slug_col   = $spec['slug'] ?? null;
		$pk_value   = $this->pk_value( $spec, $previous );
		$publishing = ( $spec['drafts'] ?? false )
			&& ( $previous['status'] ?? null ) === 'draft'
			&& in_array( $norm['status'] ?? null, array( 'published', 'scheduled' ), true );
		if ( $publishing && null !== $slug_col ) {
			// WordPress drafts may share slugs. Publication is a new uniqueness operation, even
			// when the readable draft's slug was echoed or omitted from the patch.
			$this->requireUniqueVisibility( $collection, array( $slug_col => $patch[ $slug_col ] ?? $previous[ $slug_col ] ?? null ), $viewer ?? $errorViewer, true ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			if ( ! array_key_exists( $slug_col, $patch ) ) {
				$norm[ $slug_col ] = $previous[ $slug_col ] ?? null;
			}
		}
		$this->requireUniqueVisibility( $collection, $patch, $viewer ?? $errorViewer, existing: $previous ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( null !== $slug_col && array_key_exists( $slug_col, $patch ) && ! array_key_exists( $slug_col, $norm ) ) {
			$norm[ $slug_col ] = $this->derive_slug( $collection, $spec, $norm + $previous, $pk_value );
		}
		$this->check_values( $columns, $norm, $norm + $previous, $viewer ?? $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$this->requireUniqueVisibility( $collection, $norm, $viewer ?? $errorViewer, existing: $previous ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$set = $links = array(); // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
		foreach ( $norm as $name => $v ) {
			if ( 'refList' === $columns[ $name ]['type'] ) {
				$links[ $name ] = $v ?? array();
				continue;
			}
			if ( ! ( $publishing && $name === $slug_col ) && $this->unchangedReadableUnique( $collection, (string) $name, $v, $previous, $viewer ?? $errorViewer ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				continue; // WordPress meta uniqueness checks must not inspect competitors for a no-op.
			}
			$set[ $name ] = Schema::store( $columns[ $name ], $v );
		}
		$this->require_incoming_visibility( $collection, $set, $viewer ?? $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		Locale\GroupSync::requireReadableSiblings( $collection, $norm + $previous, $previous, $viewer ?? $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		try {
			$this->store->update( $collection, $pk_value, $set );
			$this->writeLinks( $columns, $pk_value, $links );
		} catch ( \Throwable $e ) {
			throw $this->store->mapError( $e );
		}
		Access::clearCache();
		[$row, $raw] = $this->read_by_pk( $collection, $spec, $pk_value );
		$this->record_revision( $collection, $spec, $pk_value, $raw, 'update', $previous, $row );
		$this->hook( $collection, $spec, 'afterUpdate', $row, $previous );
		$this->published( $collection, $spec, $row, $previous );
		Extensions::written( 'update', $collection, $row, $previous, $viewer ?? $errorViewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.

		return $row;
	}

	/** A many-ref write replaces the row's whole list. @param array<string, list<int>> $links */
	public function writeLinks( array $columns, int|string $pk, array $links ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		foreach ( $links as $name => $ids ) {
			$this->links()->setLinks( $columns[ $name ]['references']['join'], $pk, $ids );
		}
	}

	/** A prior row's cascade can delete a later row in the same selection. @return list<array> */
	private function delete_rows( string $collection, array $rows, ?Viewer $viewer, ?string $group = null ): array {
		$root            = null === $this->deleted;
		$this->deleted ??= array();
		$selected_at     = $this->deleteSequence; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$spec            = $this->schema->collection( $collection );
		$out             = array();
		try {
			foreach ( $rows as $row ) {
				$pk = $this->pk_value( $spec, $row );
				if ( ( $this->deleted[ $collection ][ $pk ] ?? 0 ) <= $selected_at ) {
					$deleted = $this->delete_one( $collection, $spec, $row, $pk, $viewer, $group );
					$out[]   = $deleted ?? $this->deletedRows[ $collection ][ $pk ] ?? $row; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				} else {
					$out[] = $this->deletedRows[ $collection ][ $pk ] ?? $row; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				}
			}

			return $out;
		} finally {
			if ( $root ) {
				$this->deleted        = null;
				$this->deletedRows    = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->deleteSequence = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			}
		}
	}

	private function delete_one( string $collection, array $spec, array $row, int|string $pk, ?Viewer $viewer, ?string $group = null ): ?array {
		if ( isset( $this->deleting[ $collection ][ $pk ] ) ) {
			return null;
		}
		$this->deleting[ $collection ][ $pk ] = $pk;
		try {
			$existing = $row;
			Extensions::write( 'delete', $collection, $row, $existing, $viewer, $existing );
			$this->hook( $collection, $spec, 'beforeDelete', $row );
			if ( ( $spec['softDelete'] ?? false ) && method_exists( $this->store, 'softDelete' ) ) {
				$group ??= $this->activeDeleteGroup ?? self::uuid(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->soft_referential_actions( $collection, $row, $group, $viewer );
				$at     = Js::iso( Js::now() );
				$userId = $this->actor['id'] ?? null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				try {
					$this->store->softDelete( $collection, $pk, $at, is_int( $userId ) ? $userId : null, $group ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				} catch ( \Throwable $e ) {
					throw $this->store->mapError( $e );
				}
				Access::clearCache();
				$row['deletedAt'] = $at;
				$row['deletedBy'] = is_int( $userId ) ? $userId : null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( array_key_exists( 'deletedGroup', $row ) ) {
					$row['deletedGroup'] = $group;
				}
				if ( array_key_exists( '_live', $row ) ) {
					$row['_live'] = null;
				}
				$this->deleted[ $collection ][ $pk ]     = ++$this->deleteSequence; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->deletedRows[ $collection ][ $pk ] = $row; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				if ( $spec['revisions'] ?? false ) {
					[, $raw_deleted] = $this->read_by_pk( $collection, $spec, $pk, deleted: 'include' );
					$this->record_revision( $collection, $spec, $pk, $raw_deleted, 'delete', $existing, $row );
				}
				$this->hook( $collection, $spec, 'afterDelete', $row );
				Extensions::written( 'delete', $collection, $row, $existing );

				return $row;
			}
			$this->referential_actions( $collection, $row, $viewer );
			try {
				$this->store->delete( $collection, $pk );
			} catch ( \Throwable $e ) {
				throw $this->store->mapError( $e );
			}
			Access::clearCache();
			$this->deleted[ $collection ][ $pk ]     = ++$this->deleteSequence; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->deletedRows[ $collection ][ $pk ] = $row; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->hook( $collection, $spec, 'afterDelete', $row );
			Extensions::written( 'delete', $collection, $row, $existing );

			return $row;
		} finally {
			unset( $this->deleting[ $collection ][ $pk ] );
		}
	}

	private function restore_one( string $collection, array $row, ?Viewer $viewer, bool $cascade_children = true ): array {
		$spec     = $this->schema->collection( $collection );
		$pk_value = $this->pk_value( $spec, $row );
		$group    = is_string( $row['deletedGroup'] ?? null ) && '' !== $row['deletedGroup'] ? $row['deletedGroup'] : null;
		$this->hook( $collection, $spec, 'beforeRestore', $row );
		try {
			$this->store->restore( $collection, $pk_value );
		} catch ( \Throwable $e ) {
			throw $this->store->mapError( $e );
		}
		Access::clearCache();
		if ( $cascade_children && ! $this->restoringGroup && null !== $group ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->restore_group_children( $collection, $pk_value, $group, $viewer );
		}
		[$restored, $raw_restored] = $this->read_by_pk( $collection, $spec, $pk_value );
		$this->record_revision( $collection, $spec, $pk_value, $raw_restored, 'restore', $row, $restored );
		$this->hook( $collection, $spec, 'afterRestore', $restored );
		Extensions::written( 'update', $collection, $restored, $row );

		return $restored;
	}

	/** Restore any soft-deleted children across kinds that were cascade-deleted under the same deletedGroup. */
	private function restore_group_children( string $parent_collection, int|string $parent_pk, string $group, ?Viewer $viewer ): void {
		$prev                 = $this->restoringGroup; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$this->restoringGroup = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		try {
			foreach ( $this->schema->kinds() as $child => $cspec ) {
				if ( ! ( $cspec['softDelete'] ?? false ) || ! isset( $cspec['columns']['deletedGroup'] ) ) {
					continue;
				}
				$opts       = array(
					'where'   => array( 'deletedGroup' => $group ),
					'deleted' => 'only',
				);
				$dependents = $this->select_decoded( (string) $child, $opts, '', null );
				$cpk        = $cspec['primaryKey'];
				foreach ( $dependents as $dep ) {
					if ( (string) $child === $parent_collection && (string) $dep[ $cpk ] === (string) $parent_pk ) {
						continue;
					}
					if ( null !== $viewer ) {
						try {
							$restored = $this->restore( (string) $child, array( $cpk => $dep[ $cpk ] ), true, $viewer ) ?? array();
						} catch ( \Throwable $e ) {
							error_log( '[spacepress] a restore side effect refused: ' . $e::class . ': ' . $e->getMessage() );
							throw self::hidden_reference();
						}
						if ( count( $restored ) !== 1 ) {
							throw self::hidden_reference();
						}
					} else {
						$this->nested( fn () => $this->restore_one( (string) $child, $dep, null, cascade_children: false ) );
					}
				}
			}
		} finally {
			$this->restoringGroup = $prev; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		}
	}

	/** A prior row's cascade purge can purge a later row in the same selection. */
	private function purge_rows( string $collection, array $rows, ?Viewer $viewer ): void {
		$root            = null === $this->deleted;
		$this->deleted ??= array();
		$selected_at     = $this->deleteSequence; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
		$spec            = $this->schema->collection( $collection );
		try {
			foreach ( $rows as $row ) {
				$pk = $this->pk_value( $spec, $row );
				if ( ( $this->deleted[ $collection ][ $pk ] ?? 0 ) <= $selected_at ) {
					$this->purge_one( $collection, $spec, $row, $pk, $viewer );
				}
			}
		} finally {
			if ( $root ) {
				$this->deleted        = null;
				$this->deletedRows    = array(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				$this->deleteSequence = 0; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			}
		}
	}

	private function purge_one( string $collection, array $spec, array $row, int|string $pk_value, ?Viewer $viewer ): void {
		if ( isset( $this->deleting[ $collection ][ $pk_value ] ) ) {
			return;
		}
		$this->deleting[ $collection ][ $pk_value ] = $pk_value;
		try {
			$existing = $row;
			$this->hook( $collection, $spec, 'beforePurge', $row );
			if ( $spec['revisions'] ?? false ) {
				[, $raw_purged] = $this->read_by_pk( $collection, $spec, $pk_value, deleted: 'include' );
				$this->record_revision( $collection, $spec, $pk_value, $raw_purged, 'purge', $existing, null );
			}
			$this->referential_actions( $collection, $row, $viewer, purge: true );
			try {
				$this->store->delete( $collection, $pk_value );
			} catch ( \Throwable $e ) {
				throw $this->store->mapError( $e );
			}
			$this->deleted[ $collection ][ $pk_value ] = ++$this->deleteSequence; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->hook( $collection, $spec, 'afterPurge', $row );
			Extensions::written( 'delete', $collection, $row, $existing );
		} finally {
			unset( $this->deleting[ $collection ][ $pk_value ] );
		}
	}

	/** Referential actions for soft delete: enforces restrict against active children, cascades deletedGroup, preserves many-ref links for restore. */
	private function soft_referential_actions( string $collection, array $row, string $group, ?Viewer $viewer = null ): void {
		if ( null !== $viewer ) {
			$this->refuse_hidden_references( $collection, $row, $viewer );
		}
		foreach ( $this->schema->kinds() as $child => $cspec ) {
			foreach ( $cspec['columns'] as $col => $c ) {
				$ref = $c['references'] ?? null;
				if ( 'refList' === $c['type'] ) {
					// Links are preserved on soft delete so restore() recovers them intact; still enforce `restrict` against active owners.
					if ( null === $ref || $ref['collection'] !== $collection || str_starts_with( $ref['join'], 'term:' ) ) {
						continue;
					}
					if ( strtolower( $ref['onDelete'] ?? 'cascade' ) === 'restrict' ) {
						$id    = $row[ $ref['column'] ];
						$links = $this->links()->links( $ref['join'], 'target_id', array( $id ), forUpdate: null !== $viewer );
						if ( array() !== $links ) {
							$owners = array_values( array_unique( array_column( $links, 'owner_id' ) ) );
							$cpk    = $cspec['primaryKey'];
							$opts   = array(
								'where' => array( $cpk => array( 'in' => $owners ) ),
								'limit' => 1,
							);
							if ( $this->select_decoded( (string) $child, $opts, '', null, forUpdate: null !== $viewer ) !== array() ) {
								throw new HttpError( 409, 'reference_violation', "Rows in $child still link to this row" );
							}
						}
					}
					continue;
				}
				if ( null === $ref || $ref['collection'] !== $collection || null === $row[ $ref['column'] ] ) {
					continue;
				}
				$where  = array( $col => $row[ $ref['column'] ] );
				$opts   = array(
					'where' => $where,
					'limit' => 1,
				);
				$action = strtolower( $ref['onDelete'] ?? 'no action' );
				if ( 'cascade' === $action ) {
					$dep_opts   = array( 'where' => $where );
					$dependents = array_values(
						array_filter(
							$this->select_decoded( (string) $child, $dep_opts, '', null, forUpdate: null !== $viewer ),
							fn ( array $dependent ): bool => ! isset( $this->deleting[ $child ][ $this->pk_value( $cspec, $dependent ) ] ),
						)
					);
					if ( array() === $dependents ) {
						continue;
					}
					if ( null !== $viewer ) {
						$cpk                     = $cspec['primaryKey'];
						$prev_group              = $this->activeDeleteGroup; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
						$this->activeDeleteGroup = $group; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
						$written                 = 0;
						try {
							foreach ( $dependents as $dependent ) {
								$written += count( $this->delete( (string) $child, array( $cpk => $dependent[ $cpk ] ), true, $viewer ) ?? array() );
							}
						} catch ( \Throwable $e ) {
							error_log( '[spacepress] a soft-delete cascade refused: ' . $e::class . ': ' . $e->getMessage() );
							throw self::hidden_reference();
						} finally {
							$this->activeDeleteGroup = $prev_group; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
						}
						if ( $written !== count( $dependents ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
							throw self::hidden_reference();
						}
					} else {
						$this->nested( fn () => $this->delete_rows( (string) $child, $dependents, null, $group ) );
					}
				} elseif ( 'set null' === $action || 'set default' === $action ) {
					$dep_opts   = array( 'where' => $where );
					$dependents = $this->select_decoded( (string) $child, $dep_opts, '', null, forUpdate: null !== $viewer );
					if ( array() === $dependents ) {
						continue;
					}
					if ( null !== $viewer ) {
						$cpk     = $cspec['primaryKey'];
						$written = 0;
						try {
							foreach ( $dependents as $dependent ) {
								$value    = 'set default' === $action && isset( $c['default'] ) ? Schema::generate( $c['default'], $c ) : null;
								$written += count( $this->update( (string) $child, array( $col => $value ), array( $cpk => $dependent[ $cpk ] ), true, $viewer ) ?? array() );
							}
						} catch ( \Throwable $e ) {
							error_log( '[spacepress] a soft-delete set-null/default refused: ' . $e::class . ': ' . $e->getMessage() );
							throw self::hidden_reference();
						}
						if ( $written !== count( $dependents ) ) { // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
							throw self::hidden_reference();
						}
					} else {
						$value = 'set default' === $action && isset( $c['default'] ) ? Schema::generate( $c['default'], $c ) : null;
						$this->update( (string) $child, array( $col => $value ), $where );
					}
				} elseif ( $this->select_decoded( (string) $child, $opts, '', null, forUpdate: null !== $viewer ) !== array() ) {
					throw new HttpError( 409, 'reference_violation', "Rows in $child still reference this row" );
				}
			}
		}
	}

	private static function uuid(): string {
		$b    = random_bytes( 16 );
		$b[6] = chr( ( ord( $b[6] ) & 0x0f ) | 0x40 );
		$b[8] = chr( ( ord( $b[8] ) & 0x3f ) | 0x80 );

		return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $b ), 4 ) );
	}

	/** Run the viewer's delete visibility check inside the transaction that will remove the row. */
	public function requireDeleteVisibility( string $collection, array $row, Viewer $viewer ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->refuse_hidden_references( $collection, $row, $viewer );
	}

	/**
	 * Before a viewer's delete writes anything: every row that references this one must be readable by
	 * the viewer (docs/decisions/2026-11-16-per-row-delete-visibility.md). The rows referencing this
	 * row are counted twice in SQL using current, locking reads on MySQL, trusted and as the viewer.
	 * WordPress's trash is included. Visible cascades are followed to every depth. Any difference,
	 * a referencing column or referenced key that may be hidden, or a read extension that may hide rows, is the one refusal
	 * ({@see hiddenReference()}). What the delete then does to those rows is the viewer's own writes
	 * ({@see viewerReferentialWrites()}).
	 */
	private function refuse_hidden_references( string $collection, array $row, Viewer $viewer, array &$seen = array() ): void {
		$parent = $this->schema->collection( $collection );
		$at     = $collection . ':' . self::key( $row[ $parent['primaryKey'] ] );
		if ( isset( $seen[ $at ] ) ) {
			return;
		}
		$seen[ $at ] = true;
		// WordPress reparents child terms on delete. The implicit parent column has no schema reference.
		if ( ( $parent['taxonomy'] ?? false ) && ( $parent['hierarchical'] ?? false ) && isset( $parent['columns']['parent'] ) ) {
			$pk = $parent['primaryKey'];
			if ( FieldAccess::mayHide( $parent['columns'][ $pk ], $viewer ) || FieldAccess::mayHide( $parent['columns']['parent'], $viewer )
				|| ! Extensions::constraintReadsSafe() ) {
				throw self::hidden_reference();
			}
			$this->has_only_readable_rows( $collection, array( 'parent' => $row[ $pk ] ), $viewer );
		}
		// Every relationship to this kind, before any is skipped for a null key: whether a hidden key
		// is null is itself what the viewer can't read.
		foreach ( $this->relationships( $collection ) as [, , , $def] ) {
			if ( FieldAccess::mayHide( $parent['columns'][ $def['references']['column'] ], $viewer ) || FieldAccess::mayHide( $def, $viewer )
				|| ! Extensions::constraintReadsSafe() ) {
				throw self::hidden_reference();
			}
		}
		foreach ( $this->referencing( $collection, $row ) as [$child, $spec, $col, $def, $where] ) {
			if ( ! $this->has_only_readable_rows( $child, $where, $viewer ) ) {
				continue;
			}
			if ( 'refList' !== $def['type'] && strtolower( $def['references']['onDelete'] ?? 'no action' ) === 'cascade' ) {
				foreach ( $this->referencing_rows( $child, $spec, $where, $viewer ) as $dependent ) {
					$this->refuse_hidden_references( $child, $dependent, $viewer, $seen );
				}
			}
		}
	}

	/** Whether any rows match. Refuses the write if any matching row is hidden. */
	private function has_only_readable_rows( string $collection, array $where, Viewer $viewer, bool $include_trash = true ): bool {
		$trusted = $this->count_rows( $collection, $where, null, $include_trash );
		if ( 0 === $trusted ) {
			return false;
		}
		try {
			$visible = $this->count_rows( $collection, $where, $viewer, $include_trash );
		} catch ( HttpError ) {
			throw self::hidden_reference();
		}
		if ( $visible !== $trusted ) {
			throw self::hidden_reference();
		}

		return true;
	}

	/** Check the visibility of a pipeline write's translation siblings before propagation. */
	public function requireReadableTranslations( string $collection, array $ids, Viewer $viewer ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( array() === $ids ) {
			return;
		}
		if ( ! Extensions::constraintReadsSafe() ) {
			throw self::hidden_reference();
		}
		$pk = $this->schema->collection( $collection )['primaryKey'];
		$this->has_only_readable_rows( $collection, array( $pk => array( 'in' => $ids ) ), $viewer, include_trash: false );
	}

	/**
	 * What a viewer's delete does to the rows that reference it is that viewer's own writes, through
	 * the path a direct request takes: a cascade is their delete of each child, set null / set default
	 * their update of it, and a `ref().many()` link (a taxonomy's terms too) their update of the owner
	 * without that id. Collection and field rules see the real patch; hooks, extensions and listeners
	 * run as for a direct write. Any refusal, or a row their rule doesn't reach, is the one refusal,
	 * and the request's transaction rolls the whole delete back.
	 */
	private function viewer_referential_writes( string $collection, array $row, Viewer $viewer ): void {
		foreach ( $this->referencing( $collection, $row, skip_active_cascades: true ) as [$child, $spec, $col, $def, $where] ) {
			$many     = 'refList' === $def['type'];
			$action   = strtolower( $def['references']['onDelete'] ?? ( $many ? 'cascade' : 'no action' ) );
			$expected = $this->count_rows( $child, $where, null );
			if ( 0 === $expected ) {
				continue; // nothing to write: no generator runs either
			}
			if ( ! in_array( $action, array( 'cascade', 'set null', 'set default' ), true ) ) {
				// restrict: every referencing row is one the viewer reads (refuseHiddenReferences), so
				// the refusal may say where they are, as a trusted delete's does.
				throw new HttpError( 409, 'reference_violation', $many ? "Rows in $child still link to this row" : "Rows in $child still reference this row" );
			}
			$pk      = $spec['primaryKey'];
			$target  = $row[ $def['references']['column'] ];
			$written = 0;
			$write   = function () use ( $child, $spec, $col, $def, $where, $viewer, $many, $action, $pk, $target, &$written ): void {
				foreach ( $this->referencing_rows( $child, $spec, $where, $viewer ) as $dependent ) {
					$one = array( $pk => $dependent[ $pk ] );
					if ( $many ) {
						$patch    = array( $col => array_values( array_filter( $dependent[ $col ] ?? array(), static fn ( $id ) => ! Js::strictEq( $id, $target ) ) ) );
						$written += count( $this->update( $child, $patch, $one, true, $viewer ) ?? array() );
					} elseif ( 'cascade' === $action ) {
						$written += count( $this->delete( $child, $one, true, $viewer ) ?? array() );
					} else {
						$value    = 'set default' === $action && isset( $def['default'] ) ? Schema::generate( $def['default'], $def ) : null;
						$written += count( $this->update( $child, array( $col => $value ), $one, true, $viewer ) ?? array() );
					}
				}
			};
			try {
				$this->with_trash_for( $child, $write );
			} catch ( \Throwable $e ) {
				// A side effect's own answer may carry what the viewer can't read (an app hook's
				// message, a hidden value's constraint): never pass it on. The request's transaction
				// rolls the whole delete back; the cause goes to the log only.
				error_log( '[spacepress] a delete side effect refused: ' . $e::class . ': ' . $e->getMessage() );
				throw self::hidden_reference();
			}
			if ( $written !== $expected ) {
				throw self::hidden_reference();
			}
		}
		// Whatever hooks did meanwhile, nothing may still reference the row: the trusted referential
		// actions never run for a viewer's delete.
		foreach ( $this->referencing( $collection, $row, skip_active_cascades: true ) as [$child, , , , $where] ) {
			if ( $this->count_rows( $child, $where, null ) > 0 ) {
				throw self::hidden_reference();
			}
		}
	}

	/**
	 * The columns of other kinds that reference $row, each with a filter for the rows that do.
	 *
	 * @return list<array{string, array, string, array, array}> child, its spec, column, column def, where
	 */
	private function referencing( string $collection, array $row, bool $skip_active_cascades = false ): array {
		$out = array();
		foreach ( $this->relationships( $collection ) as [$child, $spec, $col, $def] ) {
			$value = $row[ $def['references']['column'] ] ?? null;
			if ( null === $value ) {
				continue;
			}
			// A many-ref's referencing rows are the owners of links to this row, filtered in SQL.
			$many  = 'refList' === $def['type'];
			$where = array( $col => $many ? array( 'has' => $value ) : $value );
			// A cascade back into an active delete is completed by that delete's own call.
			$active = $this->deleting[ $child ] ?? array();
			if ( $skip_active_cascades && array() !== $active && ! $many && strtolower( $def['references']['onDelete'] ?? 'no action' ) === 'cascade' ) {
				$where = array( 'AND' => array( $where, array( $spec['primaryKey'] => array( 'notIn' => array_values( $active ) ) ) ) );
			}
			$out[] = array( $child, $spec, $col, $def, $where );
		}

		return $out;
	}

	/**
	 * The columns of other kinds that reference $collection, whatever a row's keys hold.
	 *
	 * @return list<array{string, array, string, array}> child, its spec, column, column def
	 */
	private function relationships( string $collection ): array {
		$out = array();
		foreach ( $this->schema->kinds() as $child => $spec ) {
			foreach ( $spec['columns'] as $col => $def ) {
				if ( ( $def['references']['collection'] ?? null ) === $collection ) {
					$out[] = array( (string) $child, $spec, (string) $col, $def );
				}
			}
		}

		return $out;
	}

	/** The referencing rows as $viewer reads them, every locale, WordPress's trash included. */
	private function referencing_rows( string $child, array $spec, array $where, Viewer $viewer ): array {
		$opts = array( 'where' => $where ) + ( ( $spec['localized'] ?? false ) ? array( 'locale' => '*' ) : array() );

		return $this->current(
			fn () => $this->with_trash_for(
				$child,
				fn () => $this->sql_visibility(
					$child,
					$where,
					function () use ( $child, $opts, $viewer ): array {
						$opts = Seam::query( $child, $opts, $this->schema );
						$rows = $this->fetch( $child, $opts, '', $viewer, forUpdate: true );

						return $this->project( $rows, $child, $opts, '' );
					}
				)
			)
		);
	}

	/**
	 * How many rows match $where, trusted or as $viewer, in SQL, WordPress's trash included: trashed
	 * posts keep their references and links (core's term delete removes those links too).
	 */
	private function count_rows( string $collection, array $where, ?Viewer $viewer, bool $include_trash = true ): int {
		$store = $this->store;
		if ( ! $store instanceof Wp\CompositeStore ) {
			throw new \LogicException( 'Counting referencing rows needs the WordPress store' );
		}
		$extra = null !== $viewer && ( $this->schema->collection( $collection )['localized'] ?? false ) ? array( 'locale' => '*' ) : array();

		$count = fn () => $this->sql_visibility(
			$collection,
			$where,
			function () use ( $collection, $where, $viewer, $extra, $store ): int {
			$q = $this->countQuery( $collection, $where, $viewer, $extra, forUpdate: true );

			return (int) ( $store->db->run( $q['sql'], $q['params'] )[0]['n'] ?? 0 );
			}
		);

		return $include_trash ? $this->with_trash_for( $collection, $count ) : $count();
	}

	private function with_trash_for( string $collection, callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$store = $this->store;

		return $store instanceof Wp\CompositeStore && $store->isPostBacked( $collection ) ? $store->posts->withTrash( $fn ) : $fn();
	}

	/**
	 * Run $fn with WordPress's password visibility decided in SQL only, failing closed, about the posts
	 * matching $where ({@see Wp\WpPostStore::withSqlVisibility()}): a post-password cookie is checked
	 * against those posts' passwords only, however many other protected posts the kind has.
	 */
	private function sql_visibility( string $collection, array $where, callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$store = $this->store;
		if ( ! $store instanceof Wp\CompositeStore || ! $store->isPostBacked( $collection ) ) {
			return $fn();
		}
		$scope = $this->current( fn () => $this->key_query( $collection, $where, array(), forUpdate: true ) );

		return $store->posts->withSqlVisibility( $fn, array( $collection => $scope ) );
	}

	/** The one refusal for a delete that rows the viewer can't read, or can't write, may depend on. */
	private static function hidden_reference(): HttpError {
		return new HttpError( 409, 'reference_violation', 'Rows you can\'t read may reference this row' );
	}

	/** Incoming foreign keys can reject a key change or propagate it into another hidden branch. */
	private function require_incoming_visibility( string $collection, array $written, ?Viewer $viewer, array $seen = array() ): void {
		$key = serialize( array( $collection, array_keys( $written ) ) );
		if ( null === $viewer || isset( $seen[ $key ] ) ) {
			return;
		}
		$seen[ $key ] = true;
		foreach ( $this->schema->kinds() as $child => $spec ) {
			foreach ( $spec['columns'] as $col => $def ) {
				$ref = $def['references'] ?? null;
				if ( null === $ref || $ref['collection'] !== $collection || ! array_key_exists( $ref['column'], $written ) ) {
					continue;
				}
				$this->require_reference_visibility( $collection, $ref['column'], (string) $child, $def, $viewer );
				if ( in_array( strtolower( $ref['onUpdate'] ?? 'no action' ), array( 'cascade', 'set null', 'set default' ), true ) ) {
					$this->require_incoming_visibility( (string) $child, array( $col => true ), $viewer, $seen );
				}
			}
		}
	}

	/** Both ends of a relationship must be readable before constraints can answer about its rows. */
	private function require_reference_visibility( string $parent, string $column, string $child, array $def, Viewer $viewer ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		if ( FieldAccess::mayHide( $this->schema->collection( $parent )['columns'][ $column ], $viewer ) ) {
			throw new HttpError( 409, 'reference_violation', 'A hidden field may be referenced by this row' );
		}
		try {
			$visible = $this->reads_all_rows( $child, $viewer ) && ! FieldAccess::mayHide( $def, $viewer );
		} catch ( HttpError ) {
			$visible = false;
		}
		if ( ! $visible ) {
			throw new HttpError( 409, 'reference_violation', "Rows in $child may reference this row" );
		}
	}

	/**
	 * FK actions in the pipeline (§4.2, §11.12): for every column referencing this collection, apply
	 * its onDelete to the rows pointing at $row before $row goes. Hooks and revisions apply.
	 */
	private function referential_actions( string $collection, array $row, ?Viewer $viewer = null, bool $purge = false ): void {
		if ( null !== $viewer ) {
			// A viewer's delete: what it does to referencing rows is that viewer's own writes, and
			// nothing else runs for them.
			$this->refuse_hidden_references( $collection, $row, $viewer );
			$this->viewer_referential_writes( $collection, $row, $viewer );
			$spec = $this->schema->collection( $collection );
			foreach ( $spec['columns'] as $c ) {
				if ( 'refList' === $c['type'] ) {
					$this->links()->unlink( $c['references']['join'], 'owner_id', $row[ $spec['primaryKey'] ] ); // its own links go with it
				}
			}

			return;
		}
		$spec         = $this->schema->collection( $collection );
		$deleted_mode = $purge ? 'include' : 'exclude';
		foreach ( $this->schema->kinds() as $child => $cspec ) {
			foreach ( $cspec['columns'] as $col => $c ) {
				$ref = $c['references'] ?? null;
				if ( 'refList' === $c['type'] ) {
					// The deleted row's own links go with it; links to it go unless `restrict`.
					if ( $child === $collection ) {
						$this->links()->unlink( $ref['join'], 'owner_id', $row[ $spec['primaryKey'] ] );
					}
					// A term's links go with the term: core's own delete removes them and recounts.
					if ( $ref['collection'] !== $collection || str_starts_with( $ref['join'], 'term:' ) ) {
						continue;
					}
					$id = $row[ $ref['column'] ];
					if ( strtolower( $ref['onDelete'] ?? 'cascade' ) === 'restrict' && $this->links()->links( $ref['join'], 'target_id', array( $id ) ) !== array() ) {
						throw new HttpError( 409, 'reference_violation', "Rows in $child still link to this row" );
					}
					$this->links()->unlink( $ref['join'], 'target_id', $id );
					continue;
				}
				if ( null === $ref || $ref['collection'] !== $collection || null === $row[ $ref['column'] ] ) {
					continue;
				}
				$where  = array( $col => $row[ $ref['column'] ] );
				$opts   = array(
					'where'   => $where,
					'limit'   => 1,
					'deleted' => $deleted_mode,
				);
				$action = strtolower( $ref['onDelete'] ?? 'no action' );
				if ( 'cascade' === $action ) {
					$cascade_opts = array(
						'where'   => $where,
						'deleted' => $deleted_mode,
					);
					$dependents   = array_values(
						array_filter(
							$this->select_decoded( (string) $child, $cascade_opts, '', null ),
							fn ( array $dependent ): bool => ! isset( $this->deleting[ $child ][ $this->pk_value( $cspec, $dependent ) ] ),
						)
					);
					if ( array() !== $dependents ) {
						$this->nested(
							fn () => $purge
							? $this->purge_rows( (string) $child, $dependents, $viewer )
							: $this->delete_rows( (string) $child, $dependents, $viewer )
						);
					}
				} elseif ( 'set null' === $action || 'set default' === $action ) {
					// No rows, no write: a generator must not run (or fail) for a branch it won't change.
					if ( $this->select_decoded( (string) $child, $opts, '', null ) === array() ) {
						continue;
					}
					$value = 'set default' === $action && isset( $c['default'] ) ? Schema::generate( $c['default'], $c ) : null;
					$this->update( (string) $child, array( $col => $value ), $where, errorViewer: $viewer );
				} elseif ( $this->select_decoded( (string) $child, $opts, '', null ) !== array() ) {
					throw new HttpError( 409, 'reference_violation', "Rows in $child still reference this row" );
				}
			}
		}
	}

	/**
	 * §6.1 transitions. $defaultStatus: 'published' when status was absent on create. $existing: the
	 * row being updated (null on create).
	 */
	private function draft_rules( array $data, ?string $default_status, ?array $existing ): array {
		if ( null !== $default_status ) {
			$data['status'] = $default_status;
		}
		$status = array_key_exists( 'status', $data ) ? $data['status'] : ( $existing['status'] ?? null );
		$has_at = array_key_exists( 'publishedAt', $data ) && null !== $data['publishedAt'];
		$now    = Js::iso( Js::now() );
		if ( 'published' === $status && ! $has_at ) {
			// Re-saving an already published row (publishedAt untouched) keeps its date.
			$keep = null !== $existing && ! array_key_exists( 'publishedAt', $data ) && 'published' === $existing['status']
				&& null !== $existing['publishedAt'];
			if ( ! $keep ) {
				$data['publishedAt'] = $now;
			}
		} elseif ( 'scheduled' === $status ) {
			$at  = array_key_exists( 'publishedAt', $data ) ? $data['publishedAt'] : ( $existing['publishedAt'] ?? null );
			$iso = null === $at ? null : Schema::normalize( array( 'type' => 'timestamp' ), $at, 'publishedAt', '/publishedAt' );
			if ( null === $iso || $iso <= $now ) {
				throw HttpError::invalidInput( 'scheduled rows need a future publishedAt', '/publishedAt' );
			}
		}

		return $data;
	}

	/** True when this column is the slug and must be derived (absent/empty on create, null on update). */
	private function derives_slug( array $spec, string $name, array $data, bool $absent ): bool {
		if ( ( $spec['slug'] ?? null ) !== $name || ! isset( $spec['columns'][ $name ]['source'] ) ) {
			return false;
		}

		return $absent || null === $data[ $name ] || '' === $data[ $name ];
	}

	private function derive_slug( string $collection, array $spec, array $row, int|string|null $self ): ?string { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.selfFound -- Preserve the existing PHP parameter name.
		$slug_col = $spec['slug'];
		$source   = $spec['columns'][ $slug_col ]['source'] ?? null;
		$text     = null === $source ? null : ( $row[ $source ] ?? null );
		if ( ! is_string( $text ) ) {
			return null;
		}
		$base = self::slugify( $text );
		if ( '' === $base ) {
			return null;
		}
		$pk = $spec['primaryKey'];
		for ( $n = 1; ; $n++ ) {
			$candidate = 1 === $n ? $base : $base . '-' . $n;
			$where     = array( $slug_col => $candidate );
			if ( null !== $self ) {
				$where[ $pk ] = array( 'ne' => $self );
			}
			$opts = array(
				'where' => $where,
				'limit' => 1,
			);
			if ( $this->select_decoded( $collection, $opts, '', null ) === array() ) {
				return $candidate;
			}
		}
	}

	public static function slugify( string $s ): string {
		if ( class_exists( \Transliterator::class ) && ( $t = \Transliterator::create( 'Any-Latin; Latin-ASCII' ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			$s = (string) $t->transliterate( $s );
		}
		$s = trim( (string) preg_replace( '/[^a-z0-9]+/', '-', strtolower( $s ) ), '-' );

		return rtrim( substr( $s, 0, 190 ), '-' );
	}

	/** Rules (min/max/pattern/validate, nested) + media and reference existence for written values. */
	private function check_values( array $columns, array $norm, array $full, ?Viewer $viewer = null ): void {
		$this->check_references( $columns, $norm, $viewer );
		$ctx = array(
			'data' => $full,
			'user' => $this->actor,
		);
		foreach ( $norm as $name => $v ) {
			Schema::checkRules( $columns[ $name ], $v, (string) $name, HttpError::seg( $name ), $ctx, $columns );
		}
		$this->checkMedia( $columns, $norm );
	}

	/**
	 * Every media id in $norm (normalized values by column) names an existing attachment, of an
	 * accepted kind. Also for core REST `meta` writes, which store through the post store directly.
	 */
	public function checkMedia( array $columns, array $norm ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$refs = array();
		foreach ( $norm as $name => $v ) {
			array_push( $refs, ...Schema::mediaRefs( $columns[ $name ], $v, HttpError::seg( $name ) ) );
		}
		if ( array() !== $refs ) {
			$media = $this->media->getMany( array_map( static fn ( $r ) => $r[0], $refs ) );
			foreach ( $refs as [$id, $ptr, $accept] ) {
				$m = $media[ $id ] ?? throw HttpError::invalidInput( "No media with id $id", $ptr );
				if ( 'image' === $accept && ! str_starts_with( (string) $m['mime'], 'image/' ) ) {
					throw HttpError::invalidInput( 'Only images are accepted here', $ptr );
				}
			}
		}
	}

	/** Core REST and editor inputs use the same reference visibility check as the write pipeline. */
	public function validateWriteReferences( string $collection, array $data, ?Viewer $viewer ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->current(
			function () use ( $collection, $data, $viewer ): void {
				$columns = $this->schema->collection( $collection )['columns'];
				$norm    = array();
				foreach ( $data as $name => $value ) {
					if ( isset( $columns[ $name ]['references'] ) ) {
						$norm[ $name ] = Schema::normalize( $columns[ $name ], $value, (string) $name, HttpError::seg( (string) $name ) );
					}
				}
				$this->check_references( $columns, $norm, $viewer );
			}
		);
	}

	private function check_references( array $columns, array $norm, ?Viewer $viewer ): void {
		foreach ( $norm as $name => $v ) {
			$ref = $columns[ $name ]['references'] ?? null;
			if ( null === $ref || null === $v ) {
				continue;
			}
			if ( 'refList' === $columns[ $name ]['type'] ) {
				foreach ( $v as $i => $id ) {
					$this->check_reference( $ref, (string) $name, $id, HttpError::seg( (string) $name ) . "/$i", $viewer );
				}
				continue;
			}
			$this->check_reference( $ref, (string) $name, $v, HttpError::seg( (string) $name ), $viewer );
		}
	}

	/** The referenced row exists and, for a viewer, is one they may read: otherwise the same 409. */
	private function check_reference( array $ref, string $name, mixed $v, string $ptr, ?Viewer $viewer ): void {
		$missing = new HttpError( 409, 'reference_violation', "No referenced {$ref['collection']} row for $name", $ptr );
		$target  = $this->schema->collection( $ref['collection'] );
		if ( null !== $viewer ) {
			if ( FieldAccess::mayHide( $target['columns'][ $ref['column'] ], $viewer ) ) {
				throw $missing;
			}
		}
		$opts = array(
			'where' => array( $ref['column'] => $v ),
			'limit' => 1,
		);
		if ( $target['localized'] ?? false ) {
			$opts['locale'] = '*';
		}
		try {
			$row = null === $viewer
				? ( $this->select_decoded( $ref['collection'], $opts, '', null )[0] ?? null )
				: $this->findFirst( $ref['collection'], $opts, $viewer );
			if ( null === $row || ! array_key_exists( $ref['column'], $row )
				|| ! Js::strictEq( $row[ $ref['column'] ], $v ) ) {
				throw $missing;
			}
		} catch ( HttpError $error ) {
			throw null === $viewer ? $error : $missing;
		}
	}

	/** Potential generators are checked before hidden storage decides whether they will run. */
	public function requireGeneratedVisibility( string $collection, array $generations, ?Viewer $viewer ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->current(
			function () use ( $collection, $generations, $viewer ): void {
				if ( null === $viewer ) {
					return;
				}
				$spec       = $this->schema->collection( $collection );
				$candidates = array();
				foreach ( $generations as $name => $generation ) {
					$candidates[ $name ] = array_key_exists( 'value', $generation ) ? $generation['value'] : true;
					$target              = $spec['columns'][ $name ]['references'] ?? null;
					if ( null !== $candidates[ $name ] && null !== $target ) {
						try {
							$visible = $this->reads_all_rows( $target['collection'], $viewer )
							&& ! FieldAccess::mayHide( $this->schema->collection( $target['collection'] )['columns'][ $target['column'] ], $viewer );
						} catch ( HttpError ) {
							$visible = false;
						}
						if ( ! $visible ) {
							throw new HttpError( 409, 'reference_violation', "Rows in {$target['collection']} may be referenced by this write", HttpError::seg( (string) $name ) );
						}
					}
				}
				$this->requireUniqueVisibility( $collection, $candidates, $viewer );
			}
		);
	}

	/** Prove a complete namespace without reading its rows; extension narrowing is a read filter too. */
	private function reads_all_rows( string $collection, Viewer $viewer ): bool {
		if ( ! Extensions::constraintReadsSafe() || $this->readGuards( $collection, $viewer ) !== array() ) {
			return false;
		}
		// Constraints span every locale. Sorting is harmless; any other query rewrite may hide
		// competitors, children, or their values and cannot authorize a namespace-wide check.
		$opts = ( $this->schema->collection( $collection )['localized'] ?? false ) ? array( 'locale' => '*' ) : array();
		Extensions::query( $collection, $opts, $viewer, '' );
		unset( $opts['orderBy'] );
		if ( ( $opts['where'] ?? null ) === array() ) {
			unset( $opts['where'] );
		}

		return array() === $opts;
	}

	/**
	 * A unique write can disclose every competing row. Reject it before a lookup unless the viewer
	 * may read the column across the collection. This also covers generated slugs and hook values;
	 * swallowing a conflict would falsely acknowledge a write and could commit partial hook effects.
	 * An unchanged value on a readable row/column is safe only when persistence skips its lookup.
	 */
	public function requireUniqueVisibility( string $collection, array $data, ?Viewer $viewer, bool $creating = false, ?array $existing = null ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->current( fn () => $this->check_unique_visibility( $collection, $data, $viewer, $creating, $existing ) );
	}

	private function check_unique_visibility( string $collection, array $data, ?Viewer $viewer, bool $creating, ?array $existing ): void {
		if ( null === $viewer ) {
			return;
		}
		$spec     = $this->schema->collection( $collection );
		$readable = null;
		foreach ( $spec['columns'] as $name => $col ) {
			if ( ! ( $col['unique'] ?? false ) && $name !== $spec['primaryKey'] ) {
				continue;
			}
			$derived = ( $spec['slug'] ?? null ) === $name && isset( $col['source'] )
				&& ( ( $creating && ! array_key_exists( $name, $data ) ) || ( array_key_exists( $name, $data ) && ( null === $data[ $name ] || '' === $data[ $name ] ) ) );
			if ( ( ! array_key_exists( $name, $data ) || null === $data[ $name ] ) && ! $derived ) {
				continue;
			}
			// Uids are unguessable identities the caller already presents on the sync surface.
			if ( 'uid' === $name && ( $col['system'] ?? false ) ) {
				continue;
			}
			if ( ! $creating && ! $derived && $this->unchangedReadableUnique( $collection, (string) $name, $data[ $name ], $existing, $viewer ) ) {
				continue;
			}
			if ( null === $readable ) {
				try {
					$readable = $this->reads_all_rows( $collection, $viewer );
				} catch ( HttpError ) {
					$readable = false;
				}
			}
			if ( ( ! $readable && ! $this->store->showsUnique( $collection, (string) $name, $viewer ) ) || FieldAccess::mayHide( $col, $viewer ) ) {
				throw null === $viewer->user
					? new HttpError( 401, 'unauthenticated', "Sign in to set $name", HttpError::seg( (string) $name ) )
					: new HttpError( 403, 'forbidden', "You can't set $name", HttpError::seg( (string) $name ) );
			}
		}
	}

	/** An echoed visible unique value needs no competitor lookup. Prove visibility before equality. */
	public function unchangedReadableUnique( string $collection, string $name, mixed $value, ?array $existing, ?Viewer $viewer ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current(
			function () use ( $collection, $name, $value, $existing, $viewer ): bool {
				if ( null === $viewer || null === $existing ) {
					return false;
				}
				$spec = $this->schema->collection( $collection );
				$col  = $spec['columns'][ $name ] ?? array();
				if ( ( ! ( $col['unique'] ?? false ) && $name !== $spec['primaryKey'] )
				|| ! array_key_exists( $name, $existing ) || ! isset( $existing[ $spec['primaryKey'] ] )
				|| FieldAccess::mayHide( $col, $viewer ) ) {
					return false;
				}
				try {
					$opts = array( 'where' => array( $spec['primaryKey'] => $existing[ $spec['primaryKey'] ] ) );
					if ( $spec['localized'] ?? false ) {
						$opts['locale'] = '*';
					}
					$visible = $this->findFirst( $collection, $opts, $viewer );
					if ( null === $visible || ! array_key_exists( $name, $visible )
					|| ! Js::strictEq( $visible[ $name ], $existing[ $name ] ) ) {
						return false;
					}
				} catch ( HttpError ) {
					return false;
				}

				return Js::strictEq( $value, $existing[ $name ] );
			}
		);
	}

	/** Unknown fields, and fields storage computes (a term's `count` and `url`, system readOnly columns), are refused. */
	private function reject_unknown( array $columns, array $data, ?array $existing = null, bool $allow_system = false ): void {
		foreach ( $data as $key => $v ) {
			if ( ! isset( $columns[ $key ] ) ) {
				throw HttpError::invalidInput( "Unknown field '$key'", HttpError::seg( $key ) );
			}
			if ( $allow_system && ( $columns[ $key ]['system'] ?? false ) ) {
				continue;
			}
			// An update may resend what it read, unchanged.
			if ( ( $columns[ $key ]['readOnly'] ?? false ) && ( null === $existing || ! Js::strictEq( $v, $existing[ $key ] ?? null ) ) ) {
				throw HttpError::invalidInput( "$key is read-only", HttpError::seg( $key ) );
			}
		}
	}

	private function check_patch( array $spec, array $existing, array $patch, bool $allow_system = false ): void {
		$this->reject_unknown( $spec['columns'], $patch, $existing, $allow_system );
		$pk = $spec['primaryKey'];
		if ( array_key_exists( $pk, $patch ) && ! Js::strictEq( $patch[ $pk ], $existing[ $pk ] ) ) {
			throw HttpError::invalidInput( 'The primary key cannot be changed', HttpError::seg( $pk ) );
		}
	}

	/** `afterPublish` (spec §2.8): the row is published now and wasn't before (or is new). */
	private function published( string $collection, array $spec, array $row, ?array $previous ): void {
		if ( isset( $spec['hooks']['afterPublish'] ) && ( $row['status'] ?? null ) === 'published'
			&& ( null === $previous || ( $previous['status'] ?? null ) !== 'published' ) ) {
			$this->hook( $collection, $spec, 'afterPublish', $row );
		}
	}

	/**
	 * A scheduled item reached its time (WP cron's `publish_future_post`, or the lazy promotion):
	 * its `afterPublish`, run as the system in one transaction.
	 */
	public function afterPromotion( string $collection, int|string $pk ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$spec = $this->schema->collection( $collection );
		if ( ! isset( $spec['hooks']['afterPublish'] ) ) {
			return;
		}
		$this->as_editor(
			null,
			function () use ( $collection, $spec, $pk ) {
				[$row] = $this->read_by_pk( $collection, $spec, $pk );
				if ( ( $row['status'] ?? null ) === 'published' ) {
					$this->hook( $collection, $spec, 'afterPublish', $row );
				}
			}
		);
	}

	/** Call a hook that receives rows (afterCreate/afterUpdate/before|afterDelete); result ignored. */
	private function hook( string $collection, array $spec, string $name, array $row, ?array $previous = null ): void {
		if ( ! isset( $spec['hooks'][ $name ] ) ) {
			return;
		}
		$slot = $spec['hooks'][ $name ];
		$ctx  = $this->hookCtx();
		$fn   = $slot;
		if ( is_string( $slot ) ) {
			$fn       = '\\SpacePressApp\\' . $slot;
			$ctx      = Seam::ctx( $ctx, $spec['columns'] );
			$row      = Seam::rowToJs( $collection, $row );
			$previous = null === $previous ? null : Seam::rowToJs( $collection, $previous );
		}
		if ( null === $previous ) {
			$fn( $row, $ctx );
		} else {
			$fn( $row, $previous, $ctx );
		}
	}

	/** @return array{array, array} [decoded row, storage-form row] */
	private function read_by_pk( string $collection, array $spec, int|string $pk, string $deleted = 'exclude' ): array {
		$opts = array(
			'where' => array( $spec['primaryKey'] => $pk ),
			'limit' => 1,
		);
		if ( 'exclude' !== $deleted ) {
			$opts['deleted'] = $deleted;
		}
		$q   = Sql::select( $this->schema, $this->store, $collection, $opts );
		$raw = $this->with_links( $collection, $this->store->select( $collection, $q ) )[0] ?? throw new \RuntimeException( "Row $collection/$pk vanished after write" );
		$raw = array_intersect_key( $raw, $spec['columns'] );

		return array( Schema::decodeRow( $spec['columns'], $raw ), $raw );
	}

	private function pk_value( array $spec, array $row ): int|string {
		$pk = $spec['primaryKey'];
		$v  = Schema::encode( $spec['columns'][ $pk ], $row[ $pk ], $pk, HttpError::seg( $pk ) );

		return is_float( $v ) ? (int) $v : $v;
	}

	private function nested( callable $fn ): mixed { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		if ( $this->depth >= self::MAX_HOOK_DEPTH + 1 ) {
			throw new HttpError( 500, 'hook_recursion', 'Hooks nested writes more than ' . self::MAX_HOOK_DEPTH . ' levels deep' );
		}
		++$this->depth;
		try {
			return $this->current( fn () => $this->store->transaction( $fn ) );
		} finally {
			--$this->depth;
		}
	}

	// ================================================================ editor saves (WP, §4.9)

	/** Trusted editor capture: full decoded storage values, without display transforms or projection. */
	public function editorRow( string $collection, int|string $pk ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$opts = array(
			'where' => array( $this->schema->collection( $collection )['primaryKey'] => $pk ),
			'limit' => 1,
		);

		return $this->select_decoded( $collection, $opts, '', null )[0] ?? null;
	}

	/** Stored rows for a page of WordPress post IDs, with the same decoding as editorRow(). */
	public function editorRows( string $collection, array $ids ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$pk    = $this->schema->collection( $collection )['primaryKey'];
		$opts  = array(
			'where' => array( $pk => array( 'in' => $ids ) ),
			'limit' => count( $ids ) + 1,
		);
		$found = $this->select_decoded( $collection, $opts, '', null );
		if ( count( $found ) > count( $ids ) ) {
			return array(); // Duplicate postmeta multiplied the joins. Fall back to the individual LIMIT 1 reads.
		}
		$rows = array();
		foreach ( $found as $row ) {
			$id = (int) $row[ $pk ];
			// Non-unique WordPress postmeta can return several rows for one post. Let the normal
			// LIMIT 1 query choose that item's row exactly as it would for an individual response.
			$rows[ $id ] = array_key_exists( $id, $rows ) ? null : $row;
		}
		return $rows;
	}

	/**
	 * editorRow() for a row WordPress may hold in its trash: what a move into or out of the trash, and
	 * a permanent delete from it, know of the row as stored. Every other read leaves the trash out.
	 */
	public function editorRowIncludingTrash( string $collection, int|string $pk ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$store = $this->store;

		return $store instanceof Wp\CompositeStore
			? $store->posts->withTrash( fn () => $this->editorRow( $collection, $pk ) )
			: $this->editorRow( $collection, $pk );
	}

	/**
	 * After a wp-admin/core REST save: afterCreate (no $previousRow) or afterUpdate, with the row
	 * re-read through the store. Counts toward MAX_HOOK_DEPTH. Runs in one transaction.
	 */
	public function afterEditorSave( string $collection, int|string $pk, ?array $previousRow, ?array $user = null ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$this->as_editor(
			$user,
			function () use ( $collection, $pk, $previousRow ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$spec  = $this->schema->collection( $collection );
				[$row] = $this->read_by_pk( $collection, $spec, $pk );
				null === $previousRow ? $this->hook( $collection, $spec, 'afterCreate', $row ) : $this->hook( $collection, $spec, 'afterUpdate', $row, $previousRow ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$this->published( $collection, $spec, $row, $previousRow ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				Extensions::written( null === $previousRow ? 'create' : 'update', $collection, $row, $previousRow ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			}
		);
	}

	/** Before an editor-side delete: beforeDelete($row) and the pipeline FK actions. */
	public function beforeEditorDelete( string $collection, array $row, ?Viewer $viewer = null ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$pk = $this->pk_value( $this->schema->collection( $collection ), $row );
		if ( isset( $this->deleting[ $collection ][ $pk ] ) ) {
			return;
		}
		$this->deleting[ $collection ][ $pk ] = $pk;
		try {
			$this->as_editor(
				$viewer?->user,
				function () use ( $collection, $row, $viewer ) {
					$spec     = $this->schema->collection( $collection );
					$existing = $row;
					Extensions::write( 'delete', $collection, $row, $existing, $viewer, $existing );
					$this->hook( $collection, $spec, 'beforeDelete', $row );
					$this->referential_actions( $collection, $row, $viewer );
				}
			);
		} finally {
			unset( $this->deleting[ $collection ][ $pk ] );
		}
	}

	/** After an editor-side delete: afterDelete($row). */
	public function afterEditorDelete( string $collection, array $row, ?array $user = null ): void { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$this->as_editor(
			$user,
			function () use ( $collection, $row ) {
				$this->hook( $collection, $this->schema->collection( $collection ), 'afterDelete', $row );
				Extensions::written( 'delete', $collection, $row, $row );
			}
		);
	}

	private function as_editor( ?array $user, callable $fn ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP parameter name.
		$prev        = $this->actor;
		$this->actor = $user;
		try {
			$this->nested( $fn );
		} finally {
			$this->actor = $prev;
		}
	}

	// ================================================================ revisions (§6.4 / ADR 2026-11-21 §5)

	private ?string $latestMigration    = null; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.
	private bool $latestMigrationLoaded = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.PropertyNotSnakeCase -- Preserve the existing PHP property name.

	private function record_revision(
		string $collection,
		array $spec,
		int|string $pk,
		array $raw,
		string $op,
		?array $previous = null,
		?array $current = null,
		bool $allocatedKey = false, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	): void {
		if ( ! ( $spec['revisions'] ?? false ) ) {
			return;
		}
		$changed = null;
		if ( null !== $previous && null !== $current ) {
			$diff = array();
			foreach ( $spec['columns'] as $name => $col ) {
				$name = (string) $name;
				if ( ( $col['hidden'] ?? false ) || isset( $col['onUpdate'] ) ) {
					continue;
				}
				if ( Js::jsonStringify( $previous[ $name ] ?? null ) !== Js::jsonStringify( $current[ $name ] ?? null ) ) {
					$diff[] = $name;
				}
			}
			$changed = $diff;
		}
		$this->store->revisionWrite(
			$collection,
			$pk,
			$raw,
			$this->actor['id'] ?? null,
			array(
				'op'              => $op,
				'schemaMigration' => $this->latestSchemaMigration(),
				'changed'         => $changed,
				'allocatedKey'    => $allocatedKey, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			)
		);
	}

	private function latestSchemaMigration(): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! $this->latestMigrationLoaded ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->latestMigrationLoaded = true; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$this->latestMigration       = method_exists( $this->store, 'latestSchemaMigration' ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
				? $this->store->latestSchemaMigration()
				: null;
		}

		return $this->latestMigration; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
	}

	/** @return list<array{id: int, version: int, op: string, at: string, userId: ?int, schemaMigration: ?string, changed: ?list<string>}> newest first; needs update access on the row */
	public function revisions( string $collection, int|string $pk, ?Viewer $viewer = null ): array {
		$this->require_revisable( $collection, $pk, $viewer );
		$columns = $this->schema->collection( $collection )['columns'];

		return array_map(
			static function ( array $r ) use ( $columns, $viewer ): array {
				$changed = $r['changed'] ?? null;
				if ( null !== $viewer && is_array( $changed ) ) {
					$changed = array_values(
						array_filter(
							$changed,
							static fn ( string $f ): bool => isset( $columns[ $f ] ) && ! FieldAccess::mayHide( $columns[ $f ], $viewer ),
						)
					);
				}

				return array(
					'id'              => $r['id'],
					'version'         => (int) ( $r['version'] ?? 1 ),
					'op'              => (string) ( $r['op'] ?? 'update' ),
					'at'              => $r['at'],
					'userId'          => $r['userId'],
					'schemaMigration' => $r['schemaMigration'] ?? null,
					'changed'         => $changed,
				);
			},
			$this->current( fn () => $this->store->revisions( $collection, $pk ) ),
		);
	}

	/** The full decoded row at a revision. */
	public function revision( string $collection, int|string $pk, int $revisionId, ?Viewer $viewer = null, bool $byVersion = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		return $this->current( fn (): array => $this->revision_at( $collection, $pk, $revisionId, $viewer, $byVersion ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	private function revision_at( string $collection, int|string $pk, int $revisionId, ?Viewer $viewer, bool $byVersion = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$this->require_revisable( $collection, $pk, $viewer );

		return $this->present( array( $this->revisionRow( $collection, $pk, $revisionId, $byVersion ) ), $collection, $viewer )[0] // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			?? throw HttpError::notFound( "No revision $revisionId for $collection $pk" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	/**
	 * The decoded row a revision (or autosave) holds, trusted: no access checks.
	 * Schema-aware decoding maps aliased or physical column names to the current logical schema,
	 * drops retired columns, and fills columns added in later forward-only migrations with their defaults.
	 */
	public function revisionRow( string $collection, int|string $pk, int $revisionId, bool $byVersion = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		$rev = $this->current( fn () => $this->store->revision( $collection, $pk, $revisionId, $byVersion ) ) // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			?? throw HttpError::notFound( "No revision $revisionId for $collection $pk" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.InterpolatedVariableNotSnakeCase -- Preserve the existing PHP variable name.

		return self::decodeRevisionPayload( $this->schema->collection( $collection ), is_array( $rev['row'] ?? null ) ? $rev['row'] : array() );
	}

	/** Schema-aware decoding of a historical revision snapshot across forward-only migrations and column aliases. */
	public static function decodeRevisionPayload( array $spec, array $raw ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$columns = $spec['columns'];
		// 1. Resolve logical aliases (e.g. `.alias("old_name")`).
		$mapped = Schema::resolveAliases( $spec, $raw );
		// 2. Map physical SQL column names (e.g. `.column("physical_col")`) to their logical field names.
		foreach ( $columns as $name => $col ) {
			$name = (string) $name;
			$phys = is_string( $col['column'] ?? null ) && '' !== $col['column'] ? $col['column'] : null;
			if ( null !== $phys && $phys !== $name && ! array_key_exists( $name, $mapped ) && array_key_exists( $phys, $mapped ) ) {
				$mapped[ $name ] = $mapped[ $phys ];
			}
		}
		// 3. Drop retired/unknown columns and fill columns added after this revision was captured.
		$aligned = array();
		foreach ( $columns as $name => $col ) {
			$name = (string) $name;
			if ( array_key_exists( $name, $mapped ) ) {
				$aligned[ $name ] = $mapped[ $name ];
			} elseif ( isset( $col['default'] ) && is_array( $col['default'] ) && array_key_exists( 'value', $col['default'] ) ) {
				$aligned[ $name ] = Schema::store( $col, $col['default']['value'] );
			} else {
				$aligned[ $name ] = null;
			}
		}

		return Schema::decodeRow( $columns, $aligned );
	}

	/**
	 * Diff two revisions of a row, masked as $viewer may read them.
	 *
	 * @return array{from: int, to: int, changes: list<array{field: string, from: mixed, to: mixed}>}
	 */
	public function diffRevisions( string $collection, int|string $pk, int $fromVersion, int $toVersion, ?Viewer $viewer = null, bool $byVersion = true ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		return $this->current(
			function () use ( $collection, $pk, $fromVersion, $toVersion, $viewer, $byVersion ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$this->require_revisable( $collection, $pk, $viewer );
				$spec     = $this->schema->collection( $collection );
				$from_row = $this->revision_at( $collection, $pk, $fromVersion, $viewer, $byVersion ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$to_row   = $this->revision_at( $collection, $pk, $toVersion, $viewer, $byVersion ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$changes  = array();
				foreach ( $spec['columns'] as $name => $col ) {
					$name = (string) $name;
					if ( ( $col['hidden'] ?? false ) || isset( $col['onUpdate'] ) ) {
						continue;
					}
					if ( ! array_key_exists( $name, $from_row ) && ! array_key_exists( $name, $to_row ) ) {
						continue;
					}
					$a = $from_row[ $name ] ?? null;
					$b = $to_row[ $name ] ?? null;
					if ( Js::jsonStringify( $a ) !== Js::jsonStringify( $b ) ) {
						$changes[] = array(
							'field' => $name,
							'from'  => $a,
							'to'    => $b,
						);
					}
				}

				return array(
					'from'    => $fromVersion, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					'to'      => $toVersion, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					'changes' => $changes,
				);
			}
		);
	}

	/**
	 * Restore: the whole revision as stored, as $viewer, in one update. Fields the viewer can read are
	 * its patch where the revision differs from the row, under every update and field rule. Fields
	 * that may be hidden from it are written from the stored revision as trusted values, after its
	 * rules pass: it sends nothing for them, so nothing about them can be probed, and a restore never
	 * leaves part of the row at a later state. The answer is masked like every read.
	 */
	public function restoreRevision( string $collection, int|string $pk, int $revisionId, ?Viewer $viewer = null, bool $byVersion = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		return $this->current(
			function () use ( $collection, $pk, $revisionId, $viewer, $byVersion ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$spec = $this->schema->collection( $collection );
				$this->require_revisable( $collection, $pk, $viewer );
				$row     = $this->revisionRow( $collection, $pk, $revisionId, $byVersion ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$opts    = array( 'where' => array( $spec['primaryKey'] => $pk ) );
				$current = $this->select_decoded( $collection, $opts, '', null )[0] ?? throw HttpError::notFound( "No $collection row $pk" );
				$patch   = $hidden = array(); // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
				foreach ( $spec['columns'] as $name => $col ) {
					// A revision taken where links aren't kept with the row (WordPress revisions) leaves a
					// `refList` it holds as null as it is.
					if ( $name === $spec['primaryKey'] || ( $col['system'] ?? false ) || isset( $col['onUpdate'] )
					|| ( 'refList' === $col['type'] && null === $row[ $name ] )
					|| Js::jsonStringify( $row[ $name ] ?? null ) === Js::jsonStringify( $current[ $name ] ?? null ) ) {
						continue;
					}
					if ( null !== $viewer && FieldAccess::mayHide( $col, $viewer ) ) {
						$hidden[ $name ] = $row[ $name ];
					} else {
						$patch[ $name ] = $row[ $name ];
					}
				}
				if ( array() === $hidden ) {
					return $this->update( $collection, $patch, array( $spec['primaryKey'] => $pk ), true, $viewer )[0]
					?? throw HttpError::notFound( "No $collection row $pk" );
				}

				return $this->nested(
					function () use ( $collection, $spec, $pk, $patch, $hidden, $viewer ): array {
						$guards   = null === $viewer ? array() : $this->write_guards( $collection, 'update', $viewer, $patch );
						$opts     = array( 'where' => array( $spec['primaryKey'] => $pk ) );
						$existing = $this->select_decoded( $collection, $opts, '', null, null, $guards, $viewer )[0]
						?? throw HttpError::notFound( "No $collection row $pk" );
						$written  = Js::atInstant( fn () => $this->update_one( $collection, $spec, $existing, $patch, $viewer, $hidden ) );

						return $this->present( array( $written ), $collection, $viewer )[0];
					}
				);
			}
		);
	}

	private function require_revisable( string $collection, int|string $pk, ?Viewer $viewer ): void {
		$spec = $this->schema->collection( $collection );
		if ( ! ( $spec['revisions'] ?? false ) ) {
			throw HttpError::notFound( "$collection keeps no revisions" );
		}
		$guards = null === $viewer ? array() : $this->write_guards( $collection, 'update', $viewer, null );
		$opts   = array(
			'where' => array( $spec['primaryKey'] => $pk ),
			'limit' => 1,
		);
		if ( $this->select_decoded( $collection, $opts, '', null, null, $guards ) === array() ) {
			throw HttpError::notFound( "No $collection row $pk" );
		}
	}

	// ================================================================ globals (§3.6)

	/** Current values (JS form); never-written fields read as their defaults. */
	public function globalGet( string $name, ?Viewer $viewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current(
			function () use ( $name, $viewer ): array {
				$g = $this->schema->global( $name );
				if ( null !== $viewer ) {
					Access::require( Access::globalRules( $g )['read'], $viewer, 'read', null, "read $name" );
				}
				Render\Reads::global( $name );
				$stored = $this->store->globalRead( $name ) ?? array();
				$out    = array();
				foreach ( $g['fields'] as $field => $f ) {
					if ( array_key_exists( $field, $stored ) ) {
						$out[ $field ] = Schema::decode( $f, $stored[ $field ] );
					} else {
						$out[ $field ] = isset( $f['default'] ) ? Schema::normalize( $f, Schema::generate( $f['default'], $f ), (string) $field, '' ) : null;
					}
				}

				return $out;
			}
		);
	}

	public function globalUpdate( string $name, array|JsObject $patch, ?Viewer $viewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$patch = Seam::container( $patch );
		$g     = $this->schema->global( $name );
		$patch = Seam::toPhp( $patch, $g['fields'] );
		if ( null !== $viewer ) {
			$this->current( fn () => Access::require( Access::globalRules( $g )['update'], $viewer, 'update', $patch, "update $name", $g['fields'] ) );
		}
		$fields = $g['fields'];
		$this->reject_unknown( $fields, $patch );

		// One instant: never-written fields' `now` defaults and the patch's nested defaults agree.
		return Js::atInstant(
			fn () => $this->transaction(
				function () use ( $name, $fields, $patch, $viewer ) {
					$current = $this->globalGet( $name );
					$norm    = array();
					foreach ( $patch as $field => $v ) {
						$norm[ $field ] = Schema::normalize( $fields[ $field ], $v, (string) $field, HttpError::seg( $field ) );
					}
					$this->check_values( $fields, $norm, $norm + $current, $viewer );
					$values = array();
					foreach ( $norm + $current as $field => $v ) {
						$values[ $field ] = Schema::store( $fields[ $field ], $v );
					}
					$this->store->globalWrite( $name, $values );
					Access::clearCache();

					return $this->globalGet( $name );
				}
			)
		);
	}

	// ================================================================ media (§4.6)

	public function mediaUpload( string $tmpPath, string $filename, ?string $alt, ?Viewer $viewer = null ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP method name. Preserve the existing PHP variable name.
		if ( null !== $viewer ) {
			Access::require( Access::MEDIA['create'], $viewer, 'create', null, 'upload media' );
		}

		return $this->transaction( fn () => $this->media->upload( $tmpPath, $filename, $this->actor, $alt ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	public function mediaGet( int $id ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current( fn () => $this->media->get( $id ) );
	}

	public function mediaList( array $opts ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return $this->current( fn () => $this->media->list( $opts ) );
	}

	/**
	 * Delete a media row: null `media` columns and drop the id from `mediaList` columns first
	 * (hooks + revisions apply). A platform's native transport may supply its own removal callback
	 * to retain native response semantics and plugin hooks; a failure must throw to roll back.
	 *
	 * @param ?callable(): void $remove
	 */
	public function mediaDelete( int $id, ?Viewer $viewer = null, ?callable $remove = null ): ?array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( null !== $viewer ) {
			Access::require( Access::MEDIA['delete'], $viewer, 'delete', null, 'delete media' );
		}

		return $this->nested(
			function () use ( $id, $remove ) {
				$row = $this->media->get( $id );
				if ( null === $row ) {
					return null;
				}
				foreach ( $this->schema->kinds() as $c => $spec ) {
					foreach ( $spec['columns'] as $col => $def ) {
						if ( 'media' === $def['type'] ) {
							$this->update( (string) $c, array( $col => null ), array( $col => $id ) );
						} elseif ( 'mediaList' === $def['type'] ) {
							$pk   = $spec['primaryKey'];
							$opts = array( 'where' => array( $col => array( 'has' => $id ) ) );
							foreach ( $this->select_decoded( (string) $c, $opts, '', null ) as $r ) {
								$kept = array_values( array_filter( $r[ $col ], static fn ( $x ) => $x !== $id ) );
								$this->update( (string) $c, array( $col => $kept ), array( $pk => $r[ $pk ] ) );
							}
						}
					}
				}
				null === $remove ? $this->media->delete( $id ) : $remove();

				return $row;
			}
		);
	}

	// ================================================================ helpers

	private static function key( mixed $v ): string {
		return is_string( $v ) ? 's' . $v : 'n' . Js::str( $v );
	}
}

function db(): Db {
	return Db::instance();
}
