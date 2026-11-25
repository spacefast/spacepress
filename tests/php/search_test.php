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
// The content too: a search still runs for everyone, over the fields each reader may read.
$schema['collections']['posts']['columns']['body']['access'] = ['read' => ['role' => 'editor']];
// A kind nobody signed out may read at all.
$schema['collections']['authors']['access']['read'] = ['role' => 'authenticated'];
// An after-hook that writes its own row again: the index holds the final text, not the create's.
$schema['collections']['comments']['hooks']['afterUpdate'] = 'comments__afterUpdate';
// Items with addresses, for core's /wp/v2/search (the editor's link picker).
$schema['collections']['posts']['url'] = '/blog/:slug';
$schema['collections']['authors']['url'] = '/authors/:id';
// A kind whose read rule hides some rows from everyone but editors, and whose title only editors read.
$notes = $schema['collections']['authors'];
$notes['key'] = 'notes';
$notes['label'] = 'Notes';
$notes['relations'] = [];
$notes['url'] = '/notes/:id';
$notes['wp'] = ['postType' => 'sp_notes', 'groupKey' => 'group_sp_notes', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_notes_'];
$notes['access']['read'] = ['fn' => 'notes__access__read'];
$notes['columns']['name']['access'] = ['read' => ['role' => 'editor']];
$schema['collections']['notes'] = $notes;
// A kind whose address shows a referenced item's slug that only editors read (`/stories/:topic.slug/:id`).
$topics = $schema['collections']['authors'];
$topics['key'] = 'topics';
$topics['label'] = 'Topics';
$topics['relations'] = [];
$topics['slug'] = 'slug';
$topics['columns']['slug'] = ['type' => 'slug', 'source' => 'name', 'access' => ['read' => ['role' => 'editor']]];
$topics['columns']['email']['unique'] = false;
$topics['wp'] = ['postType' => 'sp_topics', 'groupKey' => 'group_sp_topics', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_topics_'];
$schema['collections']['topics'] = $topics;
$stories = $schema['collections']['authors'];
$stories['key'] = 'stories';
$stories['label'] = 'Stories';
$stories['relations'] = [];
$stories['url'] = '/stories/:topic.slug/:id';
$stories['columns']['email']['unique'] = false;
$stories['columns']['topic'] = ['type' => 'integer', 'references' => ['collection' => 'topics', 'column' => 'id', 'onDelete' => 'set null']];
$stories['wp'] = ['postType' => 'sp_stories', 'groupKey' => 'group_sp_stories', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_stories_'];
$schema['collections']['stories'] = $stories;
$wp = wpSite('search', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

        function comments__afterUpdate(\SpacePress\JsObject $row, \SpacePress\JsObject $ctx)
        {
            if (str_contains((string) \SpacePress\Js::prop($row, 'body'), 'rewrite me')) {
                \SpacePress\Seam::update('comments', new \SpacePress\JsObject(['body' => 'Rewritten by the hook']), ['id' => \SpacePress\Js::prop($row, 'id')]);
            }
        }

        function notes__access__read(\SpacePress\JsObject $ctx)
        {
            $user = \SpacePress\Js::prop($ctx, 'user');

            return $user !== null && in_array(\SpacePress\Js::prop($user, 'role'), ['editor', 'admin'], true) ? true : ['email' => ['ne' => 'hidden@example.test']];
        }
        PHP,
    'users' => ['ed' => 'editor', 'alice' => 'author', 'sub' => 'subscriber'],
]);
$db = \SpacePress\db();
$prefix = $wp->connection()->prefix();
$index = static fn (string $kind): array => array_map(static fn (array $r): string => $r['field'] . ':' . $r['body'],
    $wp->sql("SELECT `field`, `body` FROM `{$prefix}sp__search` WHERE `kind` = ? ORDER BY `item`, `field`", [new \SpacePress\Wp\Bytes($kind)]));
$bytes = static fn (string $s): \SpacePress\Wp\Bytes => new \SpacePress\Wp\Bytes($s);

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
// wp-admin's and core REST's saves run SpacePress's hooks through EditorSave, and report the same way.
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
$hooked = $db->insert('comments', ['postId' => $public['id'], 'name' => 'Hook', 'body' => 'Hooked text', 'approved' => true], true)[0];
$db->update('comments', ['body' => 'Please rewrite me'], ['id' => $hooked['id']]);
check('an after-hook\'s own write is what stays indexed, not the outer write\'s older row',
    in_array('body:Rewritten by the hook', $index('comments'), true) && !in_array('body:Please rewrite me', $index('comments'), true), $index('comments'));
$db->delete('comments', ['id' => $hooked['id']]);
// A write that changes no searchable field leaves the row's entries alone (WooCommerce's product
// lookup table does the same: class-wc-product-data-store-cpt.php, update_lookup_table only when a
// looked-up prop changed). A planted entry shows whether they were rewritten.
$plant = static fn () => $wp->exec("UPDATE `{$prefix}sp__search` SET `body` = 'Planted' WHERE `kind` = ? AND `item` = ? AND `field` = ?",
    [$bytes('posts'), $bytes((string) $public['id']), $bytes('title')]);
$plant();
$db->update('posts', ['tags' => ['news']], ['id' => $public['id']]);
check('an update of no searchable field does not rewrite the entries', in_array('title:Planted', $index('posts'), true), $index('posts'));
wp_update_post(['ID' => $public['id'], 'menu_order' => 3]);
check('nor does a core save that changes none', in_array('title:Planted', $index('posts'), true), $index('posts'));
$db->update('posts', ['excerpt' => 'Short summary'], ['id' => $public['id']]);
check('an update of any searchable field rewrites every entry of the row',
    in_array('title:Brewing green tea', $index('posts'), true) && in_array('excerpt:Short summary', $index('posts'), true), $index('posts'));
$db->update('posts', ['excerpt' => null], ['id' => $public['id']]);
check('and a field emptied by an update loses its entry', !in_array('excerpt:Short summary', $index('posts'), true), $index('posts'));
$plant();
wp_update_post(['ID' => $public['id'], 'post_title' => 'Brewing green tea, again']);
wp_update_post(['ID' => $public['id'], 'post_title' => 'Brewing green tea']);
check('a core save that changes the title rewrites it', in_array('title:Brewing green tea', $index('posts'), true), $index('posts'));
wp_set_current_user(0);

// ---------------------------------------------------------------- `search` on a kind, as the reader

$ids = static fn (array $rows): array => array_map(static fn (array $r): int => (int) $r['id'], $rows);
$as = static fn (?string $who): \SpacePress\Viewer => new \SpacePress\Viewer($who === null ? null : $wp->user($who));
$list = static fn (string $kind, string $q, ?string $who, array $extra = []): array => $ids(\SpacePress\Seam::asVisitor($as($who),
    static fn (): array => $db->findMany($kind, ['where' => [], 'columns' => ['id' => true]] + $extra + ['search' => $q], $as($who))));

eq('a visitor finds the published post by a word of its title', $list('posts', 'green', null), [$public['id']]);
eq('a word is matched from its start: "brew" finds "Brewing"', $list('posts', 'brew', null), [$public['id']]);
eq('but not from inside a word: "rewing" finds nothing', $list('posts', 'rewing', null), []);
eq('a word after punctuation starts a word: "&" and "." split', $list('posts', 'wait', 'ed'), [$public['id']]);
wp_set_current_user(1);
$touching = $db->insert('posts', ['title' => 'Two cups', 'body' => '<p>Oolong</p><p>Sencha</p>', 'status' => 'published'], true)[0];
wp_set_current_user(0);
eq('two touching paragraphs are two words: the second one is found', $list('posts', 'sencha', 'ed'), [$touching['id']]);
wp_set_current_user(1);
$db->delete('posts', ['id' => $touching['id']]);
wp_set_current_user(0);
eq('the case of the query does not matter', $list('posts', 'GREEN', null), [$public['id']]);
eq('every word must match', $list('posts', 'green coffee', null), []);
eq('a word in the content matches for a reader of the content', $list('posts', 'leaves', 'ed'), [$public['id']]);
eq('and not for one who may not read it', $list('posts', 'leaves', null), []);
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
        $request = new \WP_REST_Request('GET', '/wp/v2/sp_posts');
        $request->set_query_params($params + ['per_page' => 50]);
        $response = rest_do_request($request);
    } finally {
        wp_set_current_user(0);
    }
    if ($response->get_status() !== 200) {
        // A refusal is its status and code, never an empty list that reads like "nothing found".
        return [$response->get_status(), $response->as_error()->get_error_code()];
    }
    $data = rest_get_server()->response_to_data($response, false);
    $out = array_map(static fn (array $r): int => (int) $r['id'], $data);
    sort($out);
    return $out;
};
// The content is hidden from a visitor: their search is answered over the title, not refused.
eq('core /wp/v2 finds the published post by a word, content hidden or not', $core(['search' => 'green'], null), [$public['id']]);
eq('a word only in the hidden content finds nothing', $core(['search' => 'leaves'], null), []);
eq('the editor finds it by the content', $core(['search' => 'leaves'], 'ed'), [$public['id']]);
eq('search_columns=post_title matches the title only', $core(['search' => 'leaves', 'search_columns' => ['post_title']], 'ed'), []);
eq('and finds it by its title', $core(['search' => 'green', 'search_columns' => ['post_title']], null), [$public['id']]);
// A REST filter between the permission check and handler can switch the current viewer.
$wp->actAs('sub');
$restrictedList = new \WP_REST_Request('GET', '/wp/v2/sp_authors');
$switchViewer = static function (mixed $result, \WP_REST_Request $request) use ($restrictedList): mixed {
    if ($request === $restrictedList) {
        wp_set_current_user(0);
    }
    return $result;
};
add_filter('rest_dispatch_request', $switchViewer, 10, 2);
try {
    $deniedList = rest_do_request($restrictedList);
    eq('core list refuses a viewer denied after the initial permission check',
        [$deniedList->get_status(), $deniedList->get_data()['code'] ?? null, $deniedList->get_headers()['X-WP-Total'] ?? null],
        [401, 'unauthenticated', null]);
} finally {
    remove_filter('rest_dispatch_request', $switchViewer, 10);
    wp_set_current_user(0);
}

