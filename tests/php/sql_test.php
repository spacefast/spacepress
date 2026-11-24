<?php

declare(strict_types=1);

/*
 * Sql compiler (§3.5): SQL text + params pinned against a hand-built post-backed Source that follows
 * §3.5.1 exactly (what WpPostStore must return) and a plain custom-table Source (WpTableStore).
 * Executed for real in tests/wp (MariaDB) and tests/php/db_test.php (the SQLite translator).
 */

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\ColumnRef;
use SpacePress\Dialect;
use SpacePress\Schema;
use SpacePress\Source;
use SpacePress\Sql;
use SpacePress\Store;

$columns = array(
	'id'          => array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	),
	'title'       => array(
		'type'    => 'text',
		'notNull' => true,
	),
	'body'        => array( 'type' => 'richText' ),
	'slug'        => array(
		'type'   => 'slug',
		'unique' => true,
		'source' => 'title',
	),
	'rating'      => array( 'type' => 'integer' ),
	'score'       => array( 'type' => 'real' ),
	'pinned'      => array(
		'type'    => 'boolean',
		'notNull' => true,
		'default' => array( 'value' => false ),
	),
	'note'        => array( 'type' => 'text' ),
	'due'         => array( 'type' => 'date' ),
	'seenAt'      => array( 'type' => 'timestamp' ),
	'tags'        => array(
		'type'     => 'select',
		'multiple' => true,
		'enum'     => array( 'news', 'guide' ),
		'notNull'  => true,
		'default'  => array( 'value' => array() ),
	),
	'photos'      => array( 'type' => 'mediaList' ),
	'seo'         => array(
		'type'   => 'group',
		'fields' => array( 'metaTitle' => array( 'type' => 'text' ) ),
	),
	'steps'       => array(
		'type'   => 'repeater',
		'fields' => array( 'text' => array( 'type' => 'text' ) ),
	),
	'extra'       => array( 'type' => 'json' ),
	'status'      => array(
		'type'    => 'text',
		'notNull' => true,
		'enum'    => array( 'draft', 'published', 'scheduled' ),
		'default' => array( 'value' => 'published' ),
		'system'  => true,
	),
	'publishedAt' => array(
		'type'   => 'timestamp',
		'system' => true,
	),
);
$schema  = new Schema(
	array(
		'version'     => 5,
		'runtime'     => \SpacePress\Schema::SERIES,
		'collections' => array(
			'notes' => array(
				'primaryKey' => 'id',
				'columns'    => $columns,
				'title'      => 'title',
				'content'    => 'body',
				'slug'       => 'slug',
				'relations'  => array(
					'logs' => array(
						'kind'       => 'many',
						'collection' => 'logs',
						'from'       => 'id',
						'to'         => 'noteId',
					),
				),
			),
			'logs'  => array(
				'primaryKey' => 'id',
				'columns'    => array(
					'id'     => array(
						'type'          => 'integer',
						'primaryKey'    => true,
						'autoIncrement' => true,
						'notNull'       => true,
					),
					'noteId' => array(
						'type'       => 'integer',
						'references' => array(
							'collection' => 'notes',
							'column'     => 'id',
						),
					),
					'level'  => array( 'type' => 'text' ),
					'labels' => array(
						'type'     => 'select',
						'multiple' => true,
						'enum'     => array( 'a', 'b' ),
					),
				),
				'relations'  => array(
					'note' => array(
						'kind'       => 'one',
						'collection' => 'notes',
						'from'       => 'noteId',
						'to'         => 'id',
					),
				),
			),
		),
	)
);

