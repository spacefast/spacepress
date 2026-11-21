<?php

declare(strict_types=1);

/*
 * Staged versions of post kinds (TypedPress\Wp\Staged) on a real WordPress (tests/php/wp.php): a change
 * staged beside a published item, what every reader of the item keeps getting meanwhile, compare,
 * promote through the update pipeline, a scheduled promote on core's cron event, discard, signed
 * preview links, and who may learn that a staged version exists. In-process through the API's own
 * router and the abilities, and over HTTP through php -S for what an anonymous client is served.
 */

use TypedPress\App;
use TypedPress\HttpError;
use TypedPress\Viewer;
use TypedPress\Wp\Facade;
use TypedPress\Wp\Staged;

putenv('TP_WP_THEMES=1'); // the served site renders pages (the preview link's HTML)
require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// WordPress owns $post, $id, $posts, $page and $wp at file scope (core sets them while it renders an
// item), so this suite names its own variables differently.
$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$kind = &$schema['collections']['posts'];
$kind['url'] = '/blog/:slug';
// Admin-only to read and to set: the hidden field of the staged-change checks.
$kind['columns']['memo'] = ['type' => 'text', 'access' => ['read' => ['role' => 'admin'], 'update' => ['role' => 'admin']]];
$kind['columns']['kicker'] = ['type' => 'text']; // never staged below: it follows the live item
// … and a hidden sub-field inside a group the editor otherwise edits.
$kind['columns']['seo']['fields']['internal'] = ['type' => 'text', 'access' => ['read' => ['role' => 'admin'], 'update' => ['role' => 'admin']]];
$kind['hooks']['afterUpdate'] = 'posts__afterUpdate';
unset($kind);
// A kind that turned staged versions off.
$fixed = $schema['collections']['authors'];
$fixed['key'] = 'fixed';
$fixed['staged'] = false;
$fixed['wp'] = ['postType' => 'tp_fixed', 'groupKey' => 'group_tp_fixed', 'metaPrefix' => 'tp_', 'fieldKeyPrefix' => 'field_tp_fixed_'];
$fixed['access'] = array_fill_keys(['read', 'create', 'update', 'delete'], ['role' => 'editor']);
$schema['collections']['fixed'] = $fixed;
// Anyone may update a guestbook entry; its `mood` only an admin may set. And `riddles`: an update
// rule that throws when the data it is given asks it to.
foreach (['guestbook' => ['role' => 'anyone'], 'riddles' => ['fn' => 'riddles__access__update']] as $key => $update) {
    $extra = $schema['collections']['authors'];
    $extra['key'] = $key;
    $extra['wp'] = ['postType' => "tp_$key", 'groupKey' => "group_tp_$key", 'metaPrefix' => 'tp_', 'fieldKeyPrefix' => "field_tp_{$key}_"];
    $extra['access'] = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => $update, 'delete' => ['role' => 'editor']];
    $extra['columns']['mood'] = ['type' => 'text', 'access' => ['read' => ['role' => 'admin'], 'update' => ['role' => 'admin']]];
    $extra['columns']['email']['unique'] = false;
    $schema['collections'][$key] = $extra;
}
$schema['webhooks'] = [['url' => ['env' => 'TP_HOOK_URL'], 'secret' => ['env' => 'TP_HOOK_SECRET'], 'events' => ['posts.updated']]];
putenv('TP_HOOK_URL=http://127.0.0.1:9/hook');
putenv('TP_HOOK_SECRET=whsec_test');
$functions = file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

    /** Every update of a post leaves one comment naming the change and who made it. */
    /** Editors only; and a rule that is handed `bio: "boom"` throws, as a buggy rule might. */
    function riddles__access__update(\TypedPress\JsObject $ctx)
    {
        $data = \TypedPress\Js::prop($ctx, 'data');
        if ($data !== null && \TypedPress\Js::prop($data, 'bio') === 'boom') {
            throw new \RuntimeException('the rule could not read this data');
        }
        $user = \TypedPress\Js::prop($ctx, 'user');

        return $user !== null && in_array(\TypedPress\Js::prop($user, 'role'), ['editor', 'admin'], true);
    }

    function posts__afterUpdate(\TypedPress\JsObject $row, \TypedPress\JsObject $previous, \TypedPress\JsObject $ctx)
    {
        $user = \TypedPress\Js::prop($ctx, 'user');
        \TypedPress\db()->insert('comments', ['postId' => $row->p['id'], 'name' => 'afterUpdate',
            'body' => $previous->p['title'] . ' -> ' . $row->p['title'] . ' by ' . ($user === null ? 'nobody' : \TypedPress\Js::prop($user, 'name'))]);
    }
    PHP;
$site = wpSite('staged', [
    'schema' => $schema,
    'functions' => $functions,
    'users' => ['ed' => 'editor', 'alice' => 'author', 'bob' => 'author', 'sub' => 'subscriber'],
    // A one-file theme: the item's title, content and one field, as a theme template prints them.
    'muPlugins' => ['staged-template' => <<<'PHP'
        <?php
        add_filter('template_include', static function () {
            $file = WP_CONTENT_DIR . '/staged-template.php';
            file_put_contents($file, '<?php while (have_posts()) { the_post(); echo "<h1>", get_the_title(), "</h1><main>", get_the_content(), "</main><p id=\"excerpt\">", esc_html((string) get_post_meta(get_the_ID(), "tp_excerpt", true)), "</p><p id=\"kicker\">", esc_html((string) get_post_meta(get_the_ID(), "tp_kicker", true)), "</p><p id=\"memo\">", esc_html((string) get_post_meta(get_the_ID(), "tp_memo", true)), "</p>"; }');

            return $file;
        }, PHP_INT_MAX);
        PHP],
]);
$plugin = $site->plugin();
$db = \TypedPress\db();
$url = $site->url();
$users = [];
foreach (['admin', 'ed', 'alice', 'bob', 'sub'] as $name) {
    $users[$name] = $site->user($name);
}

/** One request of the API's router as $as: [status, data or problem document]. */
function api(string $method, string $path, mixed $body = null, ?string $as = null, array $query = []): array
{
    global $site, $plugin;
    $site->actAs($as);
    try {
        [$code, , $out] = Facade::route($plugin, $method, $path, $query, $body === null ? '' : (string) json_encode($body));
        $json = json_decode((string) $out, true);

        return [$code, $json['data'] ?? null];
    } catch (HttpError | \TypedPress\JsError $e) {
        $problem = App::problem($e);

        return [$problem['status'], $problem];
    } finally {
        wp_set_current_user(0);
    }
}

function isProblem(string $label, array $r, int $status, string $code, ?string $pointer = null): void
{
    [$s, $p] = $r;
    check("$label → $status $code" . ($pointer === null ? '' : " $pointer"), $s === $status && ($p['code'] ?? null) === $code && ($p['pointer'] ?? null) === $pointer, $p);
}

/** @return array{status: int, headers: array<string, list<string>>, body: string} */
function fetch(string $url, array $headers = [], string $method = 'GET', ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [...$headers, ...($body === null ? [] : ['Content-Type: application/json'])],
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }

            return strlen($line);
        },
    ] + ($body === null ? [] : [CURLOPT_POSTFIELDS => $body]));
    $text = (string) curl_exec($ch);

    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}
$basic = static fn (string $name): string => 'Authorization: Basic ' . base64_encode($site->appPassword($name));
$notes = static fn (int $item): array => array_column($db->findMany('comments', ['where' => ['postId' => $item, 'name' => 'afterUpdate'], 'orderBy' => ['id' => 'asc']]), 'body');
$webhooks = static fn (): int => (int) $site->scalar("SELECT COUNT(*) FROM {prefix}tp__jobs WHERE job = 'typedpress.webhook'");
$stagedPosts = static fn (int $item): array => array_map('intval', array_column(
    $site->sql("SELECT ID FROM {prefix}posts WHERE post_parent = ? AND post_name = ? ORDER BY ID", [$item, "$item-autosave-staged-v1"]), 'ID'));

// ================================================================ seed (trusted)

$profile = $db->insert('authors', ['name' => 'Alice', 'email' => 'alice@example.com', 'userId' => $users['alice']['id']], true)[0];
$body = '<!-- wp:paragraph --><p>Live body, findable as livemarker.</p><!-- /wp:paragraph -->';
$item = $db->insert('posts', ['title' => 'Live title', 'slug' => 'live-post', 'body' => $body, 'excerpt' => 'Live excerpt', 'kicker' => 'Live kicker', 'memo' => 'live memo', 'authorId' => $profile['id']], true)[0];
$other = $db->insert('posts', ['title' => 'Untouched', 'slug' => 'untouched', 'body' => 'Other body.'], true)[0];
$pid = $item['id'];
$site->startServer();
$url = $site->url();
$stagedBody = '<!-- wp:paragraph --><p>Staged body, findable as stagedmarker.</p><!-- /wp:paragraph -->';

