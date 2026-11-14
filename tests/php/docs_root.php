<?php

declare(strict_types=1);

/*
 * Docs at the site root (tests/app_router.rs `docs_at_the_site_root`): tests/fixtures/docs-root as
 * built, a hierarchical kind with `url: "/:path"`, seeded from the records a hosted compile wrote,
 * served by php -S. Prints one JSON object.
 *
 *   FIRST_WP_THEMES=1 php tests/php/docs_root.php <wp-content dir> <seed records dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('docs-root', ['wpContent' => $argv[1]]);
$out = [];
$out['seed'] = \First\Sync\Seed::run(\First\Wp\Runtime::plugin(), $argv[2]);
$site->startServer();
$url = $site->url();

function get(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HEADER => true]);
    $raw = (string) curl_exec($ch);
    $size = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    preg_match('/^location:\s*(\S+)/mi', substr($raw, 0, $size), $location);
    $body = substr($raw, $size);
    preg_match('#<h1>(.*?)</h1>#s', $body, $h1);
    return ['status' => $status, 'h1' => $h1[1] ?? null, 'location' => isset($location[1]) ? parse_url($location[1], PHP_URL_PATH) : null, 'body' => $body];
}

$page = static fn (string $path): array => array_intersect_key(get("$url$path"), ['status' => 1, 'h1' => 1, 'location' => 1]);

// The kind's items at their paths, and the app's own pages beside them.
foreach (['/', '/getting-started', '/reference', '/reference/config', '/playground', '/roadmap', '/reference/nothing', '/nothing', '/config'] as $path) {
    $out['pages'][$path] = $page($path);
}
// Links WordPress builds follow the pattern, and the tree and pager use them.
$config = get_page_by_path('reference/config', OBJECT, \First\Wp\Runtime::plugin()->schema->collection('docs')['wp']['postType']);
$out['permalink'] = parse_url((string) get_permalink($config), PHP_URL_PATH);
$doc = get("$url/getting-started")['body'];
preg_match_all('#<ul class="tree">(.*?)</ul>#s', $doc, $tree);
preg_match_all('#href="([^"]+)"#', $tree[1][0] ?? '', $links);
$out['tree'] = array_map(static fn (string $h): ?string => parse_url($h, PHP_URL_PATH), $links[1]);
preg_match('#href="([^"]+)"[^>]*rel="next"#', $doc, $next);
$out['next'] = isset($next[1]) ? parse_url($next[1], PHP_URL_PATH) : null;
// WordPress's own addresses and First's are untouched by a kind at the root.
foreach (['/wp-login.php', '/feed/', '/llms.txt', '/robots.txt', '/getting-started.md', '/reference/config.md'] as $path) {
    $out['wordpress'][$path] = get("$url$path")['status'];
}
$out['twin'] = str_contains(get("$url/reference/config.md")['body'], 'Every option.');
// A WordPress Page and post keep their own addresses: the kind takes only paths it has an item at.
wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'About', 'post_name' => 'about', 'post_content' => 'About us.']);
wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'News', 'post_name' => 'news', 'post_content' => 'News.']);
foreach (['/about/', '/news/', '/about.md', '/news.md'] as $path) {
    $r = get("$url$path");
    $out['wordpress pages'][$path] = [$r['status'], str_contains($r['body'], str_starts_with($path, '/about') ? 'About us.' : 'News.')];
}
// WordPress's sitemap lists the items at their root paths.
preg_match_all('#<loc>([^<]+)</loc>#', get("$url/wp-sitemap-first-docs-1.xml")['body'], $locs);
$out['sitemap'] = array_map(static fn (string $u): ?string => parse_url($u, PHP_URL_PATH), $locs[1]);

$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