/** The §3.5.1 post-backed mapping for `notes` (post type sp_notes, meta prefix sp_). */
function postSource( array $columns ): Source {
	$m    = static fn ( string $col ) => "LEFT JOIN `wp_postmeta` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = 'sp_$col'";
	$v    = "NULLIF({j}.meta_value, '')";
	$refs = array();
	foreach ( $columns as $col => $def ) {
		$refs[ $col ] = match ( true ) {
			'id' === $col => new ColumnRef( '{a}.ID', '', '', 'scalar' ),
			'title' === $col => new ColumnRef( '{a}.post_title', '', '', 'scalar' ),
			'body' === $col => new ColumnRef( '{a}.post_content', '', '', 'scalar' ),
			'slug' === $col => new ColumnRef( '{a}.post_name', '', '', 'scalar' ),
			'status' === $col => new ColumnRef( "CASE {a}.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END", '', '', 'scalar' ),
			'publishedAt' === $col => new ColumnRef(
				"CASE WHEN {a}.post_date_gmt = '0000-00-00 00:00:00' THEN NULL ELSE DATE_FORMAT({a}.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END",
				'',
				"NULLIF({a}.post_date_gmt, '0000-00-00 00:00:00')",
				'scalar',
			),
			'integer' === $def['type'] => new ColumnRef( $v, $m( $col ), "CAST($v AS SIGNED)", 'scalar' ),
			'real' === $def['type'] => new ColumnRef( $v, $m( $col ), "CAST($v AS DECIMAL(30,10))", 'scalar' ),
			'timestamp' === $def['type'] => new ColumnRef( "CONCAT(REPLACE($v, ' ', 'T'), '.000Z')", $m( $col ), $v, 'scalar' ),
			'date' === $def['type'] => new ColumnRef( "DATE_FORMAT(STR_TO_DATE($v, '%Y%m%d'), '%Y-%m-%d')", $m( $col ), $v, 'scalar' ),
			'json' === $def['type'] => new ColumnRef( $v, $m( $col ), '', 'json' ),
			in_array( $def['type'], array( 'select', 'mediaList' ), true ) => new ColumnRef( $v, $m( $col ), '{j}.meta_value', 'serialized-list' ),
			in_array( $def['type'], array( 'group', 'repeater', 'blocks' ), true ) => new ColumnRef( 'NULL', $m( $col ), "NULLIF(NULLIF({j}.meta_value, ''), '0')", 'json' ),
			default => new ColumnRef( $v, $m( $col ), $v, 'scalar' ),
		};
	}

	return new Source( '`wp_posts`', "{a}.post_type = 'sp_notes' AND {a}.post_status NOT IN ('trash', 'auto-draft', 'inherit')", $refs );
}

/** A Store that only answers dialect()/source(): enough to compile. */
final class CompileOnlyStore implements Store {

	public function readGuards( string $collection, \SpacePress\Viewer $viewer, bool $forSelect = false ): array {
		return array(); }

	public function showsUnique( string $collection, string $column, \SpacePress\Viewer $viewer ): bool {
		return false; }

	public function __construct( private readonly Dialect $d, private readonly array $sources ) {
	}

	public function dialect(): Dialect {
		return $this->d;
	}

	public function source( string $collection ): Source {
		return $this->sources[ $collection ];
	}

	public function afterCommit( callable $fn ): void {
		throw new \LogicException( 'compile only' ); }
	public function applySystemStatements( array $statements ): void {
		throw new \LogicException( 'compile only' ); }
	public function transaction( callable $fn ): mixed {
		throw new LogicException( 'compile only' ); }
	public function select( string $collection, array $q ): array {
		throw new LogicException( 'compile only' ); }
	public function insert( string $collection, array $values ): int|string {
		throw new LogicException( 'compile only' ); }
	public function update( string $collection, int|string $pk, array $values ): void {
		throw new LogicException( 'compile only' ); }
	public function delete( string $collection, int|string $pk ): void {
		throw new LogicException( 'compile only' ); }
	public function globalRead( string $name ): ?array {
		return null; }
	public function globalWrite( string $name, array $values ): void {}
	public function revisions( string $collection, int|string $pk ): array {
		return array(); }
	public function revisionWrite( string $collection, int|string $pk, array $encodedRow, ?int $userId, array $meta = array() ): void {}
	public function revision( string $collection, int|string $pk, int $revisionId, bool $byVersion = false ): ?array {
		return null; }
	public function promoteDue( string $collection, string $nowIso ): array {
		return array(); }
	public function mapError( \Throwable $e ): \Throwable {
		return $e; }
}

