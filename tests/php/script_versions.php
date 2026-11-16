<?php

declare(strict_types=1);

/*
 * The script modules a page loads, and the cache header of a content-hashed client file, over HTTP
 * (tests/app_router.rs `fixed_script_modules_carry_a_build_version`). Prints one JSON object: every
 * module script and import map URL under the TypedPress plugins, by file name, with its `ver`.
 *
 *   TP_WP_THEMES=1 php tests/php/script_versions.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('script-versions', ['wpContent' => $argv[1]]);
$site->startServer();
$url = $site->url();
$body = (string) file_get_contents("$url/");
$urls = [];
preg_match_all('#src="([^"]+)"[^>]*type="module"|type="module"[^>]*src="([^"]+)"#', $body, $tags, PREG_SET_ORDER);
foreach ($tags as $tag) {
    $urls[] = html_entity_decode($tag[1] !== '' ? $tag[1] : $tag[2]);
}
if (preg_match('#<script[^>]*type="importmap"[^>]*>(.*?)</script>#s', $body, $map)) {
    foreach (json_decode($map[1], true)['imports'] ?? [] as $target) {
        $urls[] = $target;
    }
}
$out = [];
foreach ($urls as $u) {
    if (!preg_match('#/plugins/(typedpress-[a-z0-9-]+)/(.*?)(?:\?(.*))?$#', $u, $m)) {
        continue;
    }
    parse_str($m[3] ?? '', $query);
    $out[basename($m[2])] = $query['ver'] ?? null;
}
ksort($out);
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
$site->destroy();
