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

$columns = [
    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
    'title' => ['type' => 'text', 'notNull' => true],
    'body' => ['type' => 'richText'],
    'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
    'rating' => ['type' => 'integer'],
    'score' => ['type' => 'real'],
    'pinned' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
    'note' => ['type' => 'text'],
    'due' => ['type' => 'date'],
    'seenAt' => ['type' => 'timestamp'],
    'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['news', 'guide'], 'notNull' => true, 'default' => ['value' => []]],
    'photos' => ['type' => 'mediaList'],
    'seo' => ['type' => 'group', 'fields' => ['metaTitle' => ['type' => 'text']]],
    'steps' => ['type' => 'repeater', 'fields' => ['text' => ['type' => 'text']]],
    'extra' => ['type' => 'json'],
    'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
    'publishedAt' => ['type' => 'timestamp', 'system' => true],
];
$schema = new Schema([
    'version' => 5, 'runtime' => \SpacePress\Schema::SERIES,
    'collections' => [
        'notes' => [
            'primaryKey' => 'id', 'columns' => $columns, 'title' => 'title', 'content' => 'body', 'slug' => 'slug',
            'relations' => ['logs' => ['kind' => 'many', 'collection' => 'logs', 'from' => 'id', 'to' => 'noteId']],
        ],
        'logs' => [
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'noteId' => ['type' => 'integer', 'references' => ['collection' => 'notes', 'column' => 'id']],
                'level' => ['type' => 'text'],
                'labels' => ['type' => 'select', 'multiple' => true, 'enum' => ['a', 'b']],
            ],
            'relations' => ['note' => ['kind' => 'one', 'collection' => 'notes', 'from' => 'noteId', 'to' => 'id']],
        ],
    ],
]);

/** The §3.5.1 post-backed mapping for `notes` (post type sp_notes, meta prefix sp_). */
function postSource(array $columns): Source
{
    $m = static fn (string $col) => "LEFT JOIN `wp_postmeta` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = 'sp_$col'";
    $v = "NULLIF({j}.meta_value, '')";
    $refs = [];
    foreach ($columns as $col => $def) {
        $refs[$col] = match (true) {
            $col === 'id' => new ColumnRef('{a}.ID', '', '', 'scalar'),
            $col === 'title' => new ColumnRef('{a}.post_title', '', '', 'scalar'),
            $col === 'body' => new ColumnRef('{a}.post_content', '', '', 'scalar'),
            $col === 'slug' => new ColumnRef('{a}.post_name', '', '', 'scalar'),
            $col === 'status' => new ColumnRef("CASE {a}.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END", '', '', 'scalar'),
            $col === 'publishedAt' => new ColumnRef(
                "CASE WHEN {a}.post_date_gmt = '0000-00-00 00:00:00' THEN NULL ELSE DATE_FORMAT({a}.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END",
                '',
                "NULLIF({a}.post_date_gmt, '0000-00-00 00:00:00')",
                'scalar',
            ),
            $def['type'] === 'integer' => new ColumnRef($v, $m($col), "CAST($v AS SIGNED)", 'scalar'),
            $def['type'] === 'real' => new ColumnRef($v, $m($col), "CAST($v AS DECIMAL(30,10))", 'scalar'),
            $def['type'] === 'timestamp' => new ColumnRef("CONCAT(REPLACE($v, ' ', 'T'), '.000Z')", $m($col), $v, 'scalar'),
            $def['type'] === 'date' => new ColumnRef("DATE_FORMAT(STR_TO_DATE($v, '%Y%m%d'), '%Y-%m-%d')", $m($col), $v, 'scalar'),
            $def['type'] === 'json' => new ColumnRef($v, $m($col), '', 'json'),
            in_array($def['type'], ['select', 'mediaList'], true) => new ColumnRef($v, $m($col), '{j}.meta_value', 'serialized-list'),
            in_array($def['type'], ['group', 'repeater', 'blocks'], true) => new ColumnRef('NULL', $m($col), "NULLIF(NULLIF({j}.meta_value, ''), '0')", 'json'),
            default => new ColumnRef($v, $m($col), $v, 'scalar'),
        };
    }

    return new Source('`wp_posts`', "{a}.post_type = 'sp_notes' AND {a}.post_status NOT IN ('trash', 'auto-draft', 'inherit')", $refs);
}

/** A Store that only answers dialect()/source(): enough to compile. */
final class CompileOnlyStore implements Store
{
    public function readGuards(string $collection, \SpacePress\Viewer $viewer, bool $forSelect = false): array { return []; }