/** Everything a reader who may not update the item can get about it, by surface. */
$public = static function () use ($url, $pid, $basic): array {
    $item = json_decode(fetch("$url/wp-json/wp/v2/tp_posts/$pid")['body'], true);

    return [
        'api item' => fetch("$url/wp-json/typedpress/v1/posts/$pid")['body'],
        'api item, subscriber' => fetch("$url/wp-json/typedpress/v1/posts/$pid", [$basic('sub')])['body'],
        'api list' => fetch("$url/wp-json/typedpress/v1/posts")['body'],
        'api search' => fetch("$url/wp-json/typedpress/v1/posts?search=stagedmarker")['body'],
        'site-wide search' => fetch("$url/wp-json/typedpress/v1/search?q=stagedmarker")['body'],
        'api markdown' => fetch("$url/wp-json/typedpress/v1/posts/$pid?format=md")['body'],
        'core item' => [$item['title'] ?? null, $item['content'] ?? null, $item['slug'] ?? null, $item['modified_gmt'] ?? null, $item['meta'] ?? null],
        'core item links' => [$item['_links']['version-history'] ?? null, $item['_links']['predecessor-version'] ?? null],
        'core list search' => fetch("$url/wp-json/wp/v2/tp_posts?search=stagedmarker")['body'],
        'core search' => fetch("$url/wp-json/wp/v2/search?search=stagedmarker")['body'],
        'core revisions' => fetch("$url/wp-json/wp/v2/tp_posts/$pid/revisions")['status'],
        'core autosaves' => fetch("$url/wp-json/wp/v2/tp_posts/$pid/autosaves")['status'],
        'page' => fetch("$url/blog/live-post/")['body'],
        'twin' => fetch("$url/blog/live-post.md")['body'],
        'staged slug page' => fetch("$url/blog/staged-post/")['status'],
        'staged slug twin' => fetch("$url/blog/staged-post.md")['status'],
        'feed' => preg_replace('#<lastBuildDate>.*?</lastBuildDate>#', '', fetch("$url/?feed=rss2&post_type=tp_posts")['body']),
        'site search' => fetch("$url/?s=stagedmarker")['body'],
        'llms.txt' => fetch("$url/llms.txt")['body'],
        'sitemap' => fetch("$url/wp-sitemap.xml")['body'],
    ];
};
$before = $public();
check('the live page shows the live item', str_contains($before['page'], '<h1>Live title</h1>') && str_contains($before['page'], 'livemarker') && str_contains($before['page'], 'Live excerpt'), $before['page']);
eq('the live twin is the live item', $before['twin'], "# Live title\n\nLive body, findable as livemarker.\n");
$revisionsBefore = api('GET', "/posts/$pid/revisions", as: 'ed')[1];

// ================================================================ nothing staged yet

isProblem('nothing staged: the staged version', api('GET', "/posts/$pid/staged", as: 'ed'), 404, 'not_found');
isProblem('nothing staged: compare', api('GET', "/posts/$pid/staged/compare", as: 'ed'), 404, 'not_found');
isProblem('nothing staged: promote', api('POST', "/posts/$pid/staged/promote", as: 'ed'), 404, 'not_found');
isProblem('nothing staged: discard', api('DELETE', "/posts/$pid/staged", as: 'ed'), 404, 'not_found');
isProblem('nothing staged: a preview link', api('POST', "/posts/$pid/staged/preview", as: 'ed'), 404, 'not_found');
isProblem('an empty patch stages nothing', api('PATCH', "/posts/$pid/staged", [], 'ed'), 422, 'invalid_input', '');
isProblem('an unknown field is refused', api('PATCH', "/posts/$pid/staged", ['nope' => 1], 'ed'), 422, 'invalid_input', '/nope');
isProblem('a field rule refuses a staged value as it refuses an update', api('PATCH', "/posts/$pid/staged", ['title' => str_repeat('x', 121)], 'ed'), 422, 'invalid_input', '/title');
isProblem('status is not staged: it changes with an update', api('PATCH', "/posts/$pid/staged", ['status' => 'draft'], 'ed'), 422, 'invalid_input', '/status');
isProblem('a table kind has no staged versions', api('GET', '/comments/1/staged', as: 'ed'), 404, 'not_found');
$unstaged = $db->insert('fixed', ['name' => 'Fixed', 'email' => 'fixed@example.com'], true)[0];
isProblem('a kind with `staged: false` has none either', api('PATCH', "/fixed/{$unstaged['id']}/staged", ['name' => 'x'], 'ed'), 404, 'not_found');
eq('… and no staged abilities', [wp_has_ability('blog/fixed-stage'), wp_has_ability('blog/fixed-update')], [false, true]);
eq('refused stages left no staged revision', $stagedPosts($pid), []);

// ================================================================ stage

$hooksBefore = [$notes($pid), $webhooks()];
[$code, $staged] = api('PATCH', "/posts/$pid/staged", ['title' => 'Staged title', 'body' => $stagedBody], 'ed');
eq('an editor stages a change to a published post', [$code, $staged['row']['title'] ?? null, $staged['row']['body'] ?? null, $staged['fields'] ?? null],
    [200, 'Staged title', $stagedBody, ['title', 'body']]);
eq('the staged row keeps every field that was not staged', [$staged['row']['excerpt'], $staged['row']['slug'], $staged['row']['status'], $staged['row']['id']], ['Live excerpt', 'live-post', 'published', $pid]);
eq('the staged version says who staged it', [$staged['by'], $staged['promoteAt']], [['id' => $users['ed']['id'], 'name' => $users['ed']['name']], null]);
check('a field the editor cannot read is not in the staged row', !array_key_exists('memo', $staged['row']), $staged['row']);
[, $again] = api('PATCH', "/posts/$pid/staged", ['excerpt' => 'Staged excerpt', 'slug' => 'staged-post'], 'alice');
eq('the post\'s author stages into the same version: one per item, shared', [$again['id'], $again['fields'], $again['row']['title'], $again['by']['id']],
    [$staged['id'], ['title', 'slug', 'body', 'excerpt'], 'Staged title', $users['alice']['id']]);
eq('one staged revision exists for the item', $stagedPosts($pid), [$staged['id']]);
eq('staging ran no hook and queued no webhook', [$notes($pid), $webhooks()], $hooksBefore);
eq('core\'s own autosave slot is untouched', wp_get_post_autosave($pid), false);

// The staged version is nobody's autosave and no revision of core's. The block editor loads
// GET /wp/v2/<type>/<id>/autosaves and takes the entry whose author is the current user as their
// newer autosave (core-data getAutosave), and wp-admin's revision screen offers every revision to
// restore: the staged version must be in neither.
$site->actAs('ed');
$listedAutosaves = rest_do_request(new \WP_REST_Request('GET', "/wp/v2/tp_posts/$pid/autosaves"))->get_data();
wp_set_current_user(0);
eq('the autosaves route lists no staged version', array_column((array) $listedAutosaves, 'id'), []);
eq('… so the editor finds no autosave of the last stager\'s to offer', array_values(array_filter((array) $listedAutosaves, static fn (array $a): bool => (int) $a['author'] === $users['alice']['id'])), []);
require_once ABSPATH . 'wp-admin/includes/revision.php';
$site->actAs('ed');
$restorable = wp_prepare_revisions_for_js($pid, 0)['revisionIds'];
wp_set_current_user(0);
check('wp-admin\'s revision screen offers no staged version to restore', !in_array($staged['id'], $restorable, true), $restorable);
eq('… nor does core\'s revision list', in_array($staged['id'], array_keys(wp_get_post_revisions($pid, ['check_enabled' => false])), true), false);
eq('… nor a query for children of any status', in_array($staged['id'], array_keys(get_children(['post_parent' => $pid])), true), false);


$after = $public();
foreach ($before as $surface => $value) {
    eq("staging changes nothing a reader of the item gets: $surface", $after[$surface], $value);
}
eq('the trusted read still returns the live row', array_intersect_key($db->findFirst('posts', ['where' => ['id' => $pid]]), ['title' => 1, 'slug' => 1, 'excerpt' => 1, 'body' => 1]),
    ['title' => 'Live title', 'slug' => 'live-post', 'body' => $body, 'excerpt' => 'Live excerpt']);
eq('the item\'s revision list has no staged entry', api('GET', "/posts/$pid/revisions", as: 'ed')[1], $revisionsBefore);
$site->actAs('ed');
$listed = wp_get_ability('blog/posts-revisions')->execute(['id' => $pid]);
wp_set_current_user(0);
eq('the revisions ability has no staged entry', array_column($listed['revisions'] ?? [], 'id'), array_column($revisionsBefore, 'id'));

// ================================================================ who may learn that it exists

$missing = static fn (array $r): array => [$r[0], $r[1]['code'] ?? null, preg_replace('/\d+/', 'N', (string) ($r[1]['detail'] ?? ''))];
foreach ([null, 'sub', 'bob'] as $actor) {
    $who = $actor ?? 'anonymous';
    foreach ([['GET', '/staged', null], ['GET', '/staged/compare', null], ['PATCH', '/staged', ['title' => 'Mine']], ['POST', '/staged/promote', null],
        ['POST', '/staged/promote', ['at' => '2099-01-01T00:00:00Z']], ['DELETE', '/staged', null], ['POST', '/staged/preview', null]] as [$method, $path, $input]) {
        $with = api($method, "/posts/$pid$path", $input, $actor);
        isProblem("$who, $method $path of an item with a staged version", $with, 404, 'not_found');
        eq("… the same answer as for an item with none ($who, $method $path)", $missing($with), $missing(api($method, "/posts/{$other['id']}$path", $input, $actor)));
        eq("… and as for an item that does not exist ($who, $method $path)", $missing($with), $missing(api($method, "/posts/999999$path", $input, $actor)));
    }
}
eq('refused actors changed nothing', api('GET', "/posts/$pid/staged", as: 'ed')[1]['row']['title'], 'Staged title');
eq('over HTTP an anonymous client gets the 404 too', [fetch("$url/wp-json/typedpress/v1/posts/$pid/staged")['status'], fetch("$url/wp-json/typedpress/v1/posts/$pid/staged/compare", [$basic('sub')])['status']], [404, 404]);
$served = json_decode(fetch("$url/wp-json/typedpress/v1/posts/$pid/staged", [$basic('ed')])['body'], true);
eq('an application password of an editor reads the staged version over HTTP', [$served['data']['row']['title'] ?? null, $served['data']['fields'] ?? null], ['Staged title', ['title', 'slug', 'body', 'excerpt']]);