// A table's core route searches too.
$wp->actAs('sub');
$tableRequest = new \WP_REST_Request('GET', '/wp/v2/sp_comments');
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

// ---------------------------------------------------------------- core's /wp/v2/search (the link picker)

wp_set_current_user(1);
$corePost = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Green tea on the blog']);
$visibleNote = $db->insert('notes', ['name' => 'Visible jasmine', 'bio' => 'Jasmine blossoms', 'email' => 'shown@example.test', 'status' => 'published'], true)[0];
$hiddenNote = $db->insert('notes', ['name' => 'Hidden jasmine', 'bio' => 'Jasmine kept back', 'email' => 'hidden@example.test', 'status' => 'published'], true)[0];
$draftNote = $db->insert('notes', ['name' => 'Draft jasmine', 'bio' => 'Jasmine unpublished', 'email' => 'draft@example.test', 'status' => 'draft'], true)[0];
wp_set_current_user(0);
/** @return array{int, list<array>, int} status, results (or the error code), X-WP-Total */
$coreSearch = static function (array $params, ?string $who) use ($wp): array {
    $wp->actAs($who);
    try {
        $request = new \WP_REST_Request('GET', '/wp/v2/search');
        $request->set_query_params($params);
        $response = rest_do_request($request);
    } finally {
        wp_set_current_user(0);
    }
    if ($response->get_status() !== 200) {
        return [$response->get_status(), $response->as_error()->get_error_code(), 0];
    }

    return [200, rest_get_server()->response_to_data($response, false), (int) ($response->get_headers()['X-WP-Total'] ?? -1)];
};
$hits = static fn (array $found): array => array_map(static fn (array $r): string => $r['subtype'] . ':' . $r['id'], $found[1]);
// The request the block editor's link picker sends (core-data's fetchLinkSuggestions): type=post, no subtype.
$picker = $coreSearch(['search' => 'green', 'per_page' => 20, 'type' => 'post'], null);
eq('the link picker\'s request finds core\'s posts and SpacePress\'s items together', [$picker[0], $hits($picker), $picker[2]],
    [200, ["post:$corePost", "sp_posts:{$public['id']}"], 2]);
