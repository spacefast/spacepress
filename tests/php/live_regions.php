<?php

declare(strict_types=1);

/*
 * The subscription endpoint's `page` read (docs/decisions/2026-11-14-live-regions.md):
 * tests/fixtures/live-regions, built by `first build`, on WordPress with php -S. Every answer comes
 * from `POST /__first/api/v1/_live` over HTTP, as the browser asks. Prints one JSON object.
 *
 *   FIRST_WP_THEMES=1 php tests/php/live_regions.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('live-regions', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor'], 'muPlugins' => ['host' => <<<'PHP'
    <?php
    // A host that keeps cached pages: the page cache records what cacheable renders read.
    add_action('first_purge_urls', static function (array $paths): void {});
    // Counts the page renders `_live` runs, to tell "not modified" by counter from by hash.
    add_action('first_app_live_rendered', static function (): void {
        update_option('test_live_renders', (int) get_option('test_live_renders', 0) + 1, false);
    });
    PHP]]);
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'One', 'slug' => 'one', 'status' => 'published']);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function post(string $url, array $queries, array $headers = []): array
{
    $ch = curl_init("$url/__first/api/v1/_live");
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', ...$headers], CURLOPT_POSTFIELDS => json_encode(['queries' => $queries]),
    ]);
    $body = (string) curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $json = json_decode($body, true);
    return $status === 200 ? $json['data']['results'] : ['status' => $status, 'body' => $json ?? $body];
}

$page = static fn (string $path, string $region, ?string $token = null): array => ['op' => 'page', 'args' => ['url' => $path, 'region' => $region]] + ($token === null ? [] : ['token' => $token]);
$shape = static function (array $r): string {
    return isset($r['error']) ? 'error ' . $r['error']['status'] . ' ' . $r['error']['code'] : (isset($r['pending']) ? 'pending' : ($r['changed'] ? 'changed' : 'unchanged'));
};
$items = static fn (array $r): array => isset($r['data']['html']) && preg_match_all('#<li[^>]*class="note"[^>]*>([^<]*)</li>#', $r['data']['html'], $m) ? $m[1] : [];
global $wpdb;
$reads = static fn (): int => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}first__app_reads");

$out = [];
$renders = static function (): int {
    global $wpdb;
    return (int) $wpdb->get_var("SELECT option_value FROM {$wpdb->options} WHERE option_name = 'test_live_renders'");
};
// The first answer: the region's HTML, and only the region's.
[$first] = post($url, [$page('/', 'notes')]);
$out['first'] = [$shape($first), $items($first), str_contains($first['data']['html'], '<h1>'), $first['data']['kinds']];
// Asked again with its token and nothing changed: "not modified" (by counter: notes has one for anonymous visitors).
$was = $renders();
[$again] = post($url, [$page('/', 'notes', $first['token'])]);
$out['again'] = [$shape($again), 'rendered' => $renders() - $was];
// Determinism: rendered twice without the counter shortcut (no token), the same hash, so a held
// token from one render answers "unchanged" after another.
[$fresh] = post($url, [$page('/', 'notes')]);
$out['same hash'] = $fresh['data']['html'] === $first['data']['html'];
// A write the region read: changed on the next poll.
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Two', 'status' => 'published']);
$site->actAs(null);
[$after] = post($url, [$page('/', 'notes', $again['token'])]);
$out['after write'] = [$shape($after), $items($after)];
// A draft doesn't show to anonymous visitors, and doesn't count as a change for them.
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Draft', 'status' => 'draft']);
$site->actAs(null);
[$draft] = post($url, [$page('/', 'notes', $after['token'])]);
$out['after draft'] = $shape($draft);
// A page that reads nothing has no counters: it renders and compares every time (here, unchanged).
[$empty] = post($url, [$page('/about', 'static')]);
$was = $renders();
[$empty2] = post($url, [$page('/about', 'static', $empty['token'])]);
$out['no reads'] = [$shape($empty), $shape($empty2), 'rendered' => $renders() - $was];
// Refusals: a guarded page answers its problem, never HTML; unknown regions, URLs that aren't pages,
// hosts, and bad region ids are refused.
$out['guarded anonymous'] = $shape(post($url, [$page('/desk', 'count')])[0]);
$out['missing region'] = $shape(post($url, [$page('/', 'nope')])[0]);
$out['not a page'] = $shape(post($url, [$page('/wp-admin/', 'notes')])[0]);
$out['host'] = $shape(post($url, [$page('//evil.example/', 'notes')])[0]);
$out['scheme'] = $shape(post($url, [$page('https://evil.example/', 'notes')])[0]);
$out['bad region'] = $shape(post($url, [$page('/', 'Bad Id')])[0]);
// At most four page reads render per request; the fifth answers `pending` (the client asks again
// at once), so a page with more regions than the cap still fills them all on the next request.
$five = post($url, array_fill(0, 5, $page('/about', 'static')));
$again5 = post($url, [$page('/about', 'static')]);
$out['cap'] = [array_map($shape, $five), $shape($again5[0])];

// Signed in: an editor reads the guarded page's count, and a `_live` render records nothing in
// the page cache's read index, while an anonymous GET of the page does.
$id = $site->userId('chief');
$expires = time() + 3600;
$token = WP_Session_Tokens::get_instance($id)->create($expires);
$logged = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
$_COOKIE[LOGGED_IN_COOKIE] = $logged;
wp_set_current_user($id);
$nonce = wp_create_nonce('wp_rest');
wp_set_current_user(0);
unset($_COOKIE[LOGGED_IN_COOKIE]);
$editor = ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($logged), "X-WP-Nonce: $nonce"];
$before = $reads();
[$desk] = post($url, [$page('/desk', 'count')], $editor);
[$home] = post($url, [$page('/', 'notes')], $editor);
$out['editor'] = [$shape($desk), preg_match('#class="count">(\d+)<#', $desk['data']['html'] ?? '', $m) ? (int) $m[1] : null, $items($home)];
$out['records nothing'] = $reads() - $before;
$ch = curl_init("$url/");
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true]);
curl_exec($ch);
$out['a GET records'] = $reads() - $before > 0;

// `<Live>` around `<Comments>`: a new approved comment shows on the next poll, not after the
// five-minute trust window, because the thread marks the page as reading something unseen.
$slug = (string) \First\db()->findFirst('notes', ['where' => ['title' => 'One']])['slug'];
$noteId = (int) \First\db()->findFirst('notes', ['where' => ['title' => 'One']])['id'];
[$thread] = post($url, [$page("/notes/$slug", 'thread')]);
wp_insert_comment(['comment_post_ID' => $noteId, 'comment_content' => 'Live hello', 'comment_author' => 'admin', 'user_id' => 1, 'comment_approved' => 1]);
$was = $renders();
[$thread2] = post($url, [$page("/notes/$slug", 'thread', $thread['token'])]);
$out['comments'] = [$shape($thread), str_contains($thread['data']['html'] ?? '', 'Live hello'), $shape($thread2), str_contains($thread2['data']['html'] ?? '', 'Live hello'), 'rendered' => $renders() - $was];

// The visitor key includes the post-password cookie: a password-protected note is in the region
// only for a visitor holding its cookie, and a token issued to one visitor is never "not modified"
// for the other.
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Locked', 'slug' => 'locked', 'status' => 'published']);
wp_update_post(['ID' => (int) \First\db()->findFirst('notes', ['where' => ['slug' => 'locked']])['id'], 'post_password' => 'open sesame']);
$site->actAs(null);
require_once ABSPATH . WPINC . '/class-phpass.php';
$pass = ['Cookie: wp-postpass_' . COOKIEHASH . '=' . rawurlencode((new PasswordHash(8, true))->HashPassword('open sesame'))];
[$without] = post($url, [$page('/', 'notes')]);
[$with] = post($url, [$page('/', 'notes')], $pass);
[$crossA] = post($url, [$page('/', 'notes', $without['token'])], $pass);
[$crossB] = post($url, [$page('/', 'notes', $with['token'])]);
$out['password'] = [
    'without' => in_array('Locked', $items($without), true),
    'with' => in_array('Locked', $items($with), true),
    'without token, with cookie' => [$shape($crossA), in_array('Locked', $items($crossA), true)],
    'with token, without cookie' => [$shape($crossB), in_array('Locked', $items($crossB), true)],
];
wp_set_current_user(1);
wp_delete_post((int) \First\db()->findFirst('notes', ['where' => ['slug' => 'locked']])['id'], true);
$site->actAs(null);

// A new build of the same page: the held token is a different question, so the region renders.
$schemaFile = \First\Wp\Runtime::plugin()->dir . '/first/app/schema.php';
[$held] = post($url, [$page('/', 'notes')]);
file_put_contents($schemaFile, file_get_contents($schemaFile) . "\n// another build\n");
[$rebuilt] = post($url, [$page('/', 'notes', $held['token'])]);
$out['new build'] = [$shape($rebuilt), isset($rebuilt['data'])];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
