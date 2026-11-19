<?php

declare(strict_types=1);

/*
 * Cache policy and URL purges for tp/app/ pages over HTTP (tests/app_router.rs
 * `app_pages_cache_and_purge_by_what_they_read`): the app-router fixture with a must-use plugin
 * standing in for the host, recording each `tp_purge_urls` announcement. Prints JSON.
 *
 *   TP_WP_THEMES=1 php tests/php/app_cache.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-cache', ['wpContent' => $argv[1], 'identity' => true, 'users' => ['chief' => 'editor'], 'muPlugins' => [
    'host' => <<<'PHP'
        <?php
        add_action('tp_purge_urls', static function (array $paths): void {
            $seen = get_option('test_purges', []);
            $seen[] = $paths;
            update_option('test_purges', $seen, false);
        });
        PHP,
    // Stand-ins for the page caches TypedPress purges by itself: Batcache's and VIP's purge functions,
    // and Jetpack Boost's public action. Each records the URLs it was asked to clear.
    'page-caches' => <<<'PHP'
        <?php
        function tp_test_cleared(string $cache, string $url): void
        {
            $seen = get_option('test_cleared', []);
            $seen[] = "$cache $url";
            update_option('test_cleared', $seen, false);
        }
        // Batcache counts only while its drop-in runs: that is what sets $batcache.
        $GLOBALS['batcache'] = new stdClass();
        function batcache_clear_url($url) { tp_test_cleared('batcache', $url); }
        // Batcache's opt-out, marked on the response so a test sees which answers it would drop.
        function batcache_cancel(): void
        {
            $GLOBALS['batcache']->cancel = true;
            if (!headers_sent()) {
                header('X-Test-Batcache: cancel');
            }
        }
        // A plugin that sets a cookie before a page renders (Polylang's language cookie, on `wp`).
        add_action('wp', static function (): void {
            if (isset($_SERVER['HTTP_X_TEST_SET_COOKIE'])) {
                setcookie('test_cookie', '1');
            }
        });
        function wpvip_purge_edge_cache_for_url($url) { tp_test_cleared('vip', $url); }
        function wpvip_purge_edge_cache_for_site() { tp_test_cleared('vip', '*'); }
        add_action('jetpack_boost_clear_page_cache_url', static fn ($url) => tp_test_cleared('boost', $url));
        add_action('jetpack_boost_clear_page_cache_home', static fn () => tp_test_cleared('boost', 'home'));
        // The WP Cloud platform's edge purge actions, as an Atomic site registers them.
        add_action('edge_cache_purge_uris', static function (array $urls): void {
            tp_test_cleared('edge', implode(' ', $urls));
        });
        add_action('edge_cache_purge_domain', static fn () => tp_test_cleared('edge', '*'));
        PHP,
]]);
wp_set_current_user(1);
$hello = \TypedPress\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published'], true)[0];
$other = \TypedPress\db()->insert('notes', ['title' => 'Other', 'slug' => 'other', 'status' => 'published'], true)[0];
$third = \TypedPress\db()->insert('notes', ['title' => 'Third', 'slug' => 'third', 'status' => 'published'], true)[0];
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, array $headers = []): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    curl_exec($ch);
    $seen = ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'cache' => $out['cache-control'][0] ?? null, 'edge' => $out['a8c-edge-cache'][0] ?? null];
    // Only where Batcache would drop the answer, so the page expectations stay as they were.
    return isset($out['x-test-batcache']) ? $seen + ['batcache' => 'cancel'] : $seen;
}
/** The window Batcache keeps a response for: its own regex over the header (advanced-cache.php, Batcache 1.5). */
function batcacheWindow(?string $header): ?int
{
    return preg_match('/^Cache-Control:.*max-?age=(\d+)/i', "Cache-Control: $header", $m) ? (int) $m[1] : null;
}
$cookie = static function (string $user) use ($site): string {
    $id = $site->userId($user);
    return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, time() + 3600, 'logged_in'));
};