$item = array_values(array_filter($picker[1], static fn (array $r): bool => $r['subtype'] === 'sp_posts'))[0] ?? [];
eq('an item comes in core\'s shape: its id, title, address, type and post type', array_diff_key($item, ['_links' => true]),
    ['id' => $public['id'], 'title' => 'Brewing green tea', 'url' => get_permalink($public['id']), 'type' => 'post', 'subtype' => 'sp_posts']);
eq('with core\'s links to the item and its type', [$item['_links']['self'][0]['href'] ?? null, $item['_links']['about'][0]['href'] ?? null],
    [rest_url('wp/v2/sp_posts/' . $public['id']), rest_url('wp/v2/types/sp_posts')]);
check('its address is the kind\'s own', str_contains((string) get_permalink($public['id']), '/blog/'), get_permalink($public['id']));
eq('without a type, core\'s default type (post) answers the same', $hits($coreSearch(['search' => 'green'], null)), $hits($picker));
eq('subtype narrows it to one kind', $hits($coreSearch(['search' => 'green', 'subtype' => 'sp_posts'], null)), ["sp_posts:{$public['id']}"]);
eq('or to core\'s post types alone', $hits($coreSearch(['search' => 'green', 'subtype' => 'post'], null)), ["post:$corePost"]);
eq('a draft is not found, by a visitor or an editor (core lists published posts only)',
    [$hits($coreSearch(['search' => 'teapots'], null)), $hits($coreSearch(['search' => 'teapots'], 'ed'))], [[], []]);
