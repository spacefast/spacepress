<?php

declare(strict_types=1);

/*
 * Imported stylesheets and images on WordPress over HTTP (tests/app_router.rs
 * `imported_stylesheets_and_images_serve_from_the_app_plugin`): the fixture tests/fixtures/app-assets,
 * built by `typedpress build` and served by php -S. Prints one JSON object of what each page linked and
 * what each linked file holds.
 *
 *   TP_WP_THEMES=1 php tests/php/app_assets.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('assets', ['wpContent' => $argv[1]]);
$site->startServer();
$url = $site->url();

function get(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'type' => (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE), 'body' => $body];
}

$out = [];
foreach (['about', 'plain', 'colophon'] as $path) {
    $page = get("$url/$path");
    $html = new DOMDocument();
    @$html->loadHTML($page['body']);
    $xpath = new DOMXPath($html);
    $links = [];
    foreach ($xpath->query('//link[@rel="stylesheet"][starts-with(@id, "typedpress-app-")]') as $link) {
        $href = (string) $link->getAttribute('href');
        $file = get($href);
        $links[] = ['file' => basename((string) parse_url($href, PHP_URL_PATH)), 'status' => $file['status'], 'type' => $file['type'], 'css' => $file['body']];
    }
    $classes = [];
    foreach ($xpath->query('//*[@data-wp-router-region]//*[@class]') as $element) {
        $classes[$element->nodeName][] = $element->getAttribute('class');
    }
    $images = [];
    foreach ($xpath->query('//img') as $img) {
        $file = get((string) $img->getAttribute('src'));
        $images[] = ['src' => basename((string) parse_url($img->getAttribute('src'), PHP_URL_PATH)), 'status' => $file['status'], 'type' => $file['type'], 'body' => $file['body']];
    }
    $out[$path] = ['status' => $page['status'], 'links' => $links, 'classes' => $classes, 'images' => $images];
}
$out['url'] = $url;
echo json_encode($out, JSON_UNESCAPED_SLASHES);