    public function showsUnique(string $collection, string $column, \SpacePress\Viewer $viewer): bool { return false; }

    public function __construct(private readonly Dialect $d, private readonly array $sources)
    {
    }

    public function dialect(): Dialect
    {
        return $this->d;
    }

    public function source(string $collection): Source
    {
        return $this->sources[$collection];
    }

    public function afterCommit(callable $fn): void { throw new \LogicException('compile only'); }
    public function applySystemStatements(array $statements): void { throw new \LogicException('compile only'); }
    public function transaction(callable $fn): mixed { throw new LogicException('compile only'); }
    public function select(string $collection, array $q): array { throw new LogicException('compile only'); }
    public function insert(string $collection, array $values): int|string { throw new LogicException('compile only'); }
    public function update(string $collection, int|string $pk, array $values): void { throw new LogicException('compile only'); }
    public function delete(string $collection, int|string $pk): void { throw new LogicException('compile only'); }
    public function globalRead(string $name): ?array { return null; }
    public function globalWrite(string $name, array $values): void {}
    public function revisions(string $collection, int|string $pk): array { return []; }
    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId, array $meta = []): void {}
    public function revision(string $collection, int|string $pk, int $revisionId, bool $byVersion = false): ?array { return null; }
    public function promoteDue(string $collection, string $nowIso): array { return []; }
    public function mapError(\Throwable $e): \Throwable { return $e; }
}

$mysql = Dialect::mysql('utf8mb4_unicode_ci');
$wp = new CompileOnlyStore($mysql, [
    'notes' => postSource($columns),
    'logs' => Source::plain($mysql, '`wp_sp_logs`', $schema->collection('logs')['columns']),
]);
/** WHERE clause of a compiled MySQL read on notes (everything after the outer WHERE). */
$where = static function (array $filter, string $c = 'notes', ?Closure $guardsFor = null) use ($schema, $wp): array {
    $q = Sql::select($schema, $wp, $c, ['where' => $filter], guardsFor: $guardsFor);
    $base = $c === 'notes' ? "t0.post_type = 'sp_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND " : '';
    $w = substr($q['sql'], strpos($q['sql'], ' WHERE ') + 7);

    return [str_starts_with($w, $base) ? substr($w, strlen($base)) : "<missing baseWhere> $w", $q['params']];
};

// ================================================================ MySQL, post-backed

$q = Sql::select($schema, $wp, 'logs', ['where' => ['level' => 'warn'], 'orderBy' => ['id' => 'desc'], 'limit' => 5, 'offset' => 10]);
eq('plain MySQL table: full statement', $q, [
    'sql' => 'SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels` FROM `wp_sp_logs` t0 WHERE t0.`level` = ? ORDER BY t0.`id` DESC LIMIT 5 OFFSET 10',
    'params' => ['warn'],
]);

$locking = static fn (Store $store): array => Sql::select($schema, $store, 'logs',
    ['where' => ['noteId' => 42]], guards: [['note' => ['status' => 'published']]], only: ['id' => true], forUpdate: true);
$locked = $locking($wp);
eq('MySQL dependency selection locks both the referencing rows and relation guards', $locked, [
    'sql' => 'SELECT t0.`id` AS `id` FROM `wp_sp_logs` t0 WHERE t0.`noteId` = ? AND (EXISTS (SELECT 1 FROM `wp_posts` t1 WHERE '
        . "t1.post_type = 'sp_notes' AND t1.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND t1.ID = t0.`noteId` AND "
        . "CASE t1.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END = ? FOR UPDATE)) FOR UPDATE",
    'params' => [42, 'published'],
]);
$translated = Dialect::mysqlOnSqlite();
$sqlite = new CompileOnlyStore($translated, [
    'notes' => postSource($columns),
    'logs' => Source::plain($translated, '`wp_sp_logs`', $schema->collection('logs')['columns']),
]);
$locked['sql'] = str_replace(' FOR UPDATE', '', $locked['sql']);
eq('SQLite omits both locks from dependency selection', $locking($sqlite), $locked);

$q = Sql::select($schema, $wp, 'notes', ['where' => ['rating' => ['gte' => 3]], 'orderBy' => ['rating' => 'desc']]);
check('post-backed: base table, baseWhere, a typed CAST for filter + order, one join per column',
    str_starts_with($q['sql'], 'SELECT t0.ID AS `id`, t0.post_title AS `title`, t0.post_content AS `body`, t0.post_name AS `slug`, NULLIF(t0_m4.meta_value, \'\') AS `rating`, ')
    && str_contains($q['sql'], " FROM `wp_posts` t0 LEFT JOIN `wp_postmeta` t0_m4 ON t0_m4.post_id = t0.ID AND t0_m4.meta_key = 'sp_rating' ")
    && substr_count($q['sql'], 'meta_key = \'sp_rating\'') === 1
    && str_ends_with($q['sql'], " WHERE t0.post_type = 'sp_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) >= ? ORDER BY CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) DESC")
    && $q['params'] === [3],
    $q);