// ================================================================ compare

[, $diff] = api('GET', "/posts/$pid/staged/compare", as: 'ed');
eq('compare lists each staged field with its live and staged value', $diff['changes'], [
    ['field' => 'title', 'live' => 'Live title', 'staged' => 'Staged title'],
    ['field' => 'slug', 'live' => 'live-post', 'staged' => 'staged-post'],
    ['field' => 'body', 'live' => $body, 'staged' => $stagedBody],
    ['field' => 'excerpt', 'live' => 'Live excerpt', 'staged' => 'Staged excerpt'],
]);
api('PATCH', "/posts/$pid/staged", ['excerpt' => 'Live excerpt'], 'ed');
eq('a field staged back to its live value is no change', array_column(api('GET', "/posts/$pid/staged/compare", as: 'ed')[1]['changes'], 'field'), ['title', 'slug', 'body']);
api('PATCH', "/posts/$pid/staged", ['excerpt' => 'Staged excerpt'], 'ed');

// ---- a staged change to a hidden field
isProblem('an editor cannot stage a field only admins may set', api('PATCH', "/posts/$pid/staged", ['memo' => 'guess'], 'ed'), 403, 'forbidden', '/memo');
[, $withMemo] = api('PATCH', "/posts/$pid/staged", ['memo' => 'staged memo'], 'admin');
eq('an admin stages the hidden field and reads it back', [$withMemo['row']['memo'], in_array('memo', $withMemo['fields'], true)], ['staged memo', true]);
[, $editorView] = api('GET', "/posts/$pid/staged", as: 'ed');
check('the editor\'s staged row and field list leave the hidden field out', !array_key_exists('memo', $editorView['row']) && !in_array('memo', $editorView['fields'], true), $editorView);
eq('the editor\'s compare leaves the hidden field out', array_column(api('GET', "/posts/$pid/staged/compare", as: 'ed')[1]['changes'], 'field'), ['title', 'slug', 'body', 'excerpt']);
eq('the admin\'s compare has it', array_values(array_filter(api('GET', "/posts/$pid/staged/compare", as: 'admin')[1]['changes'], static fn (array $c) => $c['field'] === 'memo')),
    [['field' => 'memo', 'live' => 'live memo', 'staged' => 'staged memo']]);
check('no surface of the staged version names the hidden field or its value to the editor',
    !str_contains((string) json_encode([$editorView, api('GET', "/posts/$pid/staged/compare", as: 'ed')[1]]), 'memo'), $editorView);
isProblem('a promote is the promoter\'s update: an editor cannot promote a staged admin-only field', api('POST', "/posts/$pid/staged/promote", as: 'ed'), 403, 'forbidden', '/memo');
eq('the refused promote changed nothing and kept the staged version', [$db->findFirst('posts', ['where' => ['id' => $pid]])['title'], $stagedPosts($pid), $notes($pid)], ['Live title', [$staged['id']], []]);

// ================================================================ preview links

[, $link] = api('POST', "/posts/$pid/staged/preview", as: 'ed');
check('a preview link names the API read and the page', str_starts_with($link['api'], "$url/wp-json/typedpress/v1/posts/$pid/staged?preview=") && str_starts_with((string) $link['url'], "$url/blog/live-post/?tp_preview="), $link);
$preview = json_decode(fetch($link['api'])['body'], true)['data'] ?? null;
eq('the link reads the staged row without signing in', [$preview['row']['title'] ?? null, $preview['row']['body'] ?? null], ['Staged title', $stagedBody]);
check('… through an anonymous visitor\'s field masks, without who staged it', !array_key_exists('memo', $preview['row']) && !in_array('memo', $preview['fields'], true) && !array_key_exists('by', $preview), $preview);
$html = fetch((string) $link['url']);
check('the item\'s page renders the staged title, content and field with the link', str_contains($html['body'], '<h1>Staged title</h1>') && str_contains($html['body'], 'stagedmarker') && str_contains($html['body'], 'Staged excerpt'), $html['body']);
// A live edit to a field that is not staged, after staging: the staged version follows it.
$db->update('posts', ['kicker' => 'Edited kicker'], ['id' => $pid]);
eq('a later live edit to a field that was not staged shows in the staged row', api('GET', "/posts/$pid/staged", as: 'ed')[1]['row']['kicker'], 'Edited kicker');
check('… and on the previewed page', str_contains(fetch((string) $link['url'])['body'], 'Edited kicker') && str_contains(fetch((string) $link['url'])['body'], 'Staged excerpt'));
$db->update('posts', ['kicker' => 'Live kicker'], ['id' => $pid]);
check('a previewed page is never stored by a cache, indexed, or named in a Referer', str_contains(implode(',', $html['headers']['cache-control'] ?? []), 'no-store')
    && ($html['headers']['x-robots-tag'] ?? null) === ['noindex, nofollow'] && ($html['headers']['referrer-policy'] ?? null) === ['no-referrer'], $html['headers']);