eq('a word only in a field the reader may not read finds nothing', $coreSearch(['search' => 'mentions'], null)[1], []);
eq('the editor, who reads it, finds the item', $hits($coreSearch(['search' => 'mentions'], 'ed')), ["sp_posts:{$secret['id']}"]);
eq('a kind the reader may not read is left out, not refused', [$coreSearch(['search' => 'writer'], null)[0], $hits($coreSearch(['search' => 'writer'], null))], [200, []]);
eq('a reader of the kind finds its item', count($hits($coreSearch(['search' => 'writer'], 'sub'))), 1);
eq('a row the read rule hides is neither found nor counted', [$hits($found = $coreSearch(['search' => 'jasmine'], null)), $found[2]], [["sp_notes:{$visibleNote['id']}"], 1]);
eq('a title the reader may not read is not shown', $found[1][0]['title'] ?? null, '');
eq('nor is a word of it matched', $coreSearch(['search' => 'visible'], null)[1], []);
$edFound = $coreSearch(['search' => 'jasmine'], 'ed');
eq('an editor finds both published rows, with their titles', [$hits($edFound), array_column($edFound[1], 'title')],
    [["sp_notes:{$visibleNote['id']}", "sp_notes:{$hiddenNote['id']}"], ['Visible jasmine', 'Hidden jasmine']]);
// Pages run over core's results, then SpacePress's items, as one list.
$pageOf = static fn (int $page) => $coreSearch(['search' => 'green', 'per_page' => 1, 'page' => $page], null);
eq('page 1 holds core\'s result, page 2 the item, and both count 2', [[$hits($pageOf(1)), $pageOf(1)[2]], [$hits($pageOf(2)), $pageOf(2)[2]]],
    [[["post:$corePost"], 2], [["sp_posts:{$public['id']}"], 2]]);