check('group/repeater columns select NULL and cost no join', str_contains($q['sql'], 'NULL AS `seo`') && !str_contains($q['sql'], "'sp_seo'"), $q['sql']);
check('DATE_FORMAT % survives as literal SQL', str_contains($q['sql'], "DATE_FORMAT(t0.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END AS `publishedAt`"), $q['sql']);

eq('timestamp meta compares in UTC Y-m-d H:i:s', $where(['seenAt' => ['gt' => '2026-01-02T05:04:05+02:00']]), ["NULLIF(t0_m9.meta_value, '') > ?", ['2026-01-02 03:04:05']]);
eq('date meta compares as Ymd', $where(['due' => '2026-01-02']), ["NULLIF(t0_m8.meta_value, '') = ?", ['20260102']]);
eq('boolean meta compares to 1/0', $where(['pinned' => true]), ["NULLIF(t0_m6.meta_value, '') = ?", ['1']]);
eq('publishedAt compares post_date_gmt', $where(['publishedAt' => ['lte' => '2026-03-01T00:00:00Z']]), ["NULLIF(t0.post_date_gmt, '0000-00-00 00:00:00') <= ?", ['2026-03-01 00:00:00']]);
eq('status compares the CASE', $where(['status' => ['in' => ['draft', 'scheduled']]]), ["CASE t0.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END IN (?, ?)", ['draft', 'scheduled']]);
eq('real meta CASTs to DECIMAL', $where(['score' => ['lt' => 1.5]]), ["CAST(NULLIF(t0_m5.meta_value, '') AS DECIMAL(30,10)) < ?", [1.5]]);
eq('like: binary collation on the parameter', $where(['note' => ['like' => 'a%']]), ["NULLIF(t0_m7.meta_value, '') LIKE ? COLLATE utf8mb4_bin ESCAPE '\\\\'", ['a%']]);
eq('notIlike: the dialect\'s ci collation', $where(['title' => ['notIlike' => '%x%']]), ["NOT (t0.post_title LIKE ? COLLATE utf8mb4_unicode_ci ESCAPE '\\\\')", ['%x%']]);
eq('isNull on a meta scalar tests the value (missing row and \'\' alike)', $where(['note' => ['isNull' => true]]), ["NULLIF(t0_m7.meta_value, '') IS NULL", []]);
eq('has on serialized strings: one complete element', $where(['tags' => ['has' => 'news']]), ['t0_m10.meta_value LIKE ?', ['%s:4:"news";%']]);
eq('has on serialized ids: int and SCF string forms', $where(['photos' => ['has' => 12]]), ['(t0_m11.meta_value LIKE ? OR t0_m11.meta_value LIKE ?)', ['%i:12;%', '%s:2:"12";%']]);
eq('eq [] on a serialized list: missing, \'\' or a:0:{}', $where(['tags' => []]), ["COALESCE(NULLIF(t0_m10.meta_value, ''), 'a:0:{}') = 'a:0:{}'", []]);
eq('isNull on a repeater: no rows / first count', $where(['steps' => ['isNull' => true]]), ["NULLIF(NULLIF(t0_m13.meta_value, ''), '0') IS NULL", []]);
eq('relation filter into a plain table', $where(['logs' => ['level' => 'warn']]),
    ['EXISTS (SELECT 1 FROM `wp_sp_logs` t1 WHERE t1.`noteId` = t0.ID AND t1.`level` = ?)', ['warn']]);
// A viewer's relation filter only sees target rows the viewer may read: the target's read guards
// (here a draft filter plus a rule that itself filters through a relation) run inside the EXISTS.
// Guards are the app's own rules, so the relation inside one is not guarded again.
$readable = static fn (string $c): array => ['notes' => [['status' => 'published'], ['logs' => ['level' => 'public']]]][$c];
eq('relation filter into a post-backed collection carries its baseWhere, joins and read guards', $where(['note' => ['rating' => 5]], 'logs', $readable),
    ["EXISTS (SELECT 1 FROM `wp_posts` t1 LEFT JOIN `wp_postmeta` t1_m4 ON t1_m4.post_id = t1.ID AND t1_m4.meta_key = 'sp_rating' WHERE t1.post_type = 'sp_notes' AND t1.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND t1.ID = t0.`noteId`"
        . " AND (CASE t1.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END = ?)"
        . " AND (EXISTS (SELECT 1 FROM `wp_sp_logs` t2 WHERE t2.`noteId` = t1.ID AND t2.`level` = ?))"
        . " AND CAST(NULLIF(t1_m4.meta_value, '') AS SIGNED) = ?)", ['published', 'public', 5]]);
