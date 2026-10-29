<?php

declare(strict_types=1);

/*
 * Sql compiler (§3.5) per dialect. MySQL: SQL text + params pinned against a hand-built post-backed
 * Source that follows §3.5.1 exactly (what WpPostStore must return) and a plain custom-table Source
 * (WpTableStore); executed for real only in tests/wp. SQLite: compiled and executed in memory.
 */

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\Schema;
use Zero\Source;
use Zero\Sql;
use Zero\Store;
use Zero\Store\SqliteStore;

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
    'version' => 2,
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

/** The §3.5.1 post-backed mapping for `notes` (post type zero_notes, meta prefix zero_). */
function postSource(array $columns): Source
{
    $m = static fn (string $col) => "LEFT JOIN `wp_postmeta` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = 'zero_$col'";
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

    return new Source('`wp_posts`', "{a}.post_type = 'zero_notes' AND {a}.post_status NOT IN ('trash', 'auto-draft', 'inherit')", $refs);
}

/** A Store that only answers dialect()/source(): enough to compile. */
final class CompileOnlyStore implements Store
{
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
    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void {}
    public function revision(string $collection, int|string $pk, int $revisionId): ?array { return null; }
    public function promoteDue(string $collection, string $nowIso): array { return []; }
    public function mapError(\Throwable $e): \Throwable { return $e; }
}

$mysql = Dialect::mysql('utf8mb4_unicode_ci');
$wp = new CompileOnlyStore($mysql, [
    'notes' => postSource($columns),
    'logs' => Source::plain($mysql, '`wp_zero_logs`', $schema->collection('logs')['columns']),
]);
/** WHERE clause of a compiled MySQL read on notes (everything after the outer WHERE). */
$where = static function (array $filter, string $c = 'notes') use ($schema, $wp): array {
    $q = Sql::select($schema, $wp, $c, ['where' => $filter]);
    $base = $c === 'notes' ? "t0.post_type = 'zero_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND " : '';
    $w = substr($q['sql'], strpos($q['sql'], ' WHERE ') + 7);

    return [str_starts_with($w, $base) ? substr($w, strlen($base)) : "<missing baseWhere> $w", $q['params']];
};

// ================================================================ MySQL, post-backed

$q = Sql::select($schema, $wp, 'logs', ['where' => ['level' => 'warn'], 'orderBy' => ['id' => 'desc'], 'limit' => 5, 'offset' => 10]);
eq('plain MySQL table: full statement', $q, [
    'sql' => 'SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels` FROM `wp_zero_logs` t0 WHERE t0.`level` = ? ORDER BY t0.`id` DESC LIMIT 5 OFFSET 10',
    'params' => ['warn'],
]);

$q = Sql::select($schema, $wp, 'notes', ['where' => ['rating' => ['gte' => 3]], 'orderBy' => ['rating' => 'desc']]);
check('post-backed: base table, baseWhere, a typed CAST for filter + order, one join per column',
    str_starts_with($q['sql'], 'SELECT t0.ID AS `id`, t0.post_title AS `title`, t0.post_content AS `body`, t0.post_name AS `slug`, NULLIF(t0_m4.meta_value, \'\') AS `rating`, ')
    && str_contains($q['sql'], " FROM `wp_posts` t0 LEFT JOIN `wp_postmeta` t0_m4 ON t0_m4.post_id = t0.ID AND t0_m4.meta_key = 'zero_rating' ")
    && substr_count($q['sql'], 'meta_key = \'zero_rating\'') === 1
    && str_ends_with($q['sql'], " WHERE t0.post_type = 'zero_notes' AND t0.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) >= ? ORDER BY CAST(NULLIF(t0_m4.meta_value, '') AS SIGNED) DESC")
    && $q['params'] === [3],
    $q);
check('group/repeater columns select NULL and cost no join', str_contains($q['sql'], 'NULL AS `seo`') && !str_contains($q['sql'], "'zero_seo'"), $q['sql']);
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
eq('isNull on a repeater: no rows / zero count', $where(['steps' => ['isNull' => true]]), ["NULLIF(NULLIF(t0_m13.meta_value, ''), '0') IS NULL", []]);
eq('relation filter into a plain table', $where(['logs' => ['level' => 'warn']]),
    ['EXISTS (SELECT 1 FROM `wp_zero_logs` t1 WHERE t1.`noteId` = t0.ID AND t1.`level` = ?)', ['warn']]);
