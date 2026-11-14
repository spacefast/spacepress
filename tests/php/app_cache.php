<?php

declare(strict_types=1);

/*
 * Cache policy and URL purges for first/app/ pages over HTTP (tests/app_router.rs
 * `app_pages_cache_and_purge_by_what_they_read`): the app-router fixture with a must-use plugin
 * standing in for the host, recording each `first_purge_urls` announcement. Prints JSON.
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_cache.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-cache', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor'], 'muPlugins' => [
    'host' => <<<'PHP'
        <?php
        add_action('first_purge_urls', static function (array $paths): void {
            $seen = get_option('test_purges', []);
            $seen[] = $paths;
            update_option('test_purges', $seen, false);
        });
        PHP,
    // Stand-ins for the page caches First purges by itself: Batcache's and VIP's purge functions,
    // and Jetpack Boost's public action. Each records the URLs it was asked to clear.
    'page-caches' => <<<'PHP'
        <?php
        function first_test_cleared(string $cache, string $url): void
        {
            $seen = get_option('test_cleared', []);
            $seen[] = "$cache $url";
            update_option('test_cleared', $seen, false);
        }
        // Batcache counts only while its drop-in runs: that is what sets $batcache.
        $GLOBALS['batcache'] = new stdClass();
        function batcache_clear_url($url) { first_test_cleared('batcache', $url); }
        function wpvip_purge_edge_cache_for_url($url) { first_test_cleared('vip', $url); }
        function wpvip_purge_edge_cache_for_site() { first_test_cleared('vip', '*'); }
        add_action('jetpack_boost_clear_page_cache_url', static fn ($url) => first_test_cleared('boost', $url));
        add_action('jetpack_boost_clear_page_cache_home', static fn () => first_test_cleared('boost', 'home'));
        PHP,
]]);
wp_set_current_user(1);
$hello = \First\db()->insert('notes', ['title' => 'Hello', 'slug' => 'hello', 'status' => 'published'], true)[0];
$other = \First\db()->insert('notes', ['title' => 'Other', 'slug' => 'other', 'status' => 'published'], true)[0];
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
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'cache' => $out['cache-control'][0] ?? null];
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

$out = [
    // Every page reads differently: home lists notes, /notes/hello reads one, /about reads nothing.
    'home' => fetch("$url/"),
    'note' => fetch("$url/notes/hello"),
    'other note' => fetch("$url/notes/other"),
    'about' => fetch("$url/about"),
    'as editor' => fetch("$url/notes/hello", [$cookie('chief')]),
    'guarded' => fetch("$url/account", [$cookie('chief')]),
    'missing' => fetch("$url/notes/nope"),
];
// Every policy Cache::policy() hands out, as Batcache reads it: a shareable page is kept for its
// window (also a filtered one), anything else for none.
foreach ([[200, true, false], [200, false, false], [200, true, true], [404, true, false], [500, true, false]] as [$status, $anonymous, $guarded]) {
    [$header, $shared] = \First\Render\Cache::policy($status, $anonymous, $guarded);
    $out['batcache'][] = [$status, $anonymous, $guarded, $shared, batcacheWindow($header)];
}
add_filter('first_app_cache_window', static fn () => 60);
$out['batcache'][] = ['window 60', batcacheWindow(\First\Render\Cache::policy(200, true, false)[0])];
remove_all_filters('first_app_cache_window');
$out['batcache served'] = array_map(static fn (string $key) => batcacheWindow($out[$key]['cache']), ['home' => 'home', 'as editor' => 'as editor', 'missing' => 'missing']);
// A count reads no rows, but what it answers changes with every write to the kind: the render
// that counts records the kind as listed, as a list would.
\First\Render\Reads::during(static fn () => \First\db()->count('notes'), $counted);
$out['count reads'] = $counted;
global $wpdb;
$out['index'] = array_map(static fn ($r) => "{$r['kind']} {$r['item']} {$r['url']}", $wpdb->get_results("SELECT kind, item, url FROM {$wpdb->prefix}first__app_reads ORDER BY url, kind, item", ARRAY_A));
// An edit to one note purges the URLs that read it and the ones that listed notes, nothing else.
delete_option('test_purges');
delete_option('test_cleared');
wp_set_current_user(1);
\First\db()->update('notes', ['title' => 'Hello again'], ['id' => (int) $hello['id']]);
wp_cache_delete('test_purges', 'options');
$out['purged'] = get_option('test_purges', []);
wp_cache_delete('test_cleared', 'options');
$out['cleared'] = str_replace($url, '', get_option('test_cleared', []));
// A whole-host purge bans the VIP site and reaches Boost's clear-all; Batcache has none.
delete_option('test_cleared');
add_action('jetpack_boost_clear_page_cache_all', static fn () => first_test_cleared('boost', '*'));
\First\Wp\PageCaches::purge(['/*']);
$out['cleared all'] = get_option('test_cleared', []);
// More paths than VIP queues in one request: one site ban for VIP, each path still for the others.
delete_option('test_cleared');
\First\Wp\PageCaches::purge(array_map(static fn (int $n): string => "/n/$n", range(1, 101)));
$cleared = get_option('test_cleared', []);
$out['cleared many'] = [count(array_filter($cleared, static fn ($c) => str_starts_with($c, 'vip '))), in_array('vip *', $cleared, true), count(array_filter($cleared, static fn ($c) => str_starts_with($c, 'batcache ')))];
// Without the drop-in ($batcache unset), Batcache's manager plugin alone is not a page cache.
unset($GLOBALS['batcache']);
delete_option('test_cleared');
\First\Wp\PageCaches::purge(['/about']);
$out['without batcache drop-in'] = str_replace($url, '', get_option('test_cleared', []));
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