eq('the page without the link is the live page', fetch("$url/blog/live-post/")['body'], $before['page']);
eq('the twin ignores a preview link', fetch("$url/blog/live-post.md?tp_preview=" . $link['token'])['body'], $before['twin']);
$tampered = substr($link['token'], 0, -2) . (str_ends_with($link['token'], 'AA') ? 'BB' : 'AA');
eq('a tampered link is not a link', [fetch("$url/wp-json/typedpress/v1/posts/$pid/staged?preview=$tampered")['status'], fetch("$url/blog/live-post/?tp_preview=$tampered")['body']], [404, $before['page']]);
eq('a link names one item only', fetch("$url/wp-json/typedpress/v1/posts/{$other['id']}/staged?preview=" . $link['token'])['status'], 404);
check('a link is valid now', Staged::previewed('posts', $pid, $link['token']) !== null);
putenv('TP_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 3601));
eq('a link expires after an hour by default', Staged::previewed('posts', $pid, $link['token']), null);
putenv('TP_NOW');
isProblem('a link lives a day at most', api('POST', "/posts/$pid/staged/preview", ['ttl' => 86401], 'ed'), 422, 'invalid_input', '/ttl');

// ================================================================ scheduled promote, on core's cron event

isProblem('a scheduled promote needs a future time', api('POST', "/posts/$pid/staged/promote", ['at' => '2001-01-01T00:00:00Z'], 'admin'), 422, 'invalid_input', '/at');
isProblem('a scheduler who could not promote now is refused', api('POST', "/posts/$pid/staged/promote", ['at' => '2099-01-01T00:00:00Z'], 'ed'), 403, 'forbidden', '/memo');
$at = gmdate('Y-m-d\TH:i:s.000\Z', time() + 7200);
[, $scheduled] = api('POST', "/posts/$pid/staged/promote", ['at' => $at], 'admin');
eq('an admin schedules the promote', [$scheduled['promoteAt'], wp_next_scheduled('publish_future_post', [$staged['id']])], [$at, strtotime($at)]);
eq('scheduling changed nothing live', $db->findFirst('posts', ['where' => ['id' => $pid]])['title'], 'Live title');
api('PATCH', "/posts/$pid/staged", ['excerpt' => 'Staged excerpt, again'], 'ed');
eq('staging more keeps the schedule and its cron event', [api('GET', "/posts/$pid/staged", as: 'ed')[1]['promoteAt'], wp_next_scheduled('publish_future_post', [$staged['id']])], [$at, strtotime($at)]);
do_action('publish_future_post', $staged['id']);
eq('the cron event before its time promotes nothing', [$db->findFirst('posts', ['where' => ['id' => $pid]])['title'], $stagedPosts($pid)], ['Live title', [$staged['id']]]);
[, $cancelled] = api('POST', "/posts/$pid/staged/promote", ['at' => null], 'ed');
eq('`at: null` cancels the schedule and its cron event', [$cancelled['promoteAt'], wp_next_scheduled('publish_future_post', [$staged['id']])], [null, false]);

// A scheduled promote runs as its scheduler, under the rules as they are when it runs.
api('PATCH', "/posts/{$other['id']}/staged", ['title' => 'Scheduled by Alice'], 'admin');
$db->update('posts', ['authorId' => $profile['id']], ['id' => $other['id']]);
[, $hers] = api('POST', "/posts/{$other['id']}/staged/promote", ['at' => $at], 'alice');
$db->update('posts', ['authorId' => null], ['id' => $other['id']]); // the post is no longer hers
putenv('TP_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 7201));
do_action('publish_future_post', $hers['id']);
putenv('TP_NOW');
[, $stuck] = api('GET', "/posts/{$other['id']}/staged", as: 'ed');
eq('a scheduled promote its scheduler may no longer make changes nothing and says why',
    [$db->findFirst('posts', ['where' => ['id' => $other['id']]])['title'], $stuck['promoteAt'], $stuck['error']['code'] ?? null, get_current_user_id()], ['Untouched', null, 'not_found', 0]);
eq('… and is not retried', wp_next_scheduled('publish_future_post', [$hers['id']]), false);

// ================================================================ discard

[, $otherLink] = api('POST', "/posts/{$other['id']}/staged/preview", as: 'ed');
check('the link shows the staged page while it is staged', str_contains(fetch((string) $otherLink['url'])['body'], '<h1>Scheduled by Alice</h1>'), $otherLink);
$history = count(api('GET', "/posts/{$other['id']}/revisions", as: 'ed')[1]);
[$code, $discarded] = api('DELETE', "/posts/{$other['id']}/staged", as: 'ed');
eq('discard ends the staged version', [$code, $discarded, $stagedPosts($other['id'])], [200, ['revision' => $hers['id']], []]);
isProblem('nothing is staged after a discard', api('GET', "/posts/{$other['id']}/staged", as: 'ed'), 404, 'not_found');
$list = api('GET', "/posts/{$other['id']}/revisions", as: 'ed')[1];
eq('the discarded version stays in the item\'s revision history', [count($list), in_array($hers['id'], array_column($list, 'id'), true)], [$history + 1, true]);
eq('… readable as the row it would have been', api('GET', "/posts/{$other['id']}/revisions/{$hers['id']}", as: 'ed')[1]['title'], 'Scheduled by Alice');
eq('… and recorded as discarded, by whom', json_decode((string) get_post_meta($hers['id'], Staged::META, true), true)['discarded']['by'] ?? null, $users['ed']['id']);
eq('the live item was never changed', $db->findFirst('posts', ['where' => ['id' => $other['id']]])['title'], 'Untouched');
check('a link to a discarded version shows the live page', str_contains(fetch((string) $otherLink['url'])['body'], '<h1>Untouched</h1>'), $otherLink);
eq('… and reads nothing from the API', fetch($otherLink['api'])['status'], 404);

// ================================================================ promote

// The promote runs the update's unique check: a slug another post took since staging refuses it whole.
$squatter = $db->insert('posts', ['title' => 'Squatter', 'slug' => 'staged-post'], true)[0];
$queued = $webhooks(); // the trusted updates above each queued one
$traces = $notes($pid); // … and left an afterUpdate trace
isProblem('a promote runs the update\'s unique check', api('POST', "/posts/$pid/staged/promote", as: 'admin'), 409, 'unique_violation', '/slug');
eq('the refused promote rolled back whole', [$db->findFirst('posts', ['where' => ['id' => $pid]])['title'], $stagedPosts($pid), $notes($pid), $webhooks()], ['Live title', [$staged['id']], $traces, $queued]);
$db->delete('posts', ['id' => $squatter['id']]);

$announced = [];
add_action('tp_purge_urls', static function (array $paths) use (&$announced): void {
    $announced[] = $paths;
});
$history = count(api('GET', "/posts/$pid/revisions", as: 'admin')[1]);
[$code, $promoted] = api('POST', "/posts/$pid/staged/promote", as: 'admin');
\TypedPress\Wp\Purges::flush();
eq('promote makes the staged version live and returns the row', [$code, $promoted['title'], $promoted['slug'], $promoted['excerpt'], $promoted['memo'], $promoted['body']],
    [200, 'Staged title', 'staged-post', 'Staged excerpt, again', 'staged memo', $stagedBody]);
eq('the update\'s afterUpdate hook ran once, as the promoter', array_slice($notes($pid), count($traces)), ['Live title -> Staged title by ' . $users['admin']['name']]);
eq('the update\'s webhook was queued once', $webhooks(), $queued + 1);
$paths = array_merge(...$announced);
check('the update\'s URL purges were announced, old and new URL', in_array('/blog/live-post/', $paths, true) && in_array('/blog/staged-post/', $paths, true) && in_array('/blog/staged-post.md', $paths, true), $paths);
isProblem('nothing is staged after a promote', api('GET', "/posts/$pid/staged", as: 'admin'), 404, 'not_found');
eq('no staged revision is left', $stagedPosts($pid), []);
$list = api('GET', "/posts/$pid/revisions", as: 'admin')[1];
eq('history gained the update\'s revision and the promoted version', [count($list), in_array($staged['id'], array_column($list, 'id'), true)], [$history + 2, true]);
eq('the promoted version is recorded as promoted, by whom', json_decode((string) get_post_meta($staged['id'], Staged::META, true), true)['promoted']['by'] ?? null, $users['admin']['id']);
eq('the preview link stopped working', [Staged::previewed('posts', $pid, $link['token']), fetch($link['api'])['status']], [null, 404]);
$live = $public();
check('readers now get the promoted item', str_contains($live['api item'], 'Staged title') && str_contains(fetch("$url/blog/staged-post/")['body'], '<h1>Staged title</h1>')
    && fetch("$url/blog/staged-post.md")['body'] === "# Staged title\n\nStaged body, findable as stagedmarker.\n", $live['api item']);
check('… and find it by its new text', str_contains($live['api search'], 'Staged title'), $live['api search']);

// A scheduled promote that is due runs as the user who scheduled it.
api('PATCH', "/posts/$pid/staged", ['title' => 'Promoted by cron'], 'ed');
[, $due] = api('POST', "/posts/$pid/staged/promote", ['at' => $at], 'ed');
putenv('TP_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 7201));
do_action('publish_future_post', $due['id']);
putenv('TP_NOW');
eq('a due scheduled promote makes the staged version live', [$db->findFirst('posts', ['where' => ['id' => $pid]])['title'], $stagedPosts($pid), get_current_user_id()], ['Promoted by cron', [], 0]);
eq('… as an update by its scheduler, hooks included', array_slice($notes($pid), -1), ['Staged title -> Promoted by cron by ' . $users['ed']['name']]);

// ================================================================ abilities: one per step

$names = array_values(array_filter(array_map(static fn ($a) => $a->get_name(), wp_get_abilities()), static fn (string $n) => str_starts_with($n, 'blog/posts-stage')));
sort($names);
eq('each staged step is its own ability', $names, ['blog/posts-stage', 'blog/posts-staged-compare', 'blog/posts-staged-discard', 'blog/posts-staged-get', 'blog/posts-staged-preview', 'blog/posts-staged-promote']);
eq('a table kind has none', wp_has_ability('blog/comments-stage'), false);
// Who is offered them: core's abilities list, one ability's description and the MCP tools list show
// a staged ability only to a caller whose update rule on the kind may allow something.
$listed = static function (?string $as) use ($site): array {
    $site->actAs($as);
    try {
        $response = rest_do_request(new \WP_REST_Request('GET', '/wp-abilities/v1/abilities'));
        $one = rest_do_request(new \WP_REST_Request('GET', '/wp-abilities/v1/abilities/blog/authors-staged-promote'));

        return [$response->get_status(), array_values(array_filter(array_column((array) $response->get_data(), 'name'), static fn (string $n) => str_contains($n, '-stage'))), $one->get_status()];
    } finally {
        wp_set_current_user(0);
    }
};
[$code, $subscriber, $item] = $listed('sub');
eq('a subscriber is offered staged abilities only where the update rule admits them (guestbook: anyone)',
    [$code, array_values(array_filter($subscriber, static fn (string $n) => !str_starts_with($n, 'blog/guestbook-'))), $item], [200, [], 404]);
[, $author] = $listed('alice');
check('an author is offered the posts kind\'s, where their update rule covers their own posts', in_array('blog/posts-staged-promote', $author, true)
    && !in_array('blog/authors-staged-promote', $author, true), $author);
[, $editor, $item] = $listed('ed');
check('an editor is offered the posts kind\'s staged abilities, each one by name',
    count(array_intersect(['blog/posts-stage', 'blog/posts-staged-get', 'blog/posts-staged-compare', 'blog/posts-staged-promote', 'blog/posts-staged-discard', 'blog/posts-staged-preview'], $editor)) === 6, $editor);
eq('… but not the admin-only authors kind\'s', [array_values(array_filter($editor, static fn (string $n) => str_starts_with($n, 'blog/authors-'))), $item], [[], 404]);
[, $admin, $item] = $listed('admin');
eq('an admin is offered the authors kind\'s too', [in_array('blog/authors-staged-promote', $admin, true), $item], [true, 200]);
// The MCP adapter's own filter, as its tools/list runs it.
$tools = static function (?string $as) use ($site): array {
    $site->actAs($as);
    try {
        $all = array_map(static fn (string $n): object => new class (str_replace('/', '-', $n)) { public function __construct(private string $n) {} public function getName(): string { return $this->n; } },
            array_column(\TypedPress\Wp\Abilities\Register::operations(), 'name'));

        return array_values(array_filter(array_map(static fn (object $t): string => $t->getName(), apply_filters('mcp_adapter_tools_list', $all, null, null)), static fn (string $n) => str_contains($n, '-stage')));
    } finally {
        wp_set_current_user(0);
    }
};
eq('the MCP tools list offers a subscriber no staged tool outside the guestbook', array_values(array_filter($tools('sub'), static fn (string $n) => !str_starts_with($n, 'blog-guestbook-'))), []);
check('… and an editor the posts kind\'s', in_array('blog-posts-staged-promote', $tools('ed'), true));
$run = static function (string $ability, array $input, ?string $as) use ($site): mixed {
    $site->actAs($as);
    try {
        $out = wp_get_ability($ability)->execute($input);

        // An ability answers in wire form (objects); read it as a client would, from its JSON.
        return is_wp_error($out) ? [$out->get_error_data()['status'] ?? null, $out->get_error_code()] : json_decode((string) json_encode($out), true);
    } finally {
        wp_set_current_user(0);
    }
};
$out = $run('blog/posts-stage', ['id' => $pid, 'patch' => ['title' => 'Staged by an agent']], 'ed');
eq('an agent stages through its ability', [$out['row']['title'] ?? null, $out['fields'] ?? null], ['Staged by an agent', ['title']]);
eq('… reads it', $run('blog/posts-staged-get', ['id' => $pid], 'ed')['row']['title'] ?? null, 'Staged by an agent');
eq('… compares it', $run('blog/posts-staged-compare', ['id' => $pid], 'ed')['changes'] ?? null, [['field' => 'title', 'live' => 'Promoted by cron', 'staged' => 'Staged by an agent']]);
check('… gets a preview link', str_contains((string) ($run('blog/posts-staged-preview', ['id' => $pid], 'ed')['api'] ?? ''), '/staged?preview='));
foreach (['blog/posts-staged-get', 'blog/posts-staged-compare', 'blog/posts-staged-promote', 'blog/posts-staged-discard', 'blog/posts-staged-preview'] as $ability) {
    eq("$ability as a subscriber is the missing item's 404", $run($ability, ['id' => $pid], 'sub'), [404, 'tp_not_found']);
    eq("$ability as nobody is the missing item's 404", $run($ability, ['id' => $pid], null), [404, 'tp_not_found']);
}
eq('blog/posts-stage as a subscriber is the missing item\'s 404', $run('blog/posts-stage', ['id' => $pid, 'patch' => ['title' => 'x']], 'sub'), [404, 'tp_not_found']);
// A credential held to staging: a site policy on core's own permission filter refuses the promote ability by name.
$stageOnly = static fn (mixed $allowed, string $name): mixed => $name === 'blog/posts-staged-promote' ? false : $allowed;
add_filter('wp_ability_permission_result', $stageOnly, 10, 2);
$refused = $run('blog/posts-staged-promote', ['id' => $pid], 'ed');
eq('a caller allowed to stage but not to promote: staging runs, the promote ability does not',
    [is_array($run('blog/posts-stage', ['id' => $pid, 'patch' => ['excerpt' => 'Agent excerpt']], 'ed')['row'] ?? null), $refused[1] ?? null, $db->findFirst('posts', ['where' => ['id' => $pid]])['title']],
    [true, 'ability_invalid_permissions', 'Promoted by cron']);
remove_filter('wp_ability_permission_result', $stageOnly, 10);
eq('the promote ability makes it live', $run('blog/posts-staged-promote', ['id' => $pid], 'ed')['title'] ?? null, 'Staged by an agent');
$run('blog/posts-stage', ['id' => $pid, 'patch' => ['title' => 'To discard']], 'ed');
eq('the discard ability ends the staged version', [array_keys((array) $run('blog/posts-staged-discard', ['id' => $pid], 'ed')), $stagedPosts($pid)], [['revision'], []]);

// ================================================================ `wp typedpress staged`, the trusted CLI

[$code, $out] = $site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"Staged from the CLI","memo":"cli memo"}');
eq('wp typedpress staged stage', [$code, $out['data']['row']['title'] ?? null, $out['data']['row']['memo'] ?? null, array_key_exists('by', $out['data']) ? $out['data']['by'] : 'unset'], [0, 'Staged from the CLI', 'cli memo', null]);
[, $out] = $site->cli('staged', 'list');
eq('wp typedpress staged list', array_map(static fn (array $r) => [$r['kind'], $r['id'], $r['fields']], $out['data']), [['posts', $pid, ['title', 'memo']]]);
eq('wp typedpress staged list <kind>', count($site->cli('staged', 'list', 'authors')[1]['data']), 0);
eq('wp typedpress staged compare', array_column($site->cli('staged', 'compare', 'posts', (string) $pid)[1]['data']['changes'], 'field'), ['title', 'memo']);
eq('wp typedpress staged show', $site->cli('staged', 'show', 'posts', (string) $pid)[1]['data']['row']['title'], 'Staged from the CLI');
[$code, $out] = $site->cli('staged', 'promote', 'posts', (string) $pid, "--at=$at");
eq('wp typedpress staged promote --at schedules', [$code, $out['data']['promoteAt'] ?? null], [0, $at]);
eq('wp typedpress staged promote --cancel', $site->cli('staged', 'promote', 'posts', (string) $pid, '--cancel')[1]['data']['promoteAt'], null);
[$code, $out] = $site->cli('staged', 'promote', 'posts', (string) $pid);
eq('wp typedpress staged promote', [$code, $out['data']['title'] ?? null, $out['data']['memo'] ?? null, array_slice($notes($pid), -1)], [0, 'Staged from the CLI', 'cli memo', ['Staged by an agent -> Staged from the CLI by nobody']]);
$site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"x"}');
eq('wp typedpress staged discard', [$site->cli('staged', 'discard', 'posts', (string) $pid)[0], $stagedPosts($pid)], [0, []]);
$site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"cli rev"}');
[, $shown] = $site->cli('staged', 'show', 'posts', (string) $pid);
$token = $shown['data']['_rev'];
$site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"cli rev, again"}');
[$code, $out] = $site->cli('staged', 'promote', 'posts', (string) $pid, "--rev=$token");
eq('wp typedpress staged promote --rev refuses a stale token', [$code, $out['error']['code'] ?? null], [1, 'stale_revision']);
[, $shown] = $site->cli('staged', 'show', 'posts', (string) $pid);
eq('… and takes the current one', $site->cli('staged', 'discard', 'posts', (string) $pid, '--rev=' . $shown['data']['_rev'])[0], 0);
[$code, $out] = $site->cli('staged', 'frobnicate', 'posts', (string) $pid);
eq('an unknown staged command is a usage error', [$code, $out['error']['code'] ?? null], [1, 'invalid_command']);