$mysql = Dialect::mysql( 'utf8mb4_unicode_ci' );
$wp    = new CompileOnlyStore(
	$mysql,
	array(
		'notes' => postSource( $columns ),
		'logs'  => Source::plain( $mysql, '`wp_sp_logs`', $schema->collection( 'logs' )['columns'] ),
	)
);
/** WHERE clause of a compiled MySQL read on notes (everything after the outer WHERE). */
$where = static function ( array $filter, string $c = 'notes', ?Closure $guardsFor = null ) use ( $schema, $wp ): array {
	$q    = Sql::select( $schema, $wp, $c, array( 'where' => $filter ), guardsFor: $guardsFor );
	$base = 'notes' === $c ? "t0.post_type = 'sp_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND " : '';
	$w    = substr( $q['sql'], strpos( $q['sql'], ' WHERE ' ) + 7 );

	return array( str_starts_with( $w, $base ) ? substr( $w, strlen( $base ) ) : "<missing baseWhere> $w", $q['params'] );
};

// ================================================================ MySQL, post-backed

$q = Sql::select(
	$schema,
	$wp,
	'logs',
	array(
		'where'   => array( 'level' => 'warn' ),
		'orderBy' => array( 'id' => 'desc' ),
		'limit'   => 5,
		'offset'  => 10,
	)
);
eq(
	'plain MySQL table: full statement',
	$q,
	array(
		'sql'    => 'SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels` FROM `wp_sp_logs` t0 WHERE t0.`level` = ? ORDER BY t0.`id` DESC LIMIT 5 OFFSET 10',
		'params' => array( 'warn' ),
	)
);

$locking = static fn ( Store $store ): array => Sql::select(
	$schema,
	$store,
	'logs',
	array( 'where' => array( 'noteId' => 42 ) ),
	guards: array( array( 'note' => array( 'status' => 'published' ) ) ),
	only: array( 'id' => true ),
	forUpdate: true
);
$locked  = $locking( $wp );
eq(
	'MySQL dependency selection locks both the referencing rows and relation guards',
	$locked,
	array(
		'sql'    => 'SELECT t0.`id` AS `id` FROM `wp_sp_logs` t0 WHERE t0.`noteId` = ? AND (EXISTS (SELECT 1 FROM `wp_posts` t1 WHERE '
			. "t1.post_type = 'sp_notes' AND t1.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND t1.ID = t0.`noteId` AND "
			. "CASE t1.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END = ? FOR UPDATE)) FOR UPDATE",
		'params' => array( 42, 'published' ),
	)
);
$translated    = Dialect::mysqlOnSqlite();
$sqlite        = new CompileOnlyStore(
	$translated,
	array(
		'notes' => postSource( $columns ),
		'logs'  => Source::plain( $translated, '`wp_sp_logs`', $schema->collection( 'logs' )['columns'] ),
	)
);
$locked['sql'] = str_replace( ' FOR UPDATE', '', $locked['sql'] );
eq( 'SQLite omits both locks from dependency selection', $locking( $sqlite ), $locked );

