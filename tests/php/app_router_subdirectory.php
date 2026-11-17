<?php

declare(strict_types=1);

/*
 * `tp/app/` on a WordPress that lives in a subdirectory (tests/app_router.rs
 * `app_router_serves_item_pages_under_a_subdirectory`): examples/full-site, built by `typedpress build`,
 * served under `/blog` as WordPress Playground serves every site under `/scope:<id>/`. A note's
 * page (`url: "/notes/:slug"`) must answer at its own URL there too. Prints one JSON object:
 * label => [status, <h1>].
 *
 *   TP_WP_THEMES=1 php tests/php/app_router_subdirectory.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-subdir', ['wpContent' => $argv[1], 'base' => '/blog']);
wp_set_current_user(1);
\TypedPress\db()->insert('notes', ['title' => 'Dawn on the ridge', 'slug' => 'dawn-on-the-ridge', 'status' => 'published']);
\TypedPress\db()->insert('notes', ['title' => 'Notes for next week', 'slug' => 'notes-for-next-week', 'status' => 'draft']);
$note = get_page_by_path('dawn-on-the-ridge', OBJECT, 'tp_notes');
$link = $note instanceof WP_Post ? get_permalink($note) : null;
$site->actAs(null);
$site->startServer();
$url = $site->url();

$get = static function (string $path) use ($url): array {
    $ch = curl_init($url . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    preg_match('#<h1[^>]*>(.*?)</h1>#s', $body, $h);
    $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: null;
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $location ?? html_entity_decode(trim(strip_tags($h[1] ?? '')), ENT_QUOTES)];
};
$links = [];
foreach ([
    'path' => '/notes/dawn-on-the-ridge?q=tea%20time#body',
    'absolute' => "$url/notes/dawn-on-the-ridge?q=tea%20time#body",
    'home' => $url,
    'file' => '/logo.svg?size=2#image',
    'reserved' => '/wp-login.php?redirect_to=%2Fnotes#login',
    'external' => 'https://example.test/notes?q=tea#body',
    'protocol relative' => '//example.test/notes',
    'outside home' => substr($url, 0, -strlen('/blog')) . '/blogger/notes',
    'fragment' => '#body',
    'query' => '?q=tea#body',
] as $name => $href) {
    $html = new DOMDocument();
    @$html->loadHTML(\TypedPress\Render\Markup::link(['href' => $href, 'prefetch' => true], 'Link')->html());
    $a = $html->getElementsByTagName('a')->item(0);
    $links[$name] = ['href' => $a->getAttribute('href'), 'template' => $a->getAttribute('data-tp-template'), 'prefetch' => $a->getAttribute('data-wp-on--mouseenter')];
}
$trailing = $GLOBALS['wp_rewrite']->use_trailing_slashes;
$GLOBALS['wp_rewrite']->use_trailing_slashes = false;
$html = new DOMDocument();
@$html->loadHTML(\TypedPress\Render\Markup::link(['href' => '/notes/dawn-on-the-ridge/?q=tea#body'], 'Link')->html());
$links['without slash'] = $html->getElementsByTagName('a')->item(0)->getAttribute('href');
$GLOBALS['wp_rewrite']->use_trailing_slashes = $trailing;
echo json_encode([
    'url' => $url,
    'link' => $link,
    'notes' => $get('/notes/'),
    'note' => $get('/notes/dawn-on-the-ridge/'),
    // The bare spelling redirects to the one address, under the subdirectory too (#462).
    'note bare' => $get('/notes/dawn-on-the-ridge'),
    'draft' => $get('/notes/notes-for-next-week/'),
    'missing' => $get('/notes/nope/'),
    'about' => $get('/about/'),
    'dotted' => $get('/release.v1/'),
    'dotted bare' => $get('/release.v1'),
    'links' => $links,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
