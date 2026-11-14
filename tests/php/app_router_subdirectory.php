<?php

declare(strict_types=1);

/*
 * `first/app/` on a WordPress that lives in a subdirectory (tests/app_router.rs
 * `app_router_serves_item_pages_under_a_subdirectory`): examples/full-site, built by `first build`,
 * served under `/blog` as WordPress Playground serves every site under `/scope:<id>/`. A note's
 * page (`url: "/notes/:slug"`) must answer at its own URL there too. Prints one JSON object:
 * label => [status, <h1>].
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_router_subdirectory.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-subdir', ['wpContent' => $argv[1], 'base' => '/blog']);
wp_set_current_user(1);
\First\db()->insert('notes', ['title' => 'Dawn on the ridge', 'slug' => 'dawn-on-the-ridge', 'status' => 'published']);
\First\db()->insert('notes', ['title' => 'Notes for next week', 'slug' => 'notes-for-next-week', 'status' => 'draft']);
$note = get_page_by_path('dawn-on-the-ridge', OBJECT, 'first_notes');
$link = $note instanceof WP_Post ? get_permalink($note) : null;
$site->actAs(null);
$site->startServer();
$url = $site->url();

$get = static function (string $path) use ($url): array {
    $ch = curl_init($url . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    preg_match('#<h1[^>]*>(.*?)</h1>#s', $body, $h);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), html_entity_decode(trim(strip_tags($h[1] ?? '')), ENT_QUOTES)];
};
echo json_encode([
    'url' => $url,
    'link' => $link,
    'notes' => $get('/notes/'),
    'note' => $get('/notes/dawn-on-the-ridge'),
    'note slash' => $get('/notes/dawn-on-the-ridge/'),
    'draft' => $get('/notes/notes-for-next-week'),
    'missing' => $get('/notes/nope'),
    'about' => $get('/about'),
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