$q = Sql::select(
	$schema,
	$wp,
	'notes',
	array(
		'where'   => array( 'rating' => array( 'gte' => 3 ) ),
		'orderBy' => array( 'rating' => 'desc' ),
	)
);
check(
	'post-backed: base table, baseWhere, a typed CAST for filter + order, one join per column',
	str_starts_with( $q['sql'], 'SELECT t0.ID AS `id`, t0.post_title AS `title`, t0.post_content AS `body`, t0.post_name AS `slug`, NULLIF(t0_m4.meta_value, \'\') AS `rating`, ' )
	&& str_contains( $q['sql'], " FROM `wp_posts` t0 LEFT JOIN `wp_postmeta` t0_m4 ON t0_m4.post_id = t0.ID AND t0_m4.meta_key = 'sp_rating' " )
	&& substr_count( $q['sql'], 'meta_key = \'sp_rating\'' ) === 1
	&& str_ends_with( $q['sql'], " WHERE t0.post_type = 'sp_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) >= ? ORDER BY CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) DESC" )
	&& $q['params'] === array( 3 ),
	$q
);
check( 'group/repeater columns select NULL and cost no join', str_contains( $q['sql'], 'NULL AS `seo`' ) && ! str_contains( $q['sql'], "'sp_seo'" ), $q['sql'] );
check( 'DATE_FORMAT % survives as literal SQL', str_contains( $q['sql'], "DATE_FORMAT(t0.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END AS `publishedAt`" ), $q['sql'] );

eq( 'timestamp meta compares in UTC Y-m-d H:i:s', $where( array( 'seenAt' => array( 'gt' => '2026-01-02T05:04:05+02:00' ) ) ), array( "NULLIF(t0_m9.meta_value, '') > ?", array( '2026-01-02 03:04:05' ) ) );
eq( 'date meta compares as Ymd', $where( array( 'due' => '2026-01-02' ) ), array( "NULLIF(t0_m8.meta_value, '') = ?", array( '20260102' ) ) );
eq( 'boolean meta compares to 1/0', $where( array( 'pinned' => true ) ), array( "NULLIF(t0_m6.meta_value, '') = ?", array( '1' ) ) );
eq( 'publishedAt compares post_date_gmt', $where( array( 'publishedAt' => array( 'lte' => '2026-03-01T00:00:00Z' ) ) ), array( "NULLIF(t0.post_date_gmt, '0000-00-00 00:00:00') <= ?", array( '2026-03-01 00:00:00' ) ) );
eq( 'status compares the CASE', $where( array( 'status' => array( 'in' => array( 'draft', 'scheduled' ) ) ) ), array( "CASE t0.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END IN (?, ?)", array( 'draft', 'scheduled' ) ) );
eq( 'real meta CASTs to DECIMAL', $where( array( 'score' => array( 'lt' => 1.5 ) ) ), array( "CAST(NULLIF(t0_m5.meta_value, '') AS DECIMAL(30,10)) < ?", array( 1.5 ) ) );
eq( 'like: binary collation on the parameter', $where( array( 'note' => array( 'like' => 'a%' ) ) ), array( "NULLIF(t0_m7.meta_value, '') LIKE ? COLLATE utf8mb4_bin ESCAPE '\\\\'", array( 'a%' ) ) );
eq( 'notIlike: the dialect\'s ci collation', $where( array( 'title' => array( 'notIlike' => '%x%' ) ) ), array( "NOT (t0.post_title LIKE ? COLLATE utf8mb4_unicode_ci ESCAPE '\\\\')", array( '%x%' ) ) );
eq( 'isNull on a meta scalar tests the value (missing row and \'\' alike)', $where( array( 'note' => array( 'isNull' => true ) ) ), array( "NULLIF(t0_m7.meta_value, '') IS NULL", array() ) );
eq( 'has on serialized strings: one complete element', $where( array( 'tags' => array( 'has' => 'news' ) ) ), array( 't0_m10.meta_value LIKE ?', array( '%s:4:"news";%' ) ) );
eq( 'has on serialized ids: int and SCF string forms', $where( array( 'photos' => array( 'has' => 12 ) ) ), array( '(t0_m11.meta_value LIKE ? OR t0_m11.meta_value LIKE ?)', array( '%i:12;%', '%s:2:"12";%' ) ) );
eq( 'eq [] on a serialized list: missing, \'\' or a:0:{}', $where( array( 'tags' => array() ) ), array( "COALESCE(NULLIF(t0_m10.meta_value, ''), 'a:0:{}') = 'a:0:{}'", array() ) );
eq( 'isNull on a repeater: no rows / first count', $where( array( 'steps' => array( 'isNull' => true ) ) ), array( "NULLIF(NULLIF(t0_m13.meta_value, ''), '0') IS NULL", array() ) );
eq(
	'relation filter into a plain table',
	$where( array( 'logs' => array( 'level' => 'warn' ) ) ),
	array( 'EXISTS (SELECT 1 FROM `wp_sp_logs` t1 WHERE t1.`noteId` = t0.ID AND t1.`level` = ?)', array( 'warn' ) )
);
// A viewer's relation filter only sees target rows the viewer may read: the target's read guards
// (here a draft filter plus a rule that itself filters through a relation) run inside the EXISTS.
// Guards are the app's own rules, so the relation inside one is not guarded again.
$readable = static fn ( string $c ): array => array( 'notes' => array( array( 'status' => 'published' ), array( 'logs' => array( 'level' => 'public' ) ) ) )[ $c ];
eq(
	'relation filter into a post-backed collection carries its baseWhere, joins and read guards',
	$where( array( 'note' => array( 'rating' => 5 ) ), 'logs', $readable ),
	array(
		"EXISTS (SELECT 1 FROM `wp_posts` t1 LEFT JOIN `wp_postmeta` t1_m4 ON t1_m4.post_id = t1.ID AND t1_m4.meta_key = 'sp_rating' WHERE t1.post_type = 'sp_notes' AND t1.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND t1.ID = t0.`noteId`"
						. " AND (CASE t1.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END = ?)"
						. ' AND (EXISTS (SELECT 1 FROM `wp_sp_logs` t2 WHERE t2.`noteId` = t1.ID AND t2.`level` = ?))'
						. " AND CAST(NULLIF(t1_m4.meta_value, '') AS SIGNED) = ?)",
		array( 'published', 'public', 5 ),
	)
);
eq( 'custom-table list: JSON_CONTAINS with a JSON param', $where( array( 'labels' => array( 'has' => 'a' ) ), 'logs' ), array( 'JSON_CONTAINS(t0.`labels`, ?)', array( '"a"' ) ) );

