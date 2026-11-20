<?php

declare(strict_types=1);

/*
 * The page cache's read log (TypedPress\Render\Cache::record) on WordPress on SQLite: what a cacheable
 * render read is stored per URL in few statements, a render that read the same rows as last time
 * writes nothing, and the purge lookups still find every URL that read a row or listed its kind.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// A SQL table with a unique column: no drafts, so one value is one row.
$schema['collections']['tags'] = ['key' => 'tags', 'primaryKey' => 'id', 'columns' => [
    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
    'label' => ['type' => 'text', 'notNull' => true, 'unique' => true],
]];
$wp = wpSite('page-reads', ['schema' => $schema, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')]);
$wp->app();
// A host page cache listens, so renders record what they read.
add_action('tp_purge_urls', static function (): void {});

$statements = [];
\TypedPress\Wp\Connection::$observer = static function (string $sql) use (&$statements): void {
    $statements[] = $sql;
};
$record = static function (string $uri, array $reads, array $also = []) use (&$statements): array {
    $statements = [];
    \TypedPress\Render\Cache::record($uri, $reads, $also);
    $writes = array_values(array_filter($statements, static fn (string $s): bool => preg_match('/^\s*(INSERT|DELETE|UPDATE)/i', $s) === 1));

    return ['statements' => count($statements), 'writes' => count($writes)];
};
$log = static fn (string $url): array => array_map(static fn (array $r): string => "{$r['kind']} {$r['item']}",
    $wp->sql('SELECT `kind`, `item` FROM {prefix}tp__app_reads WHERE `url` = ? ORDER BY `kind`, `item`', [$url]));

$ids = range(1, 250);
$cost = $record('/notes/', ['posts' => ['ids' => $ids, 'listed' => true], 'comments' => ['ids' => [7, 8], 'listed' => false]]);
eq('253 rows recorded (posts listed, 250 posts, 2 comments)', count($log('/notes/')), 253);
check('in a handful of statements, not one per row', $cost['statements'] <= 8, $cost);
$cost = $record('/notes/', ['posts' => ['ids' => $ids, 'listed' => true], 'comments' => ['ids' => [8, 7], 'listed' => false]]);
eq('the same reads again write nothing', [$cost['writes'], count($log('/notes/'))], [0, 253]);
check('and read the log once', $cost['statements'] === 1, $cost);
$cost = $record('/notes/', ['posts' => ['ids' => [3], 'listed' => false]]);
eq('other reads replace the URL\'s log', $log('/notes/'), ['posts 3']);
$record('/about/', []);
eq('a render that read nothing keeps no rows', $log('/about/'), []);
$cost = $record('/many/', ['posts' => ['ids' => range(1, \TypedPress\Render\Cache::MAX_IDS + 1), 'listed' => false]]);
eq('past MAX_IDS the kind is recorded as listed', $log('/many/'), ['posts *']);

\TypedPress\Wp\Connection::$observer = null;

// What was recorded is what a write purges: the page that read the row and the page that listed the
// kind are announced, other pages are not; a page whose new render read nothing loses its rows.
$purged = [];
add_action('tp_purge_urls', static function (array $urls) use (&$purged): void { $purged = [...$purged, ...$urls]; });
$db = $wp->app()->db;
$post = $db->insert('posts', ['title' => 'Read by a page'], true)[0];
$other = $db->insert('posts', ['title' => 'Read by nobody'], true)[0];
\TypedPress\Wp\Purges::flush();
$record('/a/', ['posts' => ['ids' => [$post['id']], 'listed' => false]]);
$record('/b/', ['posts' => ['ids' => [], 'listed' => true]]);
$record('/c/', ['posts' => ['ids' => [$other['id']], 'listed' => false]]);
$record('/d/', ['comments' => ['ids' => [1], 'listed' => true]]);
// At the page's one address only: the bare spelling redirects there, so no cache holds it.
eq('a row\'s own pages', array_map(static fn (string $u): string => (string) parse_url($u, PHP_URL_PATH), \TypedPress\Render\Cache::itemUrls('posts', $post['id'])), ['/a/']);
$paths = static function () use (&$purged): array {
    $out = array_values(array_unique(array_map(static fn (string $u): string => (string) parse_url($u, PHP_URL_PATH), $purged)));
    sort($out);
    $purged = [];

    return $out;
};
$purged = [];
$db->update('posts', ['title' => 'Read by a page, edited'], ['id' => $post['id']]);
\TypedPress\Wp\Purges::flush();
$announced = $paths();
check('a write announces the page that read the row and the page that listed the kind', array_intersect(['/a/', '/b/'], $announced) === ['/a/', '/b/'], $announced);
check('and not a page that read another row, or another kind', !in_array('/c/', $announced, true) && !in_array('/d/', $announced, true), $announced);
// /a/ renders again and reads nothing: its rows go, and the next write no longer announces it.
$record('/a/', []);
eq('a recorded set replaced by an empty one leaves no rows', $log('/a/'), []);
$db->update('posts', ['title' => 'Edited again'], ['id' => $post['id']]);
\TypedPress\Wp\Purges::flush();
$announced = $paths();
check('so the next write announces the listing page only', in_array('/b/', $announced, true) && !in_array('/a/', $announced, true), $announced);
// ---- what a read is recorded as (Render\Reads): its rows alone only when its query names them ----
$author = $db->insert('authors', ['name' => 'Ann', 'email' => 'ann@example.test'], true)[0];
$mine = $db->insert('posts', ['title' => 'Mine', 'slug' => 'mine', 'authorId' => $author['id'], 'status' => 'published'], true)[0];
$db->insert('comments', ['postId' => $mine['id'], 'name' => 'Bo', 'body' => 'First'], true);
$db->insert('tags', ['label' => 'red'], true);
$reading = static function (callable $fn) use ($db): array {
    \TypedPress\Render\Reads::during(static fn () => $fn($db), $reads, $also);

    return [array_map(static fn (array $r): array => [count($r['ids']), $r['listed']], $reads), $also];
};
$pk = $mine['id'];
foreach ([
    'by primary key' => [static fn ($db) => $db->findMany('posts', ['where' => ['id' => $pk]]), ['posts' => [1, false]]],
    'by primary key, written as `eq`' => [static fn ($db) => $db->findFirst('posts', ['where' => ['id' => ['eq' => $pk]]]), ['posts' => [1, false]]],
    // Drafts may share a slug until one is published, so a unique column names one row only for a
    // read that sees published rows alone: a visitor's, or one whose `where` says so.
    'by a unique column, as a visitor' => [static fn ($db) => $db->findFirst('posts', ['where' => ['slug' => 'mine']], new \TypedPress\Viewer(null)), ['posts' => [1, false]]],
    'by a unique column, published rows only' => [static fn ($db) => $db->findFirst('posts', ['where' => ['slug' => 'mine', 'status' => 'published']]), ['posts' => [1, false]]],
    'by a unique column, drafts in sight' => [static fn ($db) => $db->findFirst('posts', ['where' => ['slug' => 'mine']]), ['posts' => [1, true]]],
    'by a unique column, as an editor who reads drafts' => [static fn ($db) => $db->findFirst('posts', ['where' => ['slug' => 'mine']], new \TypedPress\Viewer(['id' => 1, 'name' => 'admin', 'role' => 'admin'])), ['posts' => [1, true]]],
    'by a unique column of a kind without drafts' => [static fn ($db) => $db->findFirst('tags', ['where' => ['label' => 'red']]), ['tags' => [1, false]]],
    'the row a URL names' => [static fn ($db) => \TypedPress\Render\Reads::named('posts', static fn () => $db->findFirst('posts', ['where' => ['slug' => 'mine']])), ['posts' => [1, false]]],
    'by a list of keys, all found' => [static fn ($db) => $db->findMany('posts', ['where' => ['id' => ['in' => [$pk, $post['id']]]]]), ['posts' => [2, false]]],
    // One of the named rows is missing: a write to any row could bring it in.
    'by a list of keys, one missing' => [static fn ($db) => $db->findMany('posts', ['where' => ['id' => ['in' => [$pk, 999999]]]]), ['posts' => [1, true]]],
    'by a key that finds nothing' => [static fn ($db) => $db->findFirst('posts', ['where' => ['id' => 999999]]), ['posts' => [0, true]]],
    // A filter, a rank and an unfiltered read are listings, also when one row comes back.
    'a filter that matched one row' => [static fn ($db) => $db->findMany('posts', ['where' => ['authorId' => $author['id']]]), ['posts' => [1, true]]],
    'the first row by rank' => [static fn ($db) => $db->findFirst('posts', ['orderBy' => ['id' => 'desc']]), ['posts' => [1, true]]],
    'a key under OR' => [static fn ($db) => $db->findMany('posts', ['where' => ['OR' => [['id' => $pk]]]]), ['posts' => [1, true]]],
    // Relations: the row a foreign key names is that row; a parent's children are a listing.
    'a row with the one it refers to' => [static fn ($db) => $db->findMany('posts', ['where' => ['id' => $pk], 'with' => ['authorId' => true]]), ['posts' => [1, false], 'authors' => [1, false]]],
    'a row with its children' => [static fn ($db) => $db->findMany('posts', ['where' => ['id' => $pk], 'with' => ['comments' => true]]), ['posts' => [1, false], 'comments' => [1, true]]],
    'a count' => [static fn ($db) => $db->count('posts', ['id' => $pk]), ['posts' => [0, true]]],
] as $what => [$read, $want]) {
    eq("recorded: $what", $reading($read)[0], $want);
}
eq('a render that reads a global records it', $reading(static fn ($db) => $db->globalGet('settings')), [[], ['global:settings']]);
eq('once, however often it is read', $reading(static function ($db): void {
    $db->globalGet('settings');
    $db->globalGet('settings');
})[1], ['global:settings']);
\TypedPress\Render\Reads::during(static function () use ($db, $pk): void {
    \TypedPress\Render\Reads::during(static fn () => $db->globalGet('settings'));
    $db->findFirst('posts', ['where' => ['id' => $pk]]);
}, $outer, $outerAlso);
eq('a nested recording keeps its own reads', [array_keys($outer), $outerAlso], [['posts'], []]);
eq('nothing is recorded outside a render', \TypedPress\Render\Reads::recording(), false);

// The URL a write to a global purges: the pages that read it, with their twins, after the commit.
$record('/priced/', ['posts' => ['ids' => [], 'listed' => true]], ['global:settings']);
$record('/plain/', ['posts' => ['ids' => [], 'listed' => true]]);
eq('a global read is one row of the log', $log('/priced/'), ['global:settings *', 'posts *']);
$purged = [];
$db->globalUpdate('settings', ['siteTitle' => 'New title']);
\TypedPress\Wp\Purges::flush();
eq('a write to a global announces the pages that read it, and no other', $paths(), ['/priced.md', '/priced/']);
// A repeater's values are options below the field's own (`…_social_0_label`): a change to one
// of them alone, with the row count as it was, is a write to the global too.
$db->globalUpdate('settings', ['social' => [['label' => 'Mastodon', 'href' => 'https://example.test/@a']]]);
\TypedPress\Wp\Purges::flush();
$purged = [];
$db->globalUpdate('settings', ['social' => [['label' => 'Fediverse', 'href' => 'https://example.test/@a']]]);
\TypedPress\Wp\Purges::flush();
eq('a change inside a global\'s repeater announces the pages that read it', $paths(), ['/priced.md', '/priced/']);
$purged = [];
$db->globalUpdate('settings', ['siteTitle' => 'New title']);
\TypedPress\Wp\Purges::flush();
eq('a write that changes nothing announces nothing', $paths(), []);
$purged = [];
try {
    $db->transaction(static function () use ($db): void {
        $db->globalUpdate('settings', ['siteTitle' => 'Never']);
        throw new \RuntimeException('rollback');
    });
} catch (\RuntimeException) {
}
\TypedPress\Wp\Purges::flush();
eq('a rolled-back write to a global announces nothing', $paths(), []);
eq('and leaves the global as it was', $db->globalGet('settings')['siteTitle'], 'New title');

// ---- query strings: only a page's declared parameters make a URL of its own ----
foreach ([
    ['/notes/', [], true], ['/notes/?page=2', ['page'], true], ['/notes/?page=2&q=a', ['page', 'q'], true],
    ['/notes/?page=2&utm_source=x', ['page'], false], ['/notes/?junk=1', [], false], ['/notes/?', [], false],
    ['/notes/?page=2&page=3', ['page'], true], ['/notes/?%70age=2', ['page'], true],
    ['/notes/?q=' . str_repeat('a', 600), ['q'], false],
    ['/notes/?q=' . str_repeat('a', 200), ['q'], false],
    ['/' . str_repeat('a', 200) . '/', [], false],
] as [$uri, $declared, $want]) {
    eq("shareable: $uri", \TypedPress\Render\Cache::shareable($uri, $declared), $want);
}
eq('an undeclared parameter records nothing', [\TypedPress\Render\Cache::record('/x/?junk=1', ['posts' => ['ids' => [1], 'listed' => false]]), $log('/x/?junk=1')], [false, []]);
// A search page can render without reading any data. Its query variants still count.
$limit = \TypedPress\Render\Cache::MAX_VARIANTS;
$admitted = 0;
for ($i = 0; $i <= $limit; $i++) {
    $admitted += (int) \TypedPress\Render\Cache::record("/empty/?q=$i", [], [], ['q']);
}
eq('even empty reads admit at most MAX_VARIANTS query URLs', $admitted, $limit);
finish('page_reads');
