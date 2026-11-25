<?php

declare(strict_types=1);

/*
 * Imported stylesheets and images on WordPress over HTTP (tests/app_router.rs
 * `imported_stylesheets_and_images_serve_from_the_app_plugin`): the fixture tests/fixtures/app-assets,
 * built by `spacepress build` and served by php -S. Prints one JSON object of what each page linked and
 * what each linked file holds.
 *
 *   SP_WP_THEMES=1 php tests/php/app_assets.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('assets', ['wpContent' => $argv[1], 'muPlugins' => [
    'late-theme-style' => <<<'PHP'
        <?php
        add_action('wp_head', static function (): void {
            wp_register_style('late-theme', false, [], null);
            wp_enqueue_style('late-theme');
            wp_add_inline_style('late-theme', '.site { color: #123456; }');
        }, 5);
        add_filter('wp_get_custom_css', static fn (string $css): string => $css . '.owner-style { color: #654321; }');
        add_action('wp_head', static function (): void {
            wp_register_style('owner-override', false, [], null);
            wp_add_inline_style('owner-override', '.site { color: #654321; }');
            wp_print_styles(['owner-override']);
        }, 20);
        PHP,
]]);
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
    $page = get("$url/$path/");
    $html = new DOMDocument();
    @$html->loadHTML($page['body']);
    $xpath = new DOMXPath($html);
    $styleOrder = [];
    foreach ($xpath->query('//style[@id="global-styles-inline-css" or @id="late-theme-inline-css" or @id="owner-override-inline-css"] | //link[@rel="stylesheet"][starts-with(@id, "spacepress-app-")] | //style[starts-with(@id, "spacepress-app-")]') as $style) {
        $styleOrder[] = $style->getAttribute('id');
    }
    $links = [];
    foreach ($xpath->query('//link[@rel="stylesheet"][starts-with(@id, "spacepress-app-")] | //style[starts-with(@id, "spacepress-app-")]') as $node) {
        if ($node->nodeName === 'link') {
            $href = (string) $node->getAttribute('href');
            $file = get($href);
            $links[] = ['file' => basename((string) parse_url($href, PHP_URL_PATH)), 'inline' => false, 'status' => $file['status'], 'type' => $file['type'], 'css' => $file['body']];
        } else {
            $id = (string) $node->getAttribute('id');
            // spacepress-app-<stem>-<hash>-css-inline-css -> <stem>-<hash>.css
            $stem = preg_replace('/^spacepress-app-|-css-inline-css$/', '', $id);
            $css = (string) preg_replace('/\s*\/\*#\s*sourceURL=[^*]+\*\/\s*$/', '', trim($node->textContent));
            $links[] = ['file' => $stem . '.css', 'inline' => true, 'status' => 200, 'type' => 'text/css', 'css' => $css];
        }
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
    $out[$path] = ['status' => $page['status'], 'links' => $links, 'styleOrder' => $styleOrder, 'ownerCss' => str_contains($page['body'], '.owner-style { color: #654321; }'), 'classes' => $classes, 'images' => $images];
}
$out['url'] = $url;
echo json_encode($out, JSON_UNESCAPED_SLASHES);