$q = Sql::select(
	$schema,
	$wp,
	'logs',
	array(
		'orderBy' => array( 'level' => 'asc' ),
		'limit'   => 2,
	),
	array( 'noteId', array( 1, 2 ) )
);
eq(
	'with batch: per-parent window on MySQL',
	$q,
	array(
		'sql'    => 'SELECT * FROM (SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels`, ROW_NUMBER() OVER (PARTITION BY t0.`noteId` ORDER BY t0.`level` ASC) AS __sp_rn FROM `wp_sp_logs` t0 WHERE t0.`noteId` IN (?, ?)) z WHERE z.__sp_rn > 0 AND z.__sp_rn <= 2 ORDER BY z.__sp_rn',
		'params' => array( 1, 2 ),
	)
);
$q = Sql::select( $schema, $wp, 'notes', array(), array( 'rating', array( 4 ) ) );
check( 'with batch into post meta: IN on the typed cmpExpr', str_contains( $q['sql'], "AND CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) IN (?)" ) && $q['params'] === array( 4 ), $q );
check( 'offset without limit on MySQL', str_ends_with( Sql::select( $schema, $wp, 'logs', array( 'offset' => 3 ) )['sql'], ' LIMIT 18446744073709551615 OFFSET 3' ) );

// Rejections: identical messages on every store (§3.5).
$reject = static fn ( string $label, array $opts, string $detail, string $pointer, string $c = 'notes' ) => check(
	$label,
	( $e = problem( $label . ' (problem)', fn () => Sql::select( $schema, $wp, $c, $opts ), 400, 'invalid_query', $pointer ) ) !== null && $e->getMessage() === $detail,
	$e?->getMessage(),
);
$reject( 'in on a list column', array( 'where' => array( 'tags' => array( 'in' => array( 'news' ) ) ) ), '`in` isn\'t supported on list columns; use `has`', '/where/tags/in' );
$reject( 'like on a list column', array( 'where' => array( 'photos' => array( 'like' => '%1%' ) ) ), '`like` isn\'t supported on list columns; use `has`', '/where/photos/like' );
$reject( 'gt on a JSON column', array( 'where' => array( 'extra' => array( 'gt' => 1 ) ) ), '`gt` isn\'t supported on JSON columns', '/where/extra/gt' );
$reject( 'eq on a group of an editor collection', array( 'where' => array( 'seo' => array( 'eq' => array( 'metaTitle' => 'x' ) ) ) ), '`eq` on `seo` isn\'t supported on editor collections; filter on a scalar column', '/where/seo/eq' );
$reject( 'orderBy a JSON column', array( 'orderBy' => array( 'steps' => 'asc' ) ), '`orderBy` isn\'t supported on JSON columns', '/orderBy/steps' );
$reject( 'orderBy the content column of an editor collection', array( 'orderBy' => array( 'body' => 'asc' ) ), '`orderBy` on `body` isn\'t supported on editor collections', '/orderBy/body' );
$reject( 'has on a scalar', array( 'where' => array( 'note' => array( 'has' => 'x' ) ) ), '`has` is only supported on list columns', '/where/note/has' );

