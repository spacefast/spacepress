<?php

declare(strict_types=1);

/*
 * The page cache's read log (First\Render\Cache::record) on WordPress on SQLite: what a cacheable
 * render read is stored per URL in few statements, a render that read the same rows as last time
 * writes nothing, and the purge lookups still find every URL that read a row or listed its kind.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$wp = wpSite('page-reads', ['schema' => $schema, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')]);
$wp->app();
// A host page cache listens, so renders record what they read.
add_action('first_purge_urls', static function (): void {});

$statements = [];
\First\Wp\Connection::$observer = static function (string $sql) use (&$statements): void {
    $statements[] = $sql;
};
$record = static function (string $uri, array $reads) use (&$statements): array {
    $statements = [];
    \First\Render\Cache::record($uri, $reads);
    $writes = array_values(array_filter($statements, static fn (string $s): bool => preg_match('/^\s*(INSERT|DELETE|UPDATE)/i', $s) === 1));

    return ['statements' => count($statements), 'writes' => count($writes)];
};
$log = static fn (string $url): array => array_map(static fn (array $r): string => "{$r['kind']} {$r['item']}",
    $wp->sql('SELECT `kind`, `item` FROM {prefix}first__app_reads WHERE `url` = ? ORDER BY `kind`, `item`', [$url]));

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
$cost = $record('/many/', ['posts' => ['ids' => range(1, \First\Render\Cache::MAX_IDS + 1), 'listed' => false]]);
eq('past MAX_IDS the kind is recorded as listed', $log('/many/'), ['posts *']);

// The purge lookups read what was recorded.
$purged = [];
add_action('first_purge_urls', static function (array $urls) use (&$purged): void { $purged = [...$purged, ...$urls]; });
$record('/a/', ['posts' => ['ids' => [41], 'listed' => false]]);
$record('/b/', ['posts' => ['ids' => [], 'listed' => true]]);
eq('a row\'s own pages', array_map(static fn (string $u): string => (string) parse_url($u, PHP_URL_PATH), \First\Render\Cache::itemUrls('posts', 41)), ['/a/', '/a']);
\First\Wp\Connection::$observer = null;
finish('page_reads');
