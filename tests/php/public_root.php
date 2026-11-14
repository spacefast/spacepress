<?php

declare(strict_types=1);

/*
 * The project's public/ folder at the site root (tests/app_router.rs
 * `public_files_serve_at_the_site_root`): tests/fixtures/public-root as built, served by php -S,
 * read over HTTP. Prints one JSON object: status, type and body per path.
 *
 *   FIRST_WP_THEMES=1 php tests/php/public_root.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('public-root', ['wpContent' => $argv[1]]);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = []): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $body = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'type' => $out['content-type'] ?? null, 'body' => $body, 'headers' => $out];
}

$out = [];
foreach (['/compiler.wasm', '/logo.svg', '/files/blog.json', '/files/blobs/0a1b.txt', '/files/', '/og/index.png', '/.well-known/ai.json', '/notes.md', '/robots-extra.txt', '/index.html'] as $path) {
    $r = fetch("$url$path");
    $out['served'][$path] = [$r['status'], $r['type'], strlen($r['body'])];
}
// The app's own page wins over a file of the same name; dotfiles, PHP, WordPress's paths and
// paths that leave the folder are never served from it.
// The home page stays WordPress's: a public/index.html answers at /index.html, not at /.
$out['home'] = str_contains(fetch("$url/")['body'], 'Public index');
$about = fetch("$url/about");
$out['about'] = [$about['status'], str_contains($about['body'], '<h1>About</h1>'), str_contains($about['body'], 'named like a page')];
foreach (['/.env', '/nested/run.php', '/wp-json/index.json', '/wp-login.php.txt', '/files/../.env', '/files/%2e%2e/.env', '/files/..%2f.env', '/nested/', '/missing.png'] as $path) {
    $r = fetch("$url$path");
    // Never the file's bytes: the dotfile's text, the PHP source, or what running it prints.
    $out['refused'][$path] = [$r['status'], str_contains($r['body'], 'secret') || str_contains($r['body'], 'echo "ran"') || $r['body'] === 'ran' || $r['body'] === '{}' || $r['body'] === 'shadow'];
}
// HEAD has no body; a matching ETag is a 304; an SVG opened alone runs no script.
$head = fetch("$url/files/blog.json", 'HEAD');
$out['head'] = [$head['status'], $head['body'], $head['headers']['content-length'] ?? null];
$etag = fetch("$url/logo.svg")['headers']['etag'] ?? '';
$out['not modified'] = fetch("$url/logo.svg", 'GET', ["If-None-Match: $etag"])['status'];
$out['svg policy'] = str_contains(fetch("$url/logo.svg")['headers']['content-security-policy'] ?? '', 'sandbox');
$out['cache'] = fetch("$url/compiler.wasm")['headers']['cache-control'] ?? null;
$out['post'] = fetch("$url/logo.svg", 'POST')['status'];

$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