// ================================================================ a hidden part inside a staged group

$db->update('posts', ['seo' => ['metaTitle' => 'Live meta', 'internal' => 'live secret', 'noindex' => false]], ['id' => $pid]);
[, $grouped] = api('PATCH', "/posts/$pid/staged", ['seo' => ['metaTitle' => 'Staged meta']], 'ed');
eq('an editor stages the part of a group they can set', [$grouped['row']['seo']['metaTitle'] ?? null, array_key_exists('internal', $grouped['row']['seo'])], ['Staged meta', false]);
eq('the admin reads the hidden part beside it, as it is live', api('GET', "/posts/$pid/staged", as: 'admin')[1]['row']['seo']['internal'], 'live secret');
check('the editor\'s compare shows the group without its hidden part', !str_contains((string) json_encode(api('GET', "/posts/$pid/staged/compare", as: 'ed')[1]), 'secret'));
[$code, $row] = api('POST', "/posts/$pid/staged/promote", as: 'ed');
eq('the editor promotes it: the hidden part stays as it is live', [$code, $db->findFirst('posts', ['where' => ['id' => $pid]])['seo']], [200, ['metaTitle' => 'Staged meta', 'metaDescription' => null, 'noindex' => false, 'internal' => 'live secret']]);
api('PATCH', "/posts/$pid/staged", ['seo' => ['metaTitle' => 'Admin meta', 'internal' => 'staged secret']], 'admin');
isProblem('an editor cannot promote a hidden part someone else staged', api('POST', "/posts/$pid/staged/promote", as: 'ed'), 403, 'forbidden', '/seo');
eq('… and nothing of it went live', $db->findFirst('posts', ['where' => ['id' => $pid]])['seo']['internal'], 'live secret');
api('POST', "/posts/$pid/staged/promote", as: 'admin');
eq('the admin promotes it whole', array_intersect_key($db->findFirst('posts', ['where' => ['id' => $pid]])['seo'], ['metaTitle' => 1, 'internal' => 1]), ['metaTitle' => 'Admin meta', 'internal' => 'staged secret']);

// ================================================================ a deleted item takes its staged version with it

api('PATCH', "/posts/{$other['id']}/staged", ['title' => 'Going away'], 'ed');
$db->delete('posts', ['id' => $other['id']]);
eq('deleting the item deletes its staged revision', $stagedPosts($other['id']), []);

// ================================================================ _rev tokens and edit locks

