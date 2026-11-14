<?php

declare(strict_types=1);

/*
 * Staged versions of post kinds (First\Wp\Staged) on a real WordPress (tests/php/wp.php): a change
 * staged beside a published item, what every reader of the item keeps getting meanwhile, compare,
 * promote through the update pipeline, a scheduled promote on core's cron event, discard, signed
 * preview links, and who may learn that a staged version exists. In-process through the API's own
 * router and the abilities, and over HTTP through php -S for what an anonymous client is served.
 */

use First\App;
use First\HttpError;
use First\Viewer;
use First\Wp\Facade;
use First\Wp\Staged;

putenv('FIRST_WP_THEMES=1'); // the served site renders pages (the preview link's HTML)
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
$fixed['wp'] = ['postType' => 'first_fixed', 'groupKey' => 'group_first_fixed', 'metaPrefix' => 'first_', 'fieldKeyPrefix' => 'field_first_fixed_'];
$fixed['access'] = array_fill_keys(['read', 'create', 'update', 'delete'], ['role' => 'editor']);
$schema['collections']['fixed'] = $fixed;
$schema['webhooks'] = [['url' => ['env' => 'FIRST_HOOK_URL'], 'secret' => ['env' => 'FIRST_HOOK_SECRET'], 'events' => ['posts.updated']]];
putenv('FIRST_HOOK_URL=http://127.0.0.1:9/hook');
putenv('FIRST_HOOK_SECRET=whsec_test');
$functions = file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

    /** Every update of a post leaves one comment naming the change and who made it. */
    function posts__afterUpdate(\First\JsObject $row, \First\JsObject $previous, \First\JsObject $ctx)
    {
        $user = \First\Js::prop($ctx, 'user');
        \First\db()->insert('comments', ['postId' => $row->p['id'], 'name' => 'afterUpdate',
            'body' => $previous->p['title'] . ' -> ' . $row->p['title'] . ' by ' . ($user === null ? 'nobody' : \First\Js::prop($user, 'name'))]);
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
            file_put_contents($file, '<?php while (have_posts()) { the_post(); echo "<h1>", get_the_title(), "</h1><main>", get_the_content(), "</main><p id=\"excerpt\">", esc_html((string) get_post_meta(get_the_ID(), "first_excerpt", true)), "</p><p id=\"kicker\">", esc_html((string) get_post_meta(get_the_ID(), "first_kicker", true)), "</p>"; }');

            return $file;
        }, PHP_INT_MAX);
        PHP],
]);
$plugin = $site->plugin();
$db = \First\db();
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
    } catch (HttpError | \First\JsError $e) {
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
$webhooks = static fn (): int => (int) $site->scalar("SELECT COUNT(*) FROM {prefix}first__jobs WHERE job = 'first.webhook'");
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
    $item = json_decode(fetch("$url/wp-json/wp/v2/first_posts/$pid")['body'], true);

    return [
        'api item' => fetch("$url/__first/api/v1/posts/$pid")['body'],
        'api item, subscriber' => fetch("$url/__first/api/v1/posts/$pid", [$basic('sub')])['body'],
        'api list' => fetch("$url/__first/api/v1/posts")['body'],
        'api search' => fetch("$url/__first/api/v1/posts?search=stagedmarker")['body'],
        'site-wide search' => fetch("$url/__first/api/v1/search?q=stagedmarker")['body'],
        'api markdown' => fetch("$url/__first/api/v1/posts/$pid?format=md")['body'],
        'core item' => [$item['title'] ?? null, $item['content'] ?? null, $item['slug'] ?? null, $item['modified_gmt'] ?? null, $item['meta'] ?? null],
        'core item links' => [$item['_links']['version-history'] ?? null, $item['_links']['predecessor-version'] ?? null],
        'core list search' => fetch("$url/wp-json/wp/v2/first_posts?search=stagedmarker")['body'],
        'core search' => fetch("$url/wp-json/wp/v2/search?search=stagedmarker")['body'],
        'core revisions' => fetch("$url/wp-json/wp/v2/first_posts/$pid/revisions")['status'],
        'core autosaves' => fetch("$url/wp-json/wp/v2/first_posts/$pid/autosaves")['status'],
        'page' => fetch("$url/blog/live-post/")['body'],
        'twin' => fetch("$url/blog/live-post.md")['body'],
        'staged slug page' => fetch("$url/blog/staged-post/")['status'],
        'staged slug twin' => fetch("$url/blog/staged-post.md")['status'],
        'feed' => preg_replace('#<lastBuildDate>.*?</lastBuildDate>#', '', fetch("$url/?feed=rss2&post_type=first_posts")['body']),
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
eq('over HTTP an anonymous client gets the 404 too', [fetch("$url/__first/api/v1/posts/$pid/staged")['status'], fetch("$url/__first/api/v1/posts/$pid/staged/compare", [$basic('sub')])['status']], [404, 404]);
$served = json_decode(fetch("$url/__first/api/v1/posts/$pid/staged", [$basic('ed')])['body'], true);
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
check('a preview link names the API read and the page', str_starts_with($link['api'], "$url/__first/api/v1/posts/$pid/staged?preview=") && str_starts_with((string) $link['url'], "$url/blog/live-post/?first_preview="), $link);
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
eq('the twin ignores a preview link', fetch("$url/blog/live-post.md?first_preview=" . $link['token'])['body'], $before['twin']);
$tampered = substr($link['token'], 0, -2) . (str_ends_with($link['token'], 'AA') ? 'BB' : 'AA');
eq('a tampered link is not a link', [fetch("$url/__first/api/v1/posts/$pid/staged?preview=$tampered")['status'], fetch("$url/blog/live-post/?first_preview=$tampered")['body']], [404, $before['page']]);
eq('a link names one item only', fetch("$url/__first/api/v1/posts/{$other['id']}/staged?preview=" . $link['token'])['status'], 404);
check('a link is valid now', Staged::previewed('posts', $pid, $link['token']) !== null);
putenv('FIRST_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 3601));
eq('a link expires after an hour by default', Staged::previewed('posts', $pid, $link['token']), null);
putenv('FIRST_NOW');
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
putenv('FIRST_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 7201));
do_action('publish_future_post', $hers['id']);
putenv('FIRST_NOW');
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
add_action('first_purge_urls', static function (array $paths) use (&$announced): void {
    $announced[] = $paths;
});
$history = count(api('GET', "/posts/$pid/revisions", as: 'admin')[1]);
[$code, $promoted] = api('POST', "/posts/$pid/staged/promote", as: 'admin');
\First\Wp\Purges::flush();
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
putenv('FIRST_NOW=' . gmdate('Y-m-d\TH:i:s.000\Z', time() + 7201));
do_action('publish_future_post', $due['id']);
putenv('FIRST_NOW');
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
eq('a subscriber, whose update rule covers no row here, is offered no staged ability', [$code, $subscriber, $item], [200, [], 404]);
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
            array_column(\First\Wp\Abilities\Register::operations(), 'name'));

        return array_values(array_filter(array_map(static fn (object $t): string => $t->getName(), apply_filters('mcp_adapter_tools_list', $all, null, null)), static fn (string $n) => str_contains($n, '-stage')));
    } finally {
        wp_set_current_user(0);
    }
};
eq('the MCP tools list offers a subscriber no staged tool', $tools('sub'), []);
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
    eq("$ability as a subscriber is the missing item's 404", $run($ability, ['id' => $pid], 'sub'), [404, 'first_not_found']);
    eq("$ability as nobody is the missing item's 404", $run($ability, ['id' => $pid], null), [404, 'first_not_found']);
}
eq('blog/posts-stage as a subscriber is the missing item\'s 404', $run('blog/posts-stage', ['id' => $pid, 'patch' => ['title' => 'x']], 'sub'), [404, 'first_not_found']);
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

