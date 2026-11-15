<?php

declare(strict_types=1);

/*
 * Imported stylesheets and images on WordPress over HTTP (tests/app_router.rs
 * `imported_stylesheets_and_images_serve_from_the_app_plugin`): the fixture tests/fixtures/app-assets,
 * built by `first build` and served by php -S. Prints one JSON object of what each page linked and
 * what each linked file holds, and every stylesheet of each page in the order the document has
 * them, under a block theme that styles elements and enqueues a stylesheet of its own
 * (tests/fixtures/theme-loud).
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_assets.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('assets', ['wpContent' => $argv[1]]);
wpCopy(__DIR__ . '/../fixtures/theme-loud', "$site->content/themes/loud");
wp_clean_themes_cache();
switch_theme('loud');
$site->startServer();
$url = $site->url();

function get(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'type' => (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE), 'body' => $body];
}

/**
 * The stylesheets under `$scope` in document order: each `<style>` with its id and text, each
 * `<link rel="stylesheet">` with its id and URL.
 */
function sheets(DOMXPath $xpath, string $scope): array
{
    $sheets = [];
    foreach ($xpath->query("//{$scope}//style | //{$scope}//link[@rel=\"stylesheet\"]") as $el) {
        $sheets[] = ['id' => $el->getAttribute('id'), 'href' => $el->getAttribute('href'), 'css' => $el->textContent];
    }
    return $sheets;
}

$out = [];
// `hello-world` is the post WordPress installs with: no route serves it, so the theme renders it.
foreach (['about', 'plain', 'colophon', 'blocks', 'hello-world/'] as $path) {
    $page = get("$url/$path");
    $html = new DOMDocument();
    @$html->loadHTML($page['body']);
    $xpath = new DOMXPath($html);
    $links = [];
    foreach ($xpath->query('//link[@rel="stylesheet"][starts-with(@id, "first-app-")]') as $link) {
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
    $out[$path] = ['status' => $page['status'], 'links' => $links, 'classes' => $classes, 'images' => $images, 'head' => sheets($xpath, 'head'), 'body' => sheets($xpath, 'body')];
}
// With no installed theme active, WordPress renders with First's own (Hardening::blockTheme).
update_option('template', 'gone-theme');
update_option('stylesheet', 'gone-theme');
$page = get("$url/plain");
$html = new DOMDocument();
@$html->loadHTML($page['body']);
$out['fallback'] = ['status' => $page['status'], 'head' => sheets(new DOMXPath($html), 'head')];
$out['url'] = $url;
echo json_encode($out, JSON_UNESCAPED_SLASHES);