$rev = $db->insert('posts', ['title' => 'Rev live', 'slug' => 'rev-live', 'excerpt' => 'one', 'memo' => 'rev memo'], true)[0]['id'];
[, $read] = api('GET', "/posts/$rev", as: 'ed');
$token = $read['_rev'] ?? null;
check('an item read carries an opaque _rev', is_string($token) && $token !== '', $read);
eq('every reader gets the same live _rev, whoever asks', [api('GET', "/posts/$rev")[1]['_rev'] ?? null, api('GET', "/posts/$rev", as: 'admin')[1]['_rev'] ?? null], [$token, $token]);
eq('a list row carries it too', array_column(array_filter(api('GET', '/posts', as: 'ed', query: ['where' => json_encode(['id' => $rev])])[1], static fn ($r) => $r['id'] === $rev), '_rev'), [$token]);
eq('a table row carries none', array_key_exists('_rev', api('GET', '/comments', as: 'ed')[1][0] ?? []), false);

// A list reads its page's tokens together: each one is the token the item's own read gives, with
// something staged or not, for every reader, and the statements a list runs don't grow with it.
$batch = [];
foreach (['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'] as $n => $title) {
    $batch[] = $db->insert('posts', ['title' => "Page $title", 'slug' => 'page-' . strtolower($title), 'excerpt' => "page $n", 'status' => 'published'], true)[0]['id'];
}
$db->update('posts', ['excerpt' => 'edited'], ['id' => $batch[1]]); // a newer revision
api('PATCH', "/posts/{$batch[2]}/staged", ['excerpt' => 'staged'], 'ed'); // a staged version
api('PATCH', "/posts/{$batch[3]}/staged", ['title' => 'Page Fourth staged'], 'ed');
add_post_meta($batch[4], 'tp_kicker', 'first');
add_post_meta($batch[4], 'tp_kicker', 'second'); // the same key twice: the order of both rows is part of the token
$listed = static fn (?string $as, array $ids): array => array_column(api('GET', '/posts', as: $as, query: ['where' => json_encode(['id' => ['in' => $ids]]), 'limit' => '100'])[1], '_rev', 'id');
$single = static fn (?string $as, array $ids): array => array_combine($ids, array_map(static fn (int $id): ?string => api('GET', "/posts/$id", as: $as)[1]['_rev'] ?? null, $ids));
foreach (['ed', 'admin', null] as $as) {
    $tokens = $listed($as, $batch);
    ksort($tokens);
    eq('each row of a list carries the token its own read gives (' . ($as ?? 'anonymous') . ')', $tokens, $single($as, $batch));
}
eq('… six different tokens', count(array_unique($listed('ed', $batch))), 6);
$staging = static fn (int $id): ?string => api('GET', "/posts/$id/staged", as: 'ed')[1]['_rev'] ?? null;
check('a staged token differs from the item\'s, and from another item\'s staged token', $staging($batch[2]) !== $listed('ed', $batch)[$batch[2]] && $staging($batch[2]) !== $staging($batch[3]));
// The token itself, worked out here one item at a time from what the database holds: reading a
// page's tokens together must not change one byte of any of them.
$tokenOf = static function (int $id, bool $staged) use ($site, $schema): string {
    $prefix = (string) $schema['collections']['posts']['wp']['metaPrefix'];
    $post = $site->sql('SELECT ID, post_modified_gmt, post_status, post_name, post_title, post_content, post_excerpt, post_date_gmt, post_password, post_author FROM {prefix}posts WHERE ID = ?', [$id])[0];
    $meta = $site->sql('SELECT meta_key, meta_value FROM {prefix}postmeta WHERE post_id = ? AND (meta_key LIKE ? OR meta_key LIKE ?) ORDER BY meta_key, meta_id', [$id, $prefix . '%', '\\_' . $prefix . '%']);
    $revision = (int) ($site->sql("SELECT MAX(ID) AS id FROM {prefix}posts WHERE post_parent = ? AND post_type = 'revision' AND post_name = ?", [$id, "$id-revision-v1"])[0]['id'] ?? 0);
    $held = $site->sql("SELECT r.ID, r.post_modified_gmt, r.post_title, r.post_content, m.meta_value FROM {prefix}posts r LEFT JOIN {prefix}postmeta m ON m.post_id = r.ID AND m.meta_key = ?"
        . " WHERE r.post_parent = ? AND r.post_type = 'revision' AND r.post_name = ? ORDER BY r.ID", [Staged::META, $id, "$id-autosave-staged-v1"]);
    $heldMeta = $held === [] ? [] : $site->sql('SELECT meta_key, meta_value FROM {prefix}postmeta WHERE post_id = ? ORDER BY meta_key, meta_id', [(int) $held[0]['ID']]);
    $digest = static fn (mixed $value): string => substr(hash_hmac('sha256', (string) \TypedPress\Js::jsonStringify($value), wp_salt('nonce')), 0, 22);
    $claim = [$staged ? 's' : 'i', $id, $revision, $digest([$post, $meta])];
    if ($staged) {
        $claim[] = $held === [] ? '-' : $digest([$held, $heldMeta]);
    }

    return rtrim(strtr(base64_encode((string) json_encode($claim)), '+/', '-_'), '=');
};
$tokens = $listed('ed', $batch);
ksort($tokens);
eq('each token is the item\'s post row, its fields and its newest revision, as before', $tokens, array_combine($batch, array_map(static fn (int $id): string => $tokenOf($id, false), $batch)));
eq('… and a staged token adds the staged revision and its fields', [$staging($batch[2]), $staging($batch[3])], [$tokenOf($batch[2], true), $tokenOf($batch[3], true)]);
check('… the newest revision is in it', json_decode((string) base64_decode(strtr($listed('ed', $batch)[$batch[1]], '-_', '+/')), true)[2] > 0);
$site->actAs('ed');
$viaAbility = wp_get_ability('blog/posts-list')->execute(['where' => ['id' => ['in' => $batch]], 'limit' => 100]);
wp_set_current_user(0);
$viaAbility = is_wp_error($viaAbility) ? [$viaAbility->get_error_message()] : array_column($viaAbility['rows'], '_rev', 'id');
ksort($viaAbility);
eq('… and so does each row an agent lists through the ability', $viaAbility, $single('ed', $batch));
// A list's token writes; once someone else commits, the same token is refused.
$mine = $listed('ed', $batch)[$batch[0]];
eq('the token a list gave writes the item', api('PATCH', "/posts/{$batch[0]}", ['excerpt' => 'from the list', '_rev' => $mine], 'ed')[0], 200);
$mine = $listed('ed', $batch)[$batch[5]];
api('PATCH', "/posts/{$batch[5]}", ['excerpt' => 'someone else'], 'admin');
[$code, $stale] = api('PATCH', "/posts/{$batch[5]}", ['excerpt' => 'mine', '_rev' => $mine], 'ed');
eq('a list\'s token is refused once another editor has committed', [$code, $stale['code'] ?? null, $stale['changed']['fields'] ?? null, $stale['_rev'] ?? null],
    [409, 'stale_revision', ['excerpt'], $listed('ed', $batch)[$batch[5]]]);
eq('… and nothing of the refused write was stored', $db->findFirst('posts', ['where' => ['id' => $batch[5]]])['excerpt'], 'someone else');
$statements = static function (array $ids) use ($listed): int {
    $n = 0;
    \TypedPress\Wp\Connection::$observer = static function () use (&$n): void {
        $n++;
    };
    try {
        $listed(null, $ids);
    } finally {
        \TypedPress\Wp\Connection::$observer = null;
    }

    return $n;
};
// The item with one meta key stored twice is left out: its stored row is read on its own
// (Db::editorRows), as before.
$unstaged = [$batch[0], $batch[1], $batch[5]];
eq('a list of three items runs as many statements as a list of two', $statements($unstaged), $statements(array_slice($unstaged, 0, 2)));
check('… at most six', $statements($unstaged) <= 6, $statements($unstaged));
$withStaged = [...$unstaged, $batch[2], $batch[3]];
check('staged versions on the page cost two statements, not two for each', $statements($withStaged) <= $statements($unstaged) + 2, [$statements($withStaged), $statements($unstaged)]);

// The item's own write with a stale token: refused, and the problem says what changed and carries the new token.
$db->update('posts', ['excerpt' => 'two'], ['id' => $rev]); // someone else's edit after the read
[$code, $stale] = api('PATCH', "/posts/$rev", ['title' => 'Mine', '_rev' => $token], 'ed');
eq('a PATCH with the _rev of an older read is 409 stale_revision', [$code, $stale['code'] ?? null, $stale['pointer'] ?? null], [409, 'stale_revision', '/_rev']);
eq('… naming the fields that changed since, as the caller may read them', $stale['changed']['fields'] ?? null, ['excerpt']);
$fresh = api('GET', "/posts/$rev", as: 'ed')[1]['_rev'];
eq('… with the current _rev', $stale['_rev'] ?? null, $fresh);
eq('… and nothing was written', $db->findFirst('posts', ['where' => ['id' => $rev]])['title'], 'Rev live');
[$code, $written] = api('PATCH', "/posts/$rev", ['title' => 'Mine', '_rev' => $fresh], 'ed');
eq('the current _rev writes, and the answer carries the next one', [$code, $written['title'] ?? null, ($written['_rev'] ?? $fresh) !== $fresh], [200, 'Mine', true]);
eq('leaving _rev out is an unconditional write, as on core', api('PATCH', "/posts/$rev", ['excerpt' => 'three'], 'ed')[0], 200);
isProblem('a _rev that is not a string', api('PATCH', "/posts/$rev", ['title' => 'x', '_rev' => 5], 'ed'), 422, 'invalid_input', '/_rev');
[$code, $hiddenChange] = (function () use ($rev, $db): array {
    $before = api('GET', "/posts/$rev", as: 'ed')[1]['_rev'];
    $db->update('posts', ['memo' => 'changed memo'], ['id' => $rev]);

    return api('PATCH', "/posts/$rev", ['title' => 'x', '_rev' => $before], 'ed');
})();
eq('a change to a field the caller can\'t read still makes the token stale, and is never named', [$code, $hiddenChange['changed']['fields'] ?? null], [409, []]);
$token = api('GET', "/posts/$rev", as: 'ed')[1]['_rev'];
$db->update('posts', ['excerpt' => 'four'], ['id' => $rev]);
eq('a DELETE with a stale _rev is refused too', api('DELETE', "/posts/$rev", as: 'ed', query: ['_rev' => $token])[0], 409);