// ================================================================ `wp first staged`, the trusted CLI

[$code, $out] = $site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"Staged from the CLI","memo":"cli memo"}');
eq('wp first staged stage', [$code, $out['data']['row']['title'] ?? null, $out['data']['row']['memo'] ?? null, array_key_exists('by', $out['data']) ? $out['data']['by'] : 'unset'], [0, 'Staged from the CLI', 'cli memo', null]);
[, $out] = $site->cli('staged', 'list');
eq('wp first staged list', array_map(static fn (array $r) => [$r['kind'], $r['id'], $r['fields']], $out['data']), [['posts', $pid, ['title', 'memo']]]);
eq('wp first staged list <kind>', count($site->cli('staged', 'list', 'authors')[1]['data']), 0);
eq('wp first staged compare', array_column($site->cli('staged', 'compare', 'posts', (string) $pid)[1]['data']['changes'], 'field'), ['title', 'memo']);
eq('wp first staged show', $site->cli('staged', 'show', 'posts', (string) $pid)[1]['data']['row']['title'], 'Staged from the CLI');
[$code, $out] = $site->cli('staged', 'promote', 'posts', (string) $pid, "--at=$at");
eq('wp first staged promote --at schedules', [$code, $out['data']['promoteAt'] ?? null], [0, $at]);
eq('wp first staged promote --cancel', $site->cli('staged', 'promote', 'posts', (string) $pid, '--cancel')[1]['data']['promoteAt'], null);
[$code, $out] = $site->cli('staged', 'promote', 'posts', (string) $pid);
eq('wp first staged promote', [$code, $out['data']['title'] ?? null, $out['data']['memo'] ?? null, array_slice($notes($pid), -1)], [0, 'Staged from the CLI', 'cli memo', ['Staged by an agent -> Staged from the CLI by nobody']]);
$site->cli('staged', 'stage', 'posts', (string) $pid, '{"title":"x"}');
eq('wp first staged discard', [$site->cli('staged', 'discard', 'posts', (string) $pid)[0], $stagedPosts($pid)], [0, []]);
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

finish('staged');
