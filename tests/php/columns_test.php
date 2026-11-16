<?php

declare(strict_types=1);

/*
 * `columns` pushed into SQL (Db::selected, Sql::select's `$only`) on WordPress on SQLite: a read
 * that asks for some columns selects only those plus what the pipeline needs (the primary key,
 * relation keys, `with` fields, child linkage), with no join for the rest, and returns exactly
 * what it returned when every column was read and then dropped. Post-backed (blog `posts`, meta
 * fields, select/media/group/repeater/blocks), table-backed (`comments`) and term-backed (a
 * taxonomy, in tests/php/taxonomy_test.php) stores; field read rules; `with` both ways.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// A field only editors read (a shorthand rule: decided without the row).
$schema['collections']['posts']['columns']['excerpt']['access'] = ['read' => ['role' => 'editor']];
$wp = wpSite('columns', ['schema' => $schema, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')]);
$db = $wp->app()->db;

$author = $db->insert('authors', ['name' => 'Ann', 'email' => 'ann@example.com', 'bio' => 'Writes'], true)[0];
foreach (range(1, 3) as $n) {
    $post = $db->insert('posts', ['title' => "Post $n", 'excerpt' => "Excerpt $n", 'body' => "<p>Body $n</p>", 'tags' => ['news'], 'authorId' => $author['id'],
        'seo' => ['metaTitle' => "Meta $n"], 'sections' => [['layout' => 'quote', 'text' => "q$n"]]], true)[0];
    foreach (range(1, 2) as $c) {
        $db->insert('comments', ['postId' => $post['id'], 'name' => "C$n.$c", 'body' => "Comment $n.$c", 'approved' => true]);
    }
}

$statements = [];
\TypedPress\Wp\Connection::$observer = static function (string $sql) use (&$statements): void {
    $statements[] = $sql;
};
/** The first statement a read ran against $table, and what it returned. @return array{string, list<array>} */
$read = static function (string $collection, array $opts, ?\TypedPress\Viewer $viewer = null, string $table = 'wp_posts') use ($db, &$statements): array {
    $statements = [];
    $rows = $db->findMany($collection, $opts, $viewer);
    $sql = '';
    foreach ($statements as $s) {
        if (str_contains($s, "FROM `$table` t0")) {
            $sql = $s;
            break;
        }
    }

    return [$sql, $rows];
};
/** The same read with every column, the result reduced to what `columns` keeps (what Db::project did). */
$expected = static function (string $collection, array $opts, ?\TypedPress\Viewer $viewer = null) use ($db): array {
    $columns = $opts['columns'];
    unset($opts['columns']);
    $known = array_keys($db->schema()->collection($collection)['columns']);
    $included = array_keys(array_filter($columns, static fn ($on) => $on === true));
    $keep = $included !== [] ? $included : array_diff($known, array_keys(array_filter($columns, static fn ($on) => $on === false)));
    $keep = [...$keep, ...array_keys($opts['with'] ?? [])];

    return array_map(static fn (array $row): array => array_intersect_key($row, array_flip($keep)), $db->findMany($collection, $opts, $viewer));
};
$anon = new \TypedPress\Viewer(null);
$editor = new \TypedPress\Viewer($wp->user('editor'));

// ---- post-backed ---------------------------------------------------------------------------------
$opts = ['columns' => ['title' => true], 'orderBy' => ['id' => 'asc']];
[$sql, $rows] = $read('posts', $opts);
eq('posts: the rows are what reading every column gave', $rows, $expected('posts', $opts));
check('posts: no meta join, no column it did not ask for', !str_contains($sql, 'wp_postmeta') && !str_contains($sql, 'AS `body`') && !str_contains($sql, 'AS `excerpt`') && str_contains($sql, 'AS `title`') && str_contains($sql, 'AS `id`'), $sql);

$opts = ['columns' => ['body' => false, 'seo' => false, 'gallery' => false, 'sections' => false, 'tags' => false], 'orderBy' => ['id' => 'desc']];
[$sql, $rows] = $read('posts', $opts);
eq('posts, columns excluded: same rows', $rows, $expected('posts', $opts));
check('posts, columns excluded: those are not selected', !str_contains($sql, 'AS `body`') && !str_contains($sql, 'AS `tags`') && str_contains($sql, 'AS `excerpt`'), $sql);