// A staged version's token covers the staged version as well; the item's token does not change when someone stages.
$itemToken = api('GET', "/posts/$rev", as: 'ed')[1]['_rev'];
[$code, $first] = api('PATCH', "/posts/$rev/staged", ['excerpt' => 'staged one', '_rev' => $itemToken], 'ed');
eq('with nothing staged, the item\'s own _rev starts a stage', [$code, is_string($first['_rev'] ?? null)], [200, true]);
eq('staging leaves the item\'s _rev as it was, for every reader', [api('GET', "/posts/$rev", as: 'ed')[1]['_rev'], api('GET', "/posts/$rev")[1]['_rev']], [$itemToken, $itemToken]);
[$code, $second] = api('PATCH', "/posts/$rev/staged", ['excerpt' => 'staged two'], 'admin');
eq('… but the staged _rev moves when someone else stages', [$code, ($second['_rev'] ?? null) !== $first['_rev']], [200, true]);
[$code, $conflict] = api('POST', "/posts/$rev/staged/promote", ['_rev' => $first['_rev']], 'ed');
eq('a promote with the staged _rev of an older read is refused, saying the staged version changed', [$code, $conflict['code'] ?? null, $conflict['changed']['staged'] ?? null], [409, 'stale_revision', true]);
eq('… and promotes nothing', $db->findFirst('posts', ['where' => ['id' => $rev]])['excerpt'], 'four');
isProblem('a discard with it is refused too', api('DELETE', "/posts/$rev/staged", as: 'ed', query: ['_rev' => $first['_rev']]), 409, 'stale_revision', '/_rev');
isProblem('… and so is a stage', api('PATCH', "/posts/$rev/staged", ['excerpt' => 'x', '_rev' => $first['_rev']], 'ed'), 409, 'stale_revision', '/_rev');
[$code] = api('POST', "/posts/$rev/staged/promote", ['_rev' => api('GET', "/posts/$rev/staged/compare", as: 'ed')[1]['_rev']], 'ed');
eq('the compare\'s _rev promotes', [$code, $db->findFirst('posts', ['where' => ['id' => $rev]])['excerpt']], [200, 'staged two']);
isProblem('a reader never learns a token is stale: no update rule, the missing row\'s 404',
    api('PATCH', "/posts/$rev/staged", ['excerpt' => 'x', '_rev' => 'stale'], 'sub'), 404, 'not_found');

// ---- core's edit lock: _edit_lock, as the block editor sets it
require_once ABSPATH . 'wp-admin/includes/post.php';
$site->actAs('admin');
wp_set_post_lock($rev);
wp_set_current_user(0);
[$code, $locked] = api('PATCH', "/posts/$rev", ['excerpt' => 'blocked'], 'ed');
eq('while another user holds the edit lock, the API refuses the write: 409 locked, naming the holder',
    [$code, $locked['code'] ?? null, $locked['holder']['id'] ?? null], [409, 'locked', $site->userId('admin')]);
isProblem('… a stage', api('PATCH', "/posts/$rev/staged", ['excerpt' => 'blocked'], 'ed'), 409, 'locked');
api('PATCH', "/posts/$rev/staged", ['excerpt' => 'by the holder'], 'admin');
isProblem('… a promote', api('POST', "/posts/$rev/staged/promote", null, 'ed'), 409, 'locked');
isProblem('… a discard', api('DELETE', "/posts/$rev/staged", as: 'ed'), 409, 'locked');
isProblem('… a delete', api('DELETE', "/posts/$rev", as: 'ed'), 409, 'locked');
eq('the holder writes', api('PATCH', "/posts/$rev", ['excerpt' => 'holder'], 'admin')[0], 200);
eq('reading is never refused', api('GET', "/posts/$rev", as: 'ed')[0], 200);
isProblem('a subscriber learns of no lock: the missing row\'s 404 whatever is locked', api('PATCH', "/posts/$rev", ['excerpt' => 'x'], 'sub'), 404, 'not_found');
// Core REST and abilities are refused the same way.
$site->actAs('ed');
$abilityLocked = wp_get_ability('blog/posts-update')->execute(['id' => $rev, 'patch' => ['excerpt' => 'via agent']]);
$core = new \WP_REST_Request('POST', "/wp/v2/tp_posts/$rev");
$core->set_param('excerpt', 'via core');
$coreLocked = rest_do_request($core);
wp_set_current_user(0);
eq('core REST\'s update of the item is refused while it is locked', [$coreLocked->get_status(), $coreLocked->as_error()?->get_error_code()], [409, 'tp_locked']);
eq('… and so is the update ability', is_wp_error($abilityLocked) ? [$abilityLocked->get_error_code(), $abilityLocked->get_error_data()['status'] ?? null] : $abilityLocked, ['tp_locked', 409]);
eq('nothing of either was written', $db->findFirst('posts', ['where' => ['id' => $rev]])['excerpt'], 'holder');
// Taking over: the editor's "Take over".
[$code, $taken] = api('PATCH', "/posts/$rev", ['excerpt' => 'taken over', 'takeover' => true], 'ed');
eq('takeover: true takes the lock and writes', [$code, $taken['excerpt'] ?? null], [200, 'taken over']);
eq('… the lock is now the taker\'s, so the old holder is refused in turn', (function () use ($site, $rev): array {
    $site->actAs('admin');
    $holder = wp_check_post_lock($rev);
    wp_set_current_user(0);

    return [$holder, api('PATCH', "/posts/$rev", ['excerpt' => 'back'], 'admin')[1]['code'] ?? null];
})(), [$site->userId('ed'), 'locked']);
isProblem('takeover must be a boolean', api('PATCH', "/posts/$rev", ['excerpt' => 'x', 'takeover' => 'yes'], 'admin'), 422, 'invalid_input', '/takeover');
isProblem('takeover doesn\'t open a row the update rule closes', api('PATCH', "/posts/$rev", ['excerpt' => 'x', 'takeover' => true], 'sub'), 404, 'not_found');
// A lock lapses when its heartbeat stops (core's 150-second window).
update_post_meta($rev, '_edit_lock', (time() - 600) . ':' . $site->userId('ed'));
eq('a lapsed lock refuses nobody', api('PATCH', "/posts/$rev", ['excerpt' => 'lapsed'], 'admin')[0], 200);
eq('the trusted CLI is never refused by a lock', (function () use ($site, $rev): int {
    $site->actAs('admin');
    wp_set_post_lock($rev);
    wp_set_current_user(0);

    return $site->cli('update', 'posts', json_encode(['id' => $rev]), json_encode(['excerpt' => 'cli']))[0];
})(), 0);

// ================================================================ review fixes