eq('a page past the end is core\'s 400', $pageOf(3)[0], 400);
eq('exclude leaves an item out', $hits($coreSearch(['search' => 'green', 'exclude' => [$public['id']]], null)), ["post:$corePost"]);
eq('include keeps only the items named', $hits($coreSearch(['search' => 'green', 'include' => [$public['id']]], null)), ["sp_posts:{$public['id']}"]);
// An address that would show a slug the reader may not read is not given: the kind isn't searched for them.
wp_set_current_user(1);
$topic = $db->insert('topics', ['name' => 'Secret topic', 'email' => 't@example.test', 'status' => 'published'], true)[0];
$story = $db->insert('stories', ['name' => 'Oolong story', 'email' => 's@example.test', 'topic' => $topic['id'], 'status' => 'published'], true)[0];
wp_set_current_user(0);
// (A subscriber reads the kind, as `authors` it was cloned from; only editors read a topic's slug.)
eq('a kind whose address shows a referenced slug hidden from the reader is not searched for them', $coreSearch(['search' => 'oolong'], 'sub')[1], []);
eq('an editor, who reads that slug, finds the item', $hits($coreSearch(['search' => 'oolong'], 'ed')), ["sp_stories:{$story['id']}"]);
// Another plugin's handler of `post` that declares no subtypes still answers `subtype=any`.
$plugin = new class extends \WP_REST_Search_Handler {
    public function __construct() { $this->type = 'post'; }
    public function search_items(\WP_REST_Request $request) { return [self::RESULT_IDS => [987654], self::RESULT_TOTAL => 1]; }
    public function prepare_item($id, array $fields) { return ['id' => $id, 'title' => 'From a plugin', 'url' => '', 'type' => 'post', 'subtype' => 'plugin']; }
    public function prepare_item_links($id) { return []; }
};
add_filter('wp_rest_search_handlers', $swap = static function (array $handlers) use ($plugin): array {
    return array_map(static fn ($h) => $h instanceof \WP_REST_Post_Search_Handler ? $plugin : $h, $handlers);
}, 10);
$handlers = apply_filters('wp_rest_search_handlers', [new \WP_REST_Post_Search_Handler()]);
remove_filter('wp_rest_search_handlers', $swap, 10);
$wrapped = array_values(array_filter($handlers, static fn ($h) => $h->get_type() === 'post'))[0];
$anyRequest = new \WP_REST_Request('GET', '/wp/v2/search');
$anyRequest->set_query_params(['search' => 'green', 'subtype' => ['any'], 'page' => 1, 'per_page' => 10]);
check('the plugin\'s handler is the one wrapped', $wrapped instanceof \SpacePress\Wp\SearchHandler);
eq('its results for subtype=any are kept, before SpacePress\'s', $wrapped->search_items($anyRequest), ['ids' => [987654, $public['id']], 'total' => 2]);
wp_set_current_user(1);
$db->delete('stories', ['id' => $story['id']]);
$db->delete('topics', ['id' => $topic['id']]);
wp_set_current_user(0);
$subtypes = rest_get_server()->get_routes()['/wp/v2/search'][0]['args']['subtype']['items']['enum'] ?? [];
check('the kinds with addresses are subtypes of post, next to core\'s', array_intersect(['post', 'page', 'sp_posts', 'sp_authors', 'sp_notes'], $subtypes) === ['post', 'page', 'sp_posts', 'sp_authors', 'sp_notes'], $subtypes);
wp_set_current_user(1);
wp_delete_post($corePost, true);
foreach ([$visibleNote, $hiddenNote, $draftNote] as $note) {
    $db->delete('notes', ['id' => $note['id']]);
}
wp_set_current_user(0);

// ---------------------------------------------------------------- a rebuild through the job

// Enough rows for more than one batch: each run queues the next, and rows stay searchable meanwhile.
wp_set_current_user(1);
$many = [];
for ($n = 0; $n < \SpacePress\Search\Index::BATCH + 5; $n++) {
    $many[] = (int) $db->insert('comments', ['postId' => $public['id'], 'name' => 'Bulk', 'body' => "Bulk note $n", 'approved' => true], true)[0]['id'];
}
$wp->exec("DELETE FROM `{$prefix}sp__search` WHERE `kind` = ? AND `item` = ?", [$bytes('comments'), $bytes((string) $many[0])]);
// A stale entry of a row that no longer exists, and of a field that is no longer searchable.
$wp->exec("INSERT INTO `{$prefix}sp__search` (`kind`, `item`, `field`, `body`) VALUES (?, ?, ?, 'Orphan tea'), (?, ?, ?, 'Stale tea')",
    [$bytes('comments'), $bytes('999999'), $bytes('body'), $bytes('comments'), $bytes((string) $approved['id']), $bytes('postId')]);
