<?php

declare(strict_types=1);

/*
 * Search (docs/decisions/2026-11-13-search-index.md) on the blog fixture, in-process on WordPress on
 * SQLite: the index kept in step by every write path, `search` on a kind and on core's list route,
 * and the site-wide endpoint, each read as the caller so that a hidden row or field can't be found,
 * counted or ranked.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// A field only editors read: its text must never qualify a row for anyone else.
$schema['collections']['posts']['columns']['excerpt']['access'] = ['read' => ['role' => 'editor']];
// A kind nobody signed out may read at all.
$schema['collections']['authors']['access']['read'] = ['role' => 'authenticated'];
$wp = wpSite('search', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'users' => ['ed' => 'editor', 'alice' => 'author', 'sub' => 'subscriber'],
]);
$db = \First\db();
$prefix = $wp->connection()->prefix();
$index = static fn (string $kind): array => array_map(static fn (array $r): string => $r['field'] . ':' . $r['body'],
    $wp->sql("SELECT `field`, `body` FROM `{$prefix}first__search` WHERE `kind` = ? ORDER BY `item`, `field`", [$kind]));

wp_set_current_user(1);
$public = $db->insert('posts', ['title' => 'Brewing green tea', 'body' => '<!-- wp:paragraph --><p>Steep the leaves &amp; wait.</p><!-- /wp:paragraph -->', 'status' => 'published'], true)[0];
$draft = $db->insert('posts', ['title' => 'Draft about teapots', 'status' => 'draft'], true)[0];
$secret = $db->insert('posts', ['title' => 'Coffee notes', 'excerpt' => 'Mentions tea only in the excerpt', 'status' => 'published'], true)[0];
$approved = $db->insert('comments', ['postId' => $public['id'], 'name' => 'Kim', 'body' => 'Lovely tea', 'approved' => true], true)[0];
$pending = $db->insert('comments', ['postId' => $public['id'], 'name' => 'Lee', 'body' => 'Spam tea offer', 'approved' => false], true)[0];
$db->insert('authors', ['name' => 'Tea Writer', 'email' => 'tea@example.test', 'status' => 'published']);
wp_set_current_user(0);

// ---------------------------------------------------------------- the index follows every write

check('a create indexes the row as a reader sees it: no markup, entities decoded',
    in_array('body:Steep the leaves & wait.', $index('posts'), true), $index('posts'));
check('the draft is indexed too: whether it shows is the read\'s decision', in_array('title:Draft about teapots', $index('posts'), true));
wp_set_current_user(1);
$db->update('posts', ['title' => 'Brewing oolong'], ['id' => $public['id']]);
check('an update replaces the row\'s entries', in_array('title:Brewing oolong', $index('posts'), true) && !in_array('title:Brewing green tea', $index('posts'), true), $index('posts'));
// wp-admin's and core REST's saves run First's hooks through EditorSave, and report the same way.
wp_update_post(['ID' => $public['id'], 'post_title' => 'Brewing green tea']);
check('a core save (wp-admin, /wp/v2) re-indexes the row', in_array('title:Brewing green tea', $index('posts'), true), $index('posts'));
$gone = $db->insert('posts', ['title' => 'Ephemeral tea', 'status' => 'published'], true)[0];
$db->delete('posts', ['id' => $gone['id']]);
check('a delete removes the row\'s entries', !in_array('title:Ephemeral tea', $index('posts'), true));
try {
    $db->transaction(static function () use ($db): void {
        $db->insert('posts', ['title' => 'Rolled back tea', 'status' => 'published']);
        throw new \RuntimeException('roll back');
    });
} catch (\RuntimeException) {
}
check('a rolled-back write leaves nothing in the index', !in_array('title:Rolled back tea', $index('posts'), true));
wp_set_current_user(0);

// ---------------------------------------------------------------- `search` on a kind, as the reader

$ids = static fn (array $rows): array => array_map(static fn (array $r): int => (int) $r['id'], $rows);
$as = static fn (?string $who): \First\Viewer => new \First\Viewer($who === null ? null : $wp->user($who));
$list = static fn (string $kind, string $q, ?string $who, array $extra = []): array => $ids(\First\Seam::asVisitor($as($who),
    static fn (): array => $db->findMany($kind, ['where' => [], 'columns' => ['id' => true]] + $extra + ['search' => $q], $as($who))));

eq('a visitor finds the published post by a word of its title', $list('posts', 'green', null), [$public['id']]);
eq('a word is matched from its start: "brew" finds "Brewing"', $list('posts', 'brew', null), [$public['id']]);
eq('but not from inside a word: "rewing" finds nothing', $list('posts', 'rewing', null), []);
eq('the case of the query does not matter', $list('posts', 'GREEN', null), [$public['id']]);
eq('every word must match', $list('posts', 'green coffee', null), []);
eq('a word in the content matches', $list('posts', 'leaves', null), [$public['id']]);
eq('a draft is not found by a visitor', $list('posts', 'teapots', null), []);
eq('the editor finds the draft', $list('posts', 'teapots', 'ed'), [$draft['id']]);
eq('a word only in a field the reader may not read finds nothing', $list('posts', 'excerpt', null), []);
eq('the editor, who reads the field, finds the row by it', $list('posts', 'excerpt', 'ed'), [$secret['id']]);
eq('a search with no word matches nothing', $list('posts', '  !! ', null), []);
eq('count() is the same set: a hidden row is not counted', $db->count('posts', null, $as(null), ['search' => 'tea']), count($list('posts', 'tea', null)));
eq('nor is a row matched only through a hidden field', $db->count('posts', null, $as(null), ['search' => 'mentions']), 0);
eq('a table: the reader\'s filter rule hides the unapproved comment', $list('comments', 'tea', null), [$approved['id']]);
eq('a signed-in reader sees both', $list('comments', 'tea', 'sub'), [$approved['id'], $pending['id']]);
problem('a kind the reader may not read is the same 401 as listing it', static fn () => $list('authors', 'tea', null), 401, 'unauthenticated');

// The API's list route and the compiled `posts.list({ search })` reach the same read.
[$status, $rows] = $wp->call('GET', '/posts', query: ['search' => 'tea', 'limit' => '10']);
eq('the API list finds what a visitor may read', [$status, $ids($rows ?? [])], [200, [$public['id']]]);
[$status, $rows] = $wp->call('GET', '/posts', as: 'ed', query: ['search' => 'tea', 'limit' => '10']);
$found = $ids($rows ?? []);
sort($found);
// The order is the kind's own (posts: newest first), whatever was searched.
eq('and what an editor may read', [$status, $found], [200, [$public['id'], $draft['id'], $secret['id']]]);

// Core's own list route takes the same search, and `search_columns` narrows it to the title.
$core = static function (array $params, ?string $who) use ($wp): array {
    $wp->actAs($who);
    try {
        $request = new \WP_REST_Request('GET', '/wp/v2/first_posts');
        $request->set_query_params($params + ['per_page' => 50]);
        $data = rest_get_server()->response_to_data(rest_do_request($request), false);
    } finally {
        wp_set_current_user(0);
    }
    $out = array_map(static fn (array $r): int => (int) $r['id'], is_array($data) && array_is_list($data) ? $data : []);
    sort($out);
    return $out;
};
eq('core /wp/v2 finds the published post by a word', $core(['search' => 'leaves'], null), [$public['id']]);
eq('search_columns=post_title matches the title only', $core(['search' => 'leaves', 'search_columns' => ['post_title']], null), []);
eq('and finds it by its title', $core(['search' => 'green', 'search_columns' => ['post_title']], null), [$public['id']]);
// A table's core route searches too.
$wp->actAs('sub');
$tableRequest = new \WP_REST_Request('GET', '/wp/v2/first_comments');
$tableRequest->set_query_params(['search' => 'lovely']);
$tableRows = rest_get_server()->response_to_data(rest_do_request($tableRequest), false);
wp_set_current_user(0);
eq('a table\'s core route searches its text fields', array_map(static fn (array $r): int => (int) $r['id'], $tableRows), [$approved['id']]);

// ---------------------------------------------------------------- the site-wide endpoint

[$status, $found] = $wp->call('GET', '/search', query: ['q' => 'tea']);
eq('one search over every kind, as the caller', [$status, array_map(static fn (array $r): array => [$r['kind'], $ids($r['rows'])], $found['results'] ?? [])],
    [200, [['posts', [$public['id']]], ['comments', [$approved['id']]]]]);
check('a kind the caller may not read is left out, not refused', !in_array('authors', array_column($found['results'] ?? [], 'kind'), true), $found);
check('a hidden field is never in a result row', !array_key_exists('excerpt', $found['results'][0]['rows'][0] ?? []), $found);
[, $signed] = $wp->call('GET', '/search', as: 'sub', query: ['q' => 'tea writer']);
eq('a signed-in reader finds the author', array_column($signed['results'] ?? [], 'kind'), ['authors']);
[, $only] = $wp->call('GET', '/search', query: ['q' => 'tea', 'kinds' => 'comments,nope']);
eq('kinds= narrows it; an unknown kind adds nothing', array_column($only['results'] ?? [], 'kind'), ['comments']);
[$status, $refused] = $wp->call('GET', '/search', query: ['q' => '??']);
eq('q needs a word', [$status, $refused['code'] ?? null], [400, 'invalid_query']);

// ---------------------------------------------------------------- a rebuild through the job

$wp->exec("DELETE FROM `{$prefix}first__search`");
eq('with the index emptied, nothing is found', $list('posts', 'green', null), []);
wp_set_current_user(1);
\First\Search\Index::rebuild(['kind' => 'posts', 'after' => null]);
wp_set_current_user(0);
eq('the reindex job brings it back', $list('posts', 'green', null), [$public['id']]);

finish('search_test');