eq('relation filter into a post-backed collection carries its baseWhere and joins', $where(['note' => ['rating' => 5]], 'logs'),
    ["EXISTS (SELECT 1 FROM `wp_posts` t1 LEFT JOIN `wp_postmeta` t1_m4 ON t1_m4.post_id = t1.ID AND t1_m4.meta_key = 'zero_rating' WHERE t1.post_type = 'zero_notes' AND t1.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND t1.ID = t0.`noteId` AND CAST(NULLIF(t1_m4.meta_value, '') AS SIGNED) = ?)", [5]]);
eq('custom-table list: JSON_CONTAINS with a JSON param', $where(['labels' => ['has' => 'a']], 'logs'), ['JSON_CONTAINS(t0.`labels`, ?)', ['"a"']]);

$q = Sql::select($schema, $wp, 'logs', ['orderBy' => ['level' => 'asc'], 'limit' => 2], ['noteId', [1, 2]]);
eq('with batch: per-parent window on MySQL', $q, [
    'sql' => 'SELECT * FROM (SELECT t0.`id` AS `id`, t0.`noteId` AS `noteId`, t0.`level` AS `level`, t0.`labels` AS `labels`, ROW_NUMBER() OVER (PARTITION BY t0.`noteId` ORDER BY t0.`level` ASC) AS __zero_rn FROM `wp_zero_logs` t0 WHERE t0.`noteId` IN (?, ?)) z WHERE z.__zero_rn > 0 AND z.__zero_rn <= 2 ORDER BY z.__zero_rn',
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

// ================================================================ SQLite, executed

$pdo = SqliteStore::connect(':memory:');
$lite = new SqliteStore($pdo, $schema);
$pdo->exec('CREATE TABLE "notes" ("id" integer PRIMARY KEY, "title" text, "body" text, "slug" text, "rating" integer, "score" real, "pinned" integer, "note" text, "due" text, "seenAt" text, "tags" text, "photos" text, "seo" text, "steps" text, "extra" text, "status" text, "publishedAt" text)');
$pdo->exec('CREATE TABLE "logs" ("id" integer PRIMARY KEY, "noteId" integer, "level" text, "labels" text)');
$pdo->exec(<<<'SQL'
    INSERT INTO "notes" ("id", "title", "rating", "tags", "photos", "seo", "extra", "status") VALUES
      (1, 'One', 5, '["news","guide"]', '[3,12]', '{"metaTitle":"m"}', '{"a":1}', 'published'),
      (2, 'Two', 1, '[]', NULL, NULL, '[1,2]', 'draft'),
      (3, 'Three', 3, '["guide"]', '[120]', NULL, NULL, 'published');
    INSERT INTO "logs" ("id", "noteId", "level") VALUES (1, 1, 'a'), (2, 1, 'b'), (3, 1, 'c'), (4, 3, 'a');
    SQL);
$ids = static fn (array $opts, ?array $partition = null, string $c = 'notes') => array_map(
    static fn ($r) => $r['id'],
    $lite->select($c, Sql::select($schema, $lite, $c, $opts, $partition)),
);
eq('SQLite has: json_each exact element', [$ids(['where' => ['tags' => ['has' => 'news']]]), $ids(['where' => ['photos' => ['has' => 12]]])], [[1], [1]]);
eq('SQLite eq [] and isNull on lists', [$ids(['where' => ['tags' => []]]), $ids(['where' => ['photos' => ['isNull' => true]]])], [[2], [2]]);
eq('SQLite JSON whole-value eq compares canonical text', [$ids(['where' => ['extra' => ['a' => 1]]]), $ids(['where' => ['extra' => [1, 2]]]), $ids(['where' => ['seo' => ['ne' => ['metaTitle' => 'm']]]])], [[1], [2], []]);
eq('SQLite per-parent window', $ids(['orderBy' => ['level' => 'desc'], 'limit' => 2, 'offset' => 0], ['noteId', [1, 3]], 'logs'), [3, 4, 2]);
eq('SQLite relation filter + NOT', $ids(['where' => ['NOT' => ['logs' => true]], 'orderBy' => ['id' => 'asc']]), [2]);
$q = Sql::select($schema, $lite, 'notes', ['where' => ['title' => ['ilike' => 'o%']]]);
check('SQLite like uses zero_like with the ci flag', str_ends_with($q['sql'], 'WHERE zero_like(t0."title", ?, 1)'), $q['sql']);
check('SQLite offset without limit', str_ends_with(Sql::select($schema, $lite, 'logs', ['offset' => 3])['sql'], ' LIMIT -1 OFFSET 3'));

finish('sql_test');