$opts = ['columns' => ['title' => true, 'tags' => true, 'seo' => true, 'cover' => true], 'where' => ['excerpt' => 'Excerpt 2']];
[$sql, $rows] = $read('posts', $opts);
eq('posts: select, group and media columns read as before, a filter on an unselected field still applies', $rows, $expected('posts', $opts));
check('posts: the filter joins its own field, the select list holds only what was asked', str_contains($sql, "meta_key = 'tp_excerpt'") && !str_contains($sql, 'AS `excerpt`'), $sql);

$opts = ['columns' => ['title' => true], 'with' => ['authorId' => true, 'comments' => ['columns' => ['name' => true], 'orderBy' => ['id' => 'asc']]], 'orderBy' => ['id' => 'asc']];
[$sql, $rows] = $read('posts', $opts);
eq('posts with relations: the parent keeps its relation key, the children theirs', $rows, $expected('posts', $opts));
check('posts with relations: the relation key is read though not asked for', str_contains($sql, 'AS `authorId`'), $sql);
[$childSql] = $read('posts', $opts, null, 'wp_tp_comments');
check('comments under posts: only the asked column, its key and its link', str_contains($childSql, '`name` AS `name`') && str_contains($childSql, 'AS `postId`') && !str_contains($childSql, 'AS `body`'), $childSql);

// Field rules: the result as each viewer saw it before.
$opts = ['columns' => ['title' => true, 'excerpt' => true], 'orderBy' => ['id' => 'asc']];
eq('an editor reads the editor-only field it asked for', $read('posts', $opts, $editor)[1], $expected('posts', $opts, $editor));
problem('a visitor selecting it is refused, as before', static fn () => $db->findMany('posts', $opts, $anon), 403, 'forbidden', '/columns/excerpt');
$opts = ['columns' => ['title' => true], 'orderBy' => ['id' => 'asc']];
eq('a visitor\'s read of other columns', $read('posts', $opts, $anon)[1], $expected('posts', $opts, $anon));

// ---- table-backed --------------------------------------------------------------------------------
$opts = ['columns' => ['body' => true], 'orderBy' => ['id' => 'asc'], 'limit' => 3];
[$sql, $rows] = $read('comments', $opts, null, 'wp_tp_comments');
eq('comments: same rows', $rows, $expected('comments', $opts));
check('comments: only the asked column and the key', str_contains($sql, '`body` AS `body`') && !str_contains($sql, 'AS `name`') && !str_contains($sql, 'AS `createdAt`'), $sql);
$opts = ['columns' => ['name' => true], 'with' => ['postId' => ['columns' => ['title' => true]]], 'orderBy' => ['id' => 'asc']];
[$sql, $rows] = $read('comments', $opts, null, 'wp_tp_comments');
eq('comments with their post: same rows', $rows, $expected('comments', $opts));
check('comments with their post: the relation key is read', str_contains($sql, 'AS `postId`'), $sql);

// ---- what turns pruning off -------------------------------------------------------------------------
// No `columns`, or columns that keep everything: every column, as before.
[$sql] = $read('posts', ['orderBy' => ['id' => 'asc']]);
check('no columns option: every column is selected', str_contains($sql, 'AS `body`') && str_contains($sql, 'AS `excerpt`'), $sql);
// An unknown column is refused as before (after the read, by project()).
problem('an unknown column is refused as before', static fn () => $db->findMany('posts', ['columns' => ['nope' => true]]), 400, 'invalid_query', '/columns/nope');
// A read extension that didn't say which columns it reads sees whole rows.
$seen = [];
\TypedPress\Extensions::onRead(static function (array $rows, string $collection) use (&$seen): array {
    if ($collection === 'posts') {
        $seen = array_column($rows, 'body');
    }

    return $rows;
}, true);
$opts = ['columns' => ['title' => true], 'orderBy' => ['id' => 'asc']];
[$sql, $rows] = $read('posts', $opts);
check('with such an extension every column is read', str_contains($sql, 'AS `body`') && $seen === ['<p>Body 1</p>', '<p>Body 2</p>', '<p>Body 3</p>'], [$sql, $seen]);
eq('and the result is the same', $rows, $expected('posts', $opts));

\TypedPress\Wp\Connection::$observer = null;
finish('columns');