$jobs = static fn (): array => $wp->sql("SELECT `input` FROM `{$prefix}sp__jobs` WHERE `job` = ? AND `state` = 'pending'", [\SpacePress\Search\Index::JOB]);
$before = count($jobs());
\SpacePress\Search\Index::rebuild(['kind' => 'comments', 'after' => null]);
$next = array_values(array_filter(array_map(static fn (array $j): array => json_decode($j['input'], true), $jobs()), static fn (array $i): bool => $i['kind'] === 'comments' && $i['after'] !== null));
eq('a full batch queues the next run, after its last row', [count($jobs()) - $before, count($next)], [1, 1]);
eq('the first run re-indexed the row whose entry was missing', $list('comments', 'bulk', 'sub') !== [] && in_array($many[0], $list('comments', 'bulk', 'sub'), true), true);
check('rows not yet reached stay searchable: nothing was cleared first', in_array('body:Orphan tea', $index('comments'), true) && count($list('comments', 'bulk', 'sub')) === count($many), count($list('comments', 'bulk', 'sub')));
\SpacePress\Search\Index::rebuild($next[0]);
check('the last run removes entries of rows that are gone and of fields no longer searchable',
    !in_array('body:Orphan tea', $index('comments'), true) && !in_array('postId:Stale tea', $index('comments'), true), $index('comments'));
eq('and every row is still found', count($list('comments', 'bulk', 'sub')), count($many));
check('a run of an older build\'s rebuild does nothing', (static function () use ($wp, $prefix, $bytes): bool {
    $wp->exec("DELETE FROM `{$prefix}sp__search` WHERE `kind` = ?", [$bytes('posts')]);
    \SpacePress\Search\Index::rebuild(['kind' => 'posts', 'after' => null, 'generation' => 'older']);

    return $wp->sql("SELECT 1 FROM `{$prefix}sp__search` WHERE `kind` = ?", [$bytes('posts')]) === [];
})());
\SpacePress\Search\Index::rebuild(['kind' => 'posts', 'after' => null]);
wp_set_current_user(0);
eq('the reindex job brings an emptied kind back', $list('posts', 'green', null), [$public['id']]);

// ---------------------------------------------------------------- only on storage this build migrated

// A build whose migrations haven't all run (WP-CLI before `spacepress migrate`, a refused build, a ledger
// rewound by hand) may name a kind with no table: the check that queues rebuilds counts each kind's
// rows, so it waits for the migrations instead of failing every request.
$plugin = \SpacePress\Wp\Plugin::instance();
$ledger = $wp->sql('SELECT * FROM `{prefix}sp__migrations` WHERE `app` = ?', [$wp->app()->schema->name()]);
check('the fixture site has migrations to rewind', $ledger !== [] && $plugin->migrated());
$wp->exec('DELETE FROM `{prefix}sp__migrations` WHERE `app` = ?', [$wp->app()->schema->name()]);
delete_option('sp_search_shape');
$pendingBefore = count($jobs());
\SpacePress\Search\Index::reindexChanged();
eq('with a migration pending, nothing is counted or queued, and the shape is left unrecorded', [$plugin->migrated(), count($jobs()) - $pendingBefore, get_option('sp_search_shape', null)], [false, 0, null]);
foreach ($ledger as $row) {
    $wp->exec('INSERT INTO `{prefix}sp__migrations` (`' . implode('`, `', array_keys($row)) . '`) VALUES (' . implode(', ', array_fill(0, count($row), '?')) . ')', array_values($row));
}
\SpacePress\Search\Index::reindexChanged();
check('once migrated, the check runs and records the shape', $plugin->migrated() && is_array(get_option('sp_search_shape', null)));

// A fresh system table uses byte keys. Reapplying its DDL keeps its data.
$wp->exec("DROP TABLE `{$prefix}sp__search`");
\SpacePress\Wp\Runtime::applySystemTables();
$type = static fn (): ?string => $wp->sql('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$prefix . 'sp__search', 'item'])[0]['DATA_TYPE'] ?? null;
eq('system DDL creates search with byte keys', [$type(), $wp->sql("SELECT COUNT(*) AS n FROM `{$prefix}sp__search`")[0]['n']], ['varbinary', 0]);
eq('the recorded shape is cleared, so the next request queues a rebuild of every kind', get_option('sp_search_shape', null), null);
\SpacePress\Wp\Runtime::applySystemTables();
$wp->exec("INSERT INTO `{$prefix}sp__search` (`kind`, `item`, `field`, `body`) VALUES (?, ?, ?, 'Kept')", [$bytes('posts'), $bytes('1'), $bytes('title')]);
\SpacePress\Wp\Runtime::applySystemTables();
eq('a table that already has byte keys is kept as it is', (int) $wp->sql("SELECT COUNT(*) AS n FROM `{$prefix}sp__search`")[0]['n'], 1);

finish('search_test');