// ================================================================ locale rule (§7.3)

// The locale rule compiles the same on every store: a plain `locale`/`translationGroup` column pair,
// or the post-backed Polylang term subqueries (WpPostStore's Source). The fallback subquery is
// uncorrelated and carries the viewer's read guards, so a hidden translation never hides a fallback.
$loc_schema = new Schema(
	array(
		'version'     => 5,
		'runtime'     => \SpacePress\Schema::SERIES,
		'locales'     => array(
			'default' => 'en',
			'all'     => array( 'en', 'de' ),
		),
		'collections' => array(
			'docs' => array(
				'primaryKey' => 'id',
				'localized'  => true,
				'columns'    => array(
					'id'               => array(
						'type'          => 'integer',
						'primaryKey'    => true,
						'autoIncrement' => true,
						'notNull'       => true,
					),
					'title'            => array(
						'type'      => 'text',
						'localized' => true,
					),
					'status'           => $columns['status'],
					'locale'           => array(
						'type'    => 'text',
						'enum'    => array( 'en', 'de' ),
						'notNull' => true,
						'system'  => true,
					),
					'translations'     => array(
						'type'    => 'json',
						'system'  => true,
						'derived' => true,
					),
					'translationGroup' => array(
						'type'   => 'text',
						'system' => true,
						'hidden' => true,
					),
				),
			),
		),
	)
);
$by_locale  = static fn ( ?string $fallback, int|string|null $groupOf = null ) => array( 'where' => array( 'locale' => new \SpacePress\Locale\Filter( 'de', $fallback, $groupOf ) ) );
$published  = static fn ( string $c ): array => array( array( 'status' => 'published' ) );
$plain_docs = new CompileOnlyStore( $mysql, array( 'docs' => Source::plain( $mysql, '`wp_sp_docs`', $loc_schema->collection( 'docs' )['columns'] ) ) );
$where_of   = static fn ( array $q ): string => substr( $q['sql'], strrpos( $q['sql'], ' FROM `wp_sp_docs` t0 WHERE ' ) + strlen( ' FROM `wp_sp_docs` t0 WHERE ' ) );
$q          = Sql::select( $loc_schema, $plain_docs, 'docs', $by_locale( 'en' ), guardsFor: $published );
eq(
	'plain table: the locale, else the default row of a group with no readable de row',
	array( $where_of( $q ), $q['params'] ),
	array(
		'(t0.`locale` = ? OR (t0.`locale` = ? AND (t0.`translationGroup` IS NULL OR t0.`translationGroup` NOT IN (SELECT t1.`translationGroup` FROM `wp_sp_docs` t1 WHERE t1.`locale` = ? AND t1.`translationGroup` IS NOT NULL AND (t1.`status` = ?)))))',
		array( 'de', 'en', 'de', 'published' ),
	)
);
check(
	'translations: one literal-only aggregate over the group, no parameters',
	str_contains(
		$q['sql'],
		'CASE WHEN t0.`locale` IS NULL THEN NULL ELSE COALESCE((SELECT JSON_OBJECTAGG(t2.`locale`, t2.`id`) FROM `wp_sp_docs` t2 WHERE t2.`translationGroup` = t0.`translationGroup` AND t2.`locale` IS NOT NULL), JSON_OBJECT(t0.`locale`, t0.`id`)) END AS `translations`'
	),
	$q['sql']
);
eq( 'without fallback: just the locale', $where_of( Sql::select( $loc_schema, $plain_docs, 'docs', $by_locale( null ) ) ), 't0.`locale` = ?' );
$q = Sql::select( $loc_schema, $plain_docs, 'docs', $by_locale( null, 7 ) );
eq(
	'pinned to one row\'s group (item read with ?locale=)',
	array( $where_of( $q ), $q['params'] ),
	array(
		'(t0.`id` = ? OR t0.`translationGroup` IN (SELECT t1.`translationGroup` FROM `wp_sp_docs` t1 WHERE t1.`id` = ? AND t1.`translationGroup` IS NOT NULL)) AND t0.`locale` = ?',
		array( 7, 7, 'de' ),
	)
);