$appPassword = \WP_Application_Passwords::create_new_application_password($site->userId('chief'), ['name' => 'cache test'])[0];
$out = [
    // Every page reads differently: home lists notes, /notes/hello reads one, /about reads nothing.
    'home' => fetch("$url/"),
    'note' => fetch("$url/notes/hello/"),
    'other note' => fetch("$url/notes/other/"),
    'about' => fetch("$url/about/"),
    'as editor' => fetch("$url/notes/hello/", [$cookie('chief')]),
    'guarded' => fetch("$url/account/", [$cookie('chief')]),
    'missing' => fetch("$url/notes/nope/"),
    // A cookie the render may answer for, though WordPress signs no one in: a comment author's saved
    // name and email, an unlocked password-protected post, an Identity session.
    'comment author' => fetch("$url/about/", ['Cookie: comment_author_' . COOKIEHASH . '=Ann']),
    'post password' => fetch("$url/about/", ['Cookie: wp-postpass_' . COOKIEHASH . '=x']),
    'identity session' => fetch("$url/about/", ['Cookie: zi_session=x']),
    'sets a cookie' => fetch("$url/about/", ['X-Test-Set-Cookie: 1']),
    // Batcache keeps what any request without a WordPress cookie printed, whatever its Cache-Control:
    // TypedPress's API and Identity's answer for whoever asks, signed in by a header or by the
    // Identity cookie (which never sets the WordPress user for Identity's own API).
    'api anonymous' => fetch("$url/wp-json/typedpress/v1/me"),
    'api app password' => fetch("$url/wp-json/typedpress/v1/me", ['Authorization: Basic ' . base64_encode("chief:$appPassword")]),
    'identity api' => fetch("$url/?rest_route=/typedpress-identity/v1/account", ['Cookie: zi_session=x']),
];
// Every policy Cache::policy() hands out, as Batcache reads it: a shareable page is kept for its
// window (also a filtered one), anything else for none.
foreach ([[200, true, false], [200, false, false], [200, true, true], [404, true, false], [500, true, false]] as [$status, $anonymous, $guarded]) {
    [$header, $shared] = \TypedPress\Render\Cache::policy($status, $anonymous, $guarded);
    $out['batcache'][] = [$status, $anonymous, $guarded, $shared, batcacheWindow($header)];
}
add_filter('tp_app_cache_window', static fn () => 60);
$out['batcache'][] = ['window 60', batcacheWindow(\TypedPress\Render\Cache::policy(200, true, false)[0])];
remove_all_filters('tp_app_cache_window');
$out['batcache served'] = array_map(static fn (string $key) => batcacheWindow($out[$key]['cache']), ['home' => 'home', 'as editor' => 'as editor', 'missing' => 'missing']);
// A count reads no rows, but what it answers changes with every write to the kind: the render
// that counts records the kind as listed, as a list would.
\TypedPress\Render\Reads::during(static fn () => \TypedPress\db()->count('notes'), $counted);
$out['count reads'] = $counted;
// Dependency IDs keep the order and type of their first appearance across overlapping reads.
\TypedPress\Render\Reads::during(static function (): void {
    foreach ([[7, '7', '07'], ['7', 8, 7]] as $ids) {
        \TypedPress\Extensions::read(array_map(static fn ($id) => ['id' => $id], $ids), 'notes', null);
    }
}, $overlap);
if ($overlap !== ['notes' => ['ids' => [7, '7', '07', 8], 'listed' => true]]) {
    throw new RuntimeException('Overlapping reads lost their primary key order or type.');
}
global $wpdb;
$out['index'] = array_map(static fn ($r) => "{$r['kind']} {$r['item']} {$r['url']}", $wpdb->get_results("SELECT kind, item, url FROM {$wpdb->prefix}tp__app_reads ORDER BY url, kind, item", ARRAY_A));
// An edit to one note purges the URLs that read it and the ones that listed notes, nothing else.
\TypedPress\Wp\Purges::flush(); // what setting the site up wrote outside a transaction goes out first
delete_option('test_purges');
delete_option('test_cleared');
wp_set_current_user(1);
\TypedPress\db()->update('notes', ['title' => 'Hello again'], ['id' => (int) $hello['id']]);
wp_cache_delete('test_purges', 'options');
$out['purged'] = get_option('test_purges', []);
wp_cache_delete('test_cleared', 'options');
$out['cleared'] = str_replace($url, '', get_option('test_cleared', []));
// A twin a page cache kept before its HTML page was ever rendered: fetched alone, then its row
// changes. The twin is a shared answer too, so its URL is purged with the page's.
$out['twin only'] = fetch("$url/notes/third.md");
$out['twin index'] = array_map(static fn ($r) => "{$r['kind']} " . ($r['item'] === (string) $third['id'] ? 'third' : $r['item']) . " {$r['url']}", $wpdb->get_results("SELECT kind, item, url FROM {$wpdb->prefix}tp__app_reads WHERE url LIKE '/notes/third%' ORDER BY url, kind, item", ARRAY_A));
delete_option('test_purges');
wp_set_current_user(1);
\TypedPress\db()->update('notes', ['title' => 'Third again'], ['id' => (int) $third['id']]);
wp_cache_delete('test_purges', 'options');
$out['twin purged'] = get_option('test_purges', []);
// A whole-host purge bans the VIP site and reaches Boost's clear-all; Batcache has none.
delete_option('test_cleared');
add_action('jetpack_boost_clear_page_cache_all', static fn () => tp_test_cleared('boost', '*'));
\TypedPress\Wp\PageCaches::purge(['/*']);
$out['cleared all'] = get_option('test_cleared', []);
// More paths than VIP queues in one request: one site ban for VIP, each path still for the others.
delete_option('test_cleared');
\TypedPress\Wp\PageCaches::purge(array_map(static fn (int $n): string => "/n/$n", range(1, 101)));
$cleared = get_option('test_cleared', []);
$out['cleared many'] = [count(array_filter($cleared, static fn ($c) => str_starts_with($c, 'vip '))), in_array('vip *', $cleared, true), count(array_filter($cleared, static fn ($c) => str_starts_with($c, 'batcache ')))];
// Without the drop-in ($batcache unset), Batcache's manager plugin alone is not a page cache.
unset($GLOBALS['batcache']);
delete_option('test_cleared');
\TypedPress\Wp\PageCaches::purge(['/about']);
$out['without batcache drop-in'] = str_replace($url, '', get_option('test_cleared', []));
// Batcache keeps any response to a request without a WordPress cookie, whatever its Cache-Control:
// a request signed in another way (an application password, a bearer token) cancels it, as soon as
// WordPress knows the user, and an anonymous one does not. The stand-in's flag.
$GLOBALS['batcache'] = new stdClass();
$cancelled = [];
foreach (['anonymous' => 0, 'signed in' => 1] as $who => $id) {
    $GLOBALS['batcache']->cancel = false;
    wp_set_current_user($id);
    $cancelled[$who] = $GLOBALS['batcache']->cancel;
}
$out['batcache cancelled'] = $cancelled;
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