eq('custom-table list: JSON_CONTAINS with a JSON param', $where(['labels' => ['has' => 'a']], 'logs'), ['JSON_CONTAINS(t0.`labels`, ?)', ['"a"']]);

$q = Sql::select($schema, $wp, 'logs', ['orderBy' => ['level' => 'asc'], 'limit' => 2], ['noteId', [1, 2]]);
eq('with batch: per-parent window on MySQL', $q, [
    'sql' => 'SELECT * FROM (SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels`, ROW_NUMBER() OVER (PARTITION BY t0.`noteId` ORDER BY t0.`level` ASC) AS __sp_rn FROM `wp_sp_logs` t0 WHERE t0.`noteId` IN (?, ?)) z WHERE z.__sp_rn > 0 AND z.__sp_rn <= 2 ORDER BY z.__sp_rn',
    'params' => [1, 2],
]);
$q = Sql::select($schema, $wp, 'notes', [], ['rating', [4]]);
check('with batch into post meta: IN on the typed cmpExpr', str_contains($q['sql'], "AND CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) IN (?)") && $q['params'] === [4], $q);
check('offset without limit on MySQL', str_ends_with(Sql::select($schema, $wp, 'logs', ['offset' => 3])['sql'], ' LIMIT 18446744073709551615 OFFSET 3'));

// Rejections: identical messages on every store (§3.5).
$reject = static fn (string $label, array $opts, string $detail, string $pointer, string $c = 'notes') => check(
    $label,
    ($e = problem($label . ' (problem)', fn () => Sql::select($schema, $wp, $c, $opts), 400, 'invalid_query', $pointer)) !== null && $e->getMessage() === $detail,
    $e?->getMessage(),
);
$reject('in on a list column', ['where' => ['tags' => ['in' => ['news']]]], '`in` isn\'t supported on list columns; use `has`', '/where/tags/in');
$reject('like on a list column', ['where' => ['photos' => ['like' => '%1%']]], '`like` isn\'t supported on list columns; use `has`', '/where/photos/like');
$reject('gt on a JSON column', ['where' => ['extra' => ['gt' => 1]]], '`gt` isn\'t supported on JSON columns', '/where/extra/gt');
$reject('eq on a group of an editor collection', ['where' => ['seo' => ['eq' => ['metaTitle' => 'x']]]], '`eq` on `seo` isn\'t supported on editor collections; filter on a scalar column', '/where/seo/eq');
$reject('orderBy a JSON column', ['orderBy' => ['steps' => 'asc']], '`orderBy` isn\'t supported on JSON columns', '/orderBy/steps');
$reject('orderBy the content column of an editor collection', ['orderBy' => ['body' => 'asc']], '`orderBy` on `body` isn\'t supported on editor collections', '/orderBy/body');
$reject('has on a scalar', ['where' => ['note' => ['has' => 'x']]], '`has` is only supported on list columns', '/where/note/has');

// ================================================================ locale rule (§7.3)