// 1. A promote scheduled by a signed-out caller runs as a signed-out caller, never as the system.
$guest = $db->insert('guestbook', ['name' => 'Guest live', 'email' => 'g@example.com', 'mood' => 'calm'], true)[0]['id'];
eq('an anonymous caller may stage where the update rule admits anyone', api('PATCH', "/guestbook/$guest/staged", ['name' => 'Guest staged'], null)[0], 200);
isProblem('… but not a field it may not set', api('PATCH', "/guestbook/$guest/staged", ['mood' => 'furious'], null), 401, 'unauthenticated', '/mood');
$at = gmdate('Y-m-d\TH:i:s.000\Z', time() + 7200);
[$code, $scheduled] = api('POST', "/guestbook/$guest/staged/promote", ['at' => $at], null);
eq('an anonymous caller schedules a promote of what it staged', [$code, $scheduled['promoteAt'] ?? null], [200, $at]);
$rid = $stagedPosts($guest)[0];
eq('… recorded as anonymous, never as the trusted CLI', json_decode((string) get_post_meta($rid, Staged::META, true), true)['promoteBy'] ?? null, 'anonymous');
// Before it runs, trusted code stages the admin-only field into the same version. The anonymous
// promote must refuse it rather than make it live with the system's authority.
$site->cli('staged', 'stage', 'guestbook', (string) $guest, '{"mood":"furious"}');
eq('… the schedule survives the trusted stage', json_decode((string) get_post_meta($rid, Staged::META, true), true)['promoteBy'] ?? null, 'anonymous');
$due = static function () use ($rid): void {
    putenv('TP_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 7201));
    do_action('publish_future_post', $rid);
    putenv('TP_NOW');
};
$due();
$row = $db->findFirst('guestbook', ['where' => ['id' => $guest]]);
eq('the anonymous schedule promotes as anonymous: the admin-only field is refused, nothing goes live',
    [$row['mood'], $row['name'], json_decode((string) get_post_meta($rid, Staged::META, true), true)['error']['code'] ?? null], ['calm', 'Guest live', 'unauthenticated']);
// A scheduled record that names no actor (as one could from before actors were named).
update_metadata('post', $rid, Staged::META, wp_slash(json_encode(['fields' => ['name', 'mood'], 'promoteAt' => $at])));
$due();
eq('a schedule that names no actor is refused, never promoted as the system',
    [$db->findFirst('guestbook', ['where' => ['id' => $guest]])['mood'], json_decode((string) get_post_meta($rid, Staged::META, true), true)['error']['code'] ?? null], ['calm', 'forbidden']);
$site->cli('staged', 'discard', 'guestbook', (string) $guest);

// 2. After a discard, a reader can't tell a staged version ever existed; a promote counts as one update.
$traceless = $db->insert('posts', ['title' => 'Traceless', 'slug' => 'traceless'], true)[0]['id'];
$db->update('posts', ['excerpt' => 'an ordinary update'], ['id' => $traceless]);
$reader = static function () use ($url, $traceless): array {
    $item = json_decode(fetch("$url/wp-json/wp/v2/tp_posts/$traceless")['body'], true);

    return [$item['_links']['version-history'][0]['count'] ?? null, $item['_links']['predecessor-version'][0]['id'] ?? null, $item['modified_gmt'] ?? null, $item['date_gmt'] ?? null];
};
$before = $reader();
api('PATCH', "/posts/$traceless/staged", ['title' => 'Never seen'], 'ed');
api('DELETE', "/posts/$traceless/staged", as: 'ed');
eq('after a discard, a reader sees the revision count, the predecessor and the dates as before', $reader(), $before);
$db->update('posts', ['excerpt' => 'another ordinary update'], ['id' => $traceless]);
$afterUpdate = $reader();
api('PATCH', "/posts/$traceless/staged", ['title' => 'Promoted'], 'ed');
api('POST', "/posts/$traceless/staged/promote", null, 'ed');
eq('a promote adds one to the count, as one update does', $reader()[0] - $afterUpdate[0], $afterUpdate[0] - $before[0]);
check('… and the predecessor is the promote\'s own revision, not the staged one', $reader()[1] !== $afterUpdate[1] && !in_array($reader()[1], array_map('intval', array_column(
    $site->sql("SELECT post_id FROM {prefix}postmeta WHERE meta_key = ?", [Staged::META]), 'post_id')), true));

// 3. The preview page shows only what an anonymous visitor may read of the staged change.
$masked = $db->insert('posts', ['title' => 'Masked', 'slug' => 'masked', 'excerpt' => 'public excerpt', 'memo' => 'live memo'], true)[0]['id'];
api('PATCH', "/posts/$masked/staged", ['excerpt' => 'staged excerpt', 'memo' => 'staged secret memo'], 'admin');
[, $maskedLink] = api('POST', "/posts/$masked/staged/preview", as: 'admin');
$pageBody = fetch((string) $maskedLink['url'])['body']; // the template prints tp_memo too
check('the preview page renders the staged field anyone may read', str_contains($pageBody, 'staged excerpt'), $pageBody);
check('… and never the admin-only one, staged or live', !str_contains($pageBody, 'staged secret memo') && !str_contains($pageBody, 'live memo'), $pageBody);

// 4. A rule that throws on the staged data answers as a refusal: the same 404 as with nothing staged.
$riddle = $db->insert('riddles', ['name' => 'Riddle', 'email' => 'r@example.com'], true)[0]['id'];
$plain = api('GET', "/riddles/$riddle/staged", as: 'sub');
$site->cli('staged', 'stage', 'riddles', (string) $riddle, '{"bio":"boom"}');
$withThrow = api('GET', "/riddles/$riddle/staged", as: 'sub');
eq('a subscriber gets the missing row\'s 404 whether or not the staged data makes the rule throw',
    [$withThrow[0], $withThrow[1]['code'] ?? null], [$plain[0], $plain[1]['code'] ?? null]);
eq('… which is the 404', $withThrow[0], 404);

// 5. A promote fires the REST hooks an API update fires.
$restSeen = [];
foreach (['rest_insert_tp_posts', 'rest_after_insert_tp_posts'] as $hook) {
    add_action($hook, static function (\WP_Post $post, \WP_REST_Request $request, bool $creating) use (&$restSeen, $hook): void {
        $restSeen[] = [$hook, $post->ID, $request->get_param('title'), $creating];
    }, 10, 3);
}
$hooked = $db->insert('posts', ['title' => 'Hooked', 'slug' => 'hooked'], true)[0]['id'];
api('PATCH', "/posts/$hooked/staged", ['title' => 'Hooked promoted'], 'ed');
api('POST', "/posts/$hooked/staged/promote", null, 'ed');
eq('a promote fires rest_insert_ and rest_after_insert_ with the update', $restSeen,
    [['rest_insert_tp_posts', $hooked, 'Hooked promoted', false], ['rest_after_insert_tp_posts', $hooked, 'Hooked promoted', false]]);

// Listeners on core's post hooks: staging writes a revision post, which must not look like a change
// to the live item to anything that purges or pings it.
$livePosts = [];
$listen = static function (mixed $post) use (&$livePosts): void {
    $id = $post instanceof \WP_Post ? $post->ID : (int) $post;
    $livePosts[] = get_post_type($id);
};
foreach (['save_post', 'clean_post_cache', 'publish_future_post', 'transition_post_status'] as $hook) {
    add_action($hook, $hook === 'transition_post_status' ? static fn ($new, $old, $post) => $listen($post) : $listen, 10, $hook === 'transition_post_status' ? 3 : 1);
}
$announced = [];
$purge = static function (array $paths) use (&$announced): void { $announced[] = $paths; };
add_action('tp_purge_urls', $purge);
$quiet = $db->insert('posts', ['title' => 'Quiet', 'slug' => 'quiet'], true)[0]['id'];
\TypedPress\Wp\Purges::flush();
[$livePosts, $announced] = [[], []];
api('PATCH', "/posts/$quiet/staged", ['title' => 'Quiet staged'], 'ed');
\TypedPress\Wp\Purges::flush();
eq('staging announces no URL purge', $announced, []);
eq('… and every post hook it fires is for the revision post, never the live item', array_values(array_unique($livePosts)), ['revision']);
remove_action('tp_purge_urls', $purge);

// wp-admin's save (edit_post) runs core's revision upgrade when the oldest revision core lists has
// no version it reads; an item that has no revision of its own yet (one made by an import) has
// only the staged one.
$bare = $db->insert('posts', ['title' => 'Bare', 'slug' => 'bare'], true)[0]['id'];
foreach (array_column($site->sql("SELECT ID FROM {prefix}posts WHERE post_parent = ? AND post_type = 'revision'", [$bare]), 'ID') as $rev) {
    wp_delete_post_revision((int) $rev);
}
api('PATCH', "/posts/$bare/staged", ['title' => 'Bare staged'], 'ed');
$oldest = current(wp_get_post_revisions($bare, ['order' => 'ASC', 'posts_per_page' => 1]));
check('the oldest revision wp-admin checks is never the staged one', $oldest === false || _wp_get_post_revision_version($oldest) >= 1, $oldest);
$upgrades = [];
$spy = static function (string $option) use (&$upgrades): void {
    if (str_starts_with($option, 'revision-upgrade-')) {
        $upgrades[] = $option;
    }
};
add_action('update_option', $spy);
require_once ABSPATH . 'wp-admin/includes/post.php';
$site->actAs('admin');
edit_post(['post_ID' => $bare, 'post_title' => 'Bare', 'post_type' => 'tp_posts', 'post_status' => 'publish']);
wp_set_current_user(0);
remove_action('update_option', $spy);
eq('a wp-admin save of the item runs no revision upgrade', $upgrades, []);
eq('… and the staged version is as it was', api('GET', "/posts/$bare/staged", as: 'ed')[1]['row']['title'] ?? null, 'Bare staged');

// A staged revision written before staged revisions had their own status is `inherit`: the runtime
// upgrade step gives it the staged status, keeps everything else, and leaves other revisions alone.
$old = $db->insert('posts', ['title' => 'Old', 'slug' => 'old'], true)[0]['id'];
[, $oldStaged] = api('PATCH', "/posts/$old/staged", ['title' => 'Old staged'], 'ed');
$site->sql("UPDATE {prefix}posts SET post_status = 'inherit' WHERE ID = ?", [$oldStaged['id']]);
clean_post_cache($oldStaged['id']);
$statuses = static fn (): array => array_column($site->sql("SELECT ID, post_status FROM {prefix}posts WHERE post_type = 'revision' ORDER BY ID"), 'post_status', 'ID');
$before = $statuses();
\TypedPress\Wp\WpPostStore::upgradeStagedStatus($db->store());
\TypedPress\Wp\WpPostStore::upgradeStagedStatus($db->store());
eq('the upgrade gives an old staged revision the staged status, and changes no other revision', array_diff_assoc($statuses(), $before), [$oldStaged['id'] => 'typedpress-staged']);
eq('… which still reads as the staged version', api('GET', "/posts/$old/staged", as: 'ed')[1]['row']['title'] ?? null, 'Old staged');

finish('staged');