$post_docs = new CompileOnlyStore(
	$mysql,
	array(
		'docs' => new Source(
			'`wp_posts`',
			"{a}.post_type = 'sp_docs'",
			array(
				'id'     => new ColumnRef( '{a}.ID', '', '', 'scalar' ),
				'title'  => new ColumnRef( '{a}.post_title', '', '', 'scalar' ),
				'status' => new ColumnRef( "CASE {a}.post_status WHEN 'publish' THEN 'published' ELSE 'draft' END", '', '', 'scalar' ),
			) + array_map(
				static fn ( string $col ) => \SpacePress\Wp\Polylang::ref( $col, 'wp_', array( 'en', 'de' ) ),
				array(
					'locale'           => 'locale',
					'translations'     => 'translations',
					'translationGroup' => 'translationGroup',
				)
			)
		),
	)
);
$q         = Sql::select( $loc_schema, $post_docs, 'docs', $by_locale( 'en' ) );
$lang      = static fn ( string $a ) => "CASE (SELECT {$a}_pll_n.slug FROM `wp_term_relationships` {$a}_pll_r JOIN `wp_term_taxonomy` {$a}_pll_t ON {$a}_pll_t.term_taxonomy_id = {$a}_pll_r.term_taxonomy_id JOIN `wp_terms` {$a}_pll_n ON {$a}_pll_n.term_id = {$a}_pll_t.term_id WHERE {$a}_pll_r.object_id = {$a}.ID AND {$a}_pll_t.taxonomy = 'language' LIMIT 1) WHEN 'en' THEN 'en' WHEN 'de' THEN 'de' END";
$group     = static fn ( string $a ) => "(SELECT {$a}_pll_t.term_taxonomy_id FROM `wp_term_relationships` {$a}_pll_r JOIN `wp_term_taxonomy` {$a}_pll_t ON {$a}_pll_t.term_taxonomy_id = {$a}_pll_r.term_taxonomy_id WHERE {$a}_pll_r.object_id = {$a}.ID AND {$a}_pll_t.taxonomy = 'post_translations' LIMIT 1)";
eq(
	'post-backed: the same rule over Polylang\'s language and post_translations terms',
	substr( $q['sql'], strrpos( $q['sql'], ' FROM `wp_posts` t0 WHERE ' ) + 26 ),
	"t0.post_type = 'sp_docs' AND ({$lang('t0')} = ? OR ({$lang('t0')} = ? AND ({$group('t0')} IS NULL OR {$group('t0')} NOT IN (SELECT {$group('t1')} FROM `wp_posts` t1 WHERE t1.post_type = 'sp_docs' AND {$lang('t1')} = ? AND {$group('t1')} IS NOT NULL))))"
);

finish( 'sql_test' );