// The locale rule compiles the same on every store: a plain `locale`/`translationGroup` column pair,
// or the post-backed Polylang term subqueries (WpPostStore's Source). The fallback subquery is
// uncorrelated and carries the viewer's read guards, so a hidden translation never hides a fallback.
$locSchema = new Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'locales' => ['default' => 'en', 'all' => ['en', 'de']], 'collections' => [
    'docs' => ['primaryKey' => 'id', 'localized' => true, 'columns' => [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'title' => ['type' => 'text', 'localized' => true],
        'status' => $columns['status'],
        'locale' => ['type' => 'text', 'enum' => ['en', 'de'], 'notNull' => true, 'system' => true],
        'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
        'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],
    ]],
]]);
$byLocale = static fn (?string $fallback, int|string|null $groupOf = null) => ['where' => ['locale' => new \SpacePress\Locale\Filter('de', $fallback, $groupOf)]];
$published = static fn (string $c): array => [['status' => 'published']];
$plainDocs = new CompileOnlyStore($mysql, ['docs' => Source::plain($mysql, '`wp_sp_docs`', $locSchema->collection('docs')['columns'])]);
$whereOf = static fn (array $q): string => substr($q['sql'], strrpos($q['sql'], ' FROM `wp_sp_docs` t0 WHERE ') + strlen(' FROM `wp_sp_docs` t0 WHERE '));
$q = Sql::select($locSchema, $plainDocs, 'docs', $byLocale('en'), guardsFor: $published);
eq('plain table: the locale, else the default row of a group with no readable de row', [$whereOf($q), $q['params']], [
    "(t0.`locale` = ? OR (t0.`locale` = ? AND (t0.`translationGroup` IS NULL OR t0.`translationGroup` NOT IN (SELECT t1.`translationGroup` FROM `wp_sp_docs` t1 WHERE t1.`locale` = ? AND t1.`translationGroup` IS NOT NULL AND (t1.`status` = ?)))))",
    ['de', 'en', 'de', 'published'],
]);
check('translations: one literal-only aggregate over the group, no parameters', str_contains($q['sql'],
    "CASE WHEN t0.`locale` IS NULL THEN NULL ELSE COALESCE((SELECT JSON_OBJECTAGG(t2.`locale`, t2.`id`) FROM `wp_sp_docs` t2 WHERE t2.`translationGroup` = t0.`translationGroup` AND t2.`locale` IS NOT NULL), JSON_OBJECT(t0.`locale`, t0.`id`)) END AS `translations`"), $q['sql']);
eq('without fallback: just the locale', $whereOf(Sql::select($locSchema, $plainDocs, 'docs', $byLocale(null))), 't0.`locale` = ?');
$q = Sql::select($locSchema, $plainDocs, 'docs', $byLocale(null, 7));
eq('pinned to one row\'s group (item read with ?locale=)', [$whereOf($q), $q['params']], [
    "(t0.`id` = ? OR t0.`translationGroup` IN (SELECT t1.`translationGroup` FROM `wp_sp_docs` t1 WHERE t1.`id` = ? AND t1.`translationGroup` IS NOT NULL)) AND t0.`locale` = ?",
    [7, 7, 'de'],
]);

$postDocs = new CompileOnlyStore($mysql, ['docs' => new Source('`wp_posts`', "{a}.post_type = 'sp_docs'", [
    'id' => new ColumnRef('{a}.ID', '', '', 'scalar'),
    'title' => new ColumnRef('{a}.post_title', '', '', 'scalar'),
    'status' => new ColumnRef("CASE {a}.post_status WHEN 'publish' THEN 'published' ELSE 'draft' END", '', '', 'scalar'),
] + array_map(static fn (string $col) => \SpacePress\Wp\Polylang::ref($col, 'wp_', ['en', 'de']),
    ['locale' => 'locale', 'translations' => 'translations', 'translationGroup' => 'translationGroup']))]);
$q = Sql::select($locSchema, $postDocs, 'docs', $byLocale('en'));
$lang = static fn (string $a) => "CASE (SELECT {$a}_pll_n.slug FROM `wp_term_relationships` {$a}_pll_r JOIN `wp_term_taxonomy` {$a}_pll_t ON {$a}_pll_t.term_taxonomy_id = {$a}_pll_r.term_taxonomy_id JOIN `wp_terms` {$a}_pll_n ON {$a}_pll_n.term_id = {$a}_pll_t.term_id WHERE {$a}_pll_r.object_id = {$a}.ID AND {$a}_pll_t.taxonomy = 'language' LIMIT 1) WHEN 'en' THEN 'en' WHEN 'de' THEN 'de' END";
$group = static fn (string $a) => "(SELECT {$a}_pll_t.term_taxonomy_id FROM `wp_term_relationships` {$a}_pll_r JOIN `wp_term_taxonomy` {$a}_pll_t ON {$a}_pll_t.term_taxonomy_id = {$a}_pll_r.term_taxonomy_id WHERE {$a}_pll_r.object_id = {$a}.ID AND {$a}_pll_t.taxonomy = 'post_translations' LIMIT 1)";
eq('post-backed: the same rule over Polylang\'s language and post_translations terms', substr($q['sql'], strrpos($q['sql'], ' FROM `wp_posts` t0 WHERE ') + 26),
    "t0.post_type = 'sp_docs' AND ({$lang('t0')} = ? OR ({$lang('t0')} = ? AND ({$group('t0')} IS NULL OR {$group('t0')} NOT IN (SELECT {$group('t1')} FROM `wp_posts` t1 WHERE t1.post_type = 'sp_docs' AND {$lang('t1')} = ? AND {$group('t1')} IS NOT NULL))))");

finish('sql_test');
