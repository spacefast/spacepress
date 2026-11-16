<?php

declare(strict_types=1);

/*
 * The project's public/ folder at the site root (tests/app_router.rs
 * `public_files_serve_at_the_site_root`): tests/fixtures/public-root as built, served by php -S,
 * read over HTTP. Prints one JSON object: status, type and body per path.
 *
 *   TP_WP_THEMES=1 php tests/php/public_root.php <wp-content dir>
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
        // As sent: curl would otherwise remove `..` before the server sees it.
        CURLOPT_PATH_AS_IS => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_HTTPHEADER => $headers,
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
// A link planted in the built plugin's public/ that points out of it (the build copies a linked
// file in as a file, so only a hand edit makes one): never followed.
symlink(dirname(__DIR__, 2) . '/runtime/TypedPress/Wp/Plugin.php', $argv[1] . '/plugins/typedpress-app-publicroot/public/linked.txt');
foreach (['/compiler.wasm', '/logo.svg', '/files/blog.json', '/files/blobs/0a1b.txt', '/files/', '/og/index.png', '/.well-known/ai.json', '/notes.md', '/robots-extra.txt', '/index.html', "/it's.txt"] as $path) {
    $r = fetch("$url$path");
    $out['served'][$path] = [$r['status'], $r['type'], strlen($r['body'])];
}
// The app's own page wins over a file of the same name; dotfiles, PHP, WordPress's paths and
// paths that leave the folder are never served from it.
// The home page stays WordPress's: a public/index.html answers at /index.html, not at /.
$out['home'] = str_contains(fetch("$url/")['body'], 'Public index');
// WordPress's own answers stay WordPress's, whatever public/ holds: robots.txt, llms.txt, feeds,
// TypedPress Identity's discovery document.
foreach (['/robots.txt', '/llms.txt', '/feed/x.txt', '/.well-known/openid-configuration'] as $path) {
    $file = (string) file_get_contents($argv[1] . '/plugins/typedpress-app-publicroot/public' . $path);
    $out['wordpress'][$path] = trim(fetch("$url$path")['body']) !== trim($file);
}
// A dynamic route at the root (`[slug]`) doesn't take a file's path.
$out['beside a dynamic route'] = fetch("$url/logo.svg")['status'];
$about = fetch("$url/about/");
$out['about'] = [$about['status'], str_contains($about['body'], '<h1>About</h1>'), str_contains($about['body'], 'named like a page')];
preg_match_all('#<a href="([^"]+)"[^>]*class="(file|nested|page)"#', $about['body'], $links, PREG_SET_ORDER);
$out['about links'] = array_column(array_map(static fn (array $m): array => [$m[2], (string) parse_url($m[1], PHP_URL_PATH)], $links), 1, 0);
foreach (['/.env', '/nested/run.php', '/wp-json/index.json', '/wp-login.php.txt', '/files/../.env', '/files/%2e%2e/.env', '/files/..%2f.env', '/nested/', '/missing.png', '/nested/run.php.', '/nested/run.php%20', '/nested/run.php::$DATA', '/files%5c..%5c.env', '/linked.txt', '/NESTED/RUN.PHP'] as $path) {
    $r = fetch("$url$path");
    // Never the file's bytes: the dotfile's text, the PHP source, or what running it prints.
    $out['refused'][$path] = [$r['status'] === 404, str_contains($r['body'], 'secret') || str_contains($r['body'], 'echo "ran"') || $r['body'] === 'ran' || $r['body'] === '{}' || $r['body'] === 'shadow' || str_contains($r['body'], 'namespace TypedPress')];
}
// HEAD has no body; a matching ETag is a 304; an SVG opened alone runs no script.
$head = fetch("$url/files/blog.json", 'HEAD');
$out['head'] = [$head['status'], $head['body'], $head['headers']['content-length'] ?? null];
$etag = fetch("$url/logo.svg")['headers']['etag'] ?? '';
$out['not modified'] = [
    fetch("$url/logo.svg", 'GET', ["If-None-Match: $etag"])['status'],
    fetch("$url/logo.svg", 'GET', ["If-None-Match: W/$etag"])['status'],
    fetch("$url/logo.svg", 'GET', ["If-None-Match: \"other\", $etag"])['status'],
    fetch("$url/logo.svg", 'GET', ['If-None-Match: "other"'])['status'],
];
$out['svg policy'] = str_contains(fetch("$url/logo.svg")['headers']['content-security-policy'] ?? '', 'sandbox');
$out['cache'] = fetch("$url/compiler.wasm")['headers']['cache-control'] ?? null;
// Another site's page may read a public file, as it sends it (an Origin header), and a 304 says so too.
$out['other origins'] = [
    fetch("$url/files/blog.json", 'GET', ['Origin: https://playground.wordpress.net'])['headers']['access-control-allow-origin'] ?? null,
    fetch("$url/logo.svg", 'GET', ["If-None-Match: $etag"])['headers']['access-control-allow-origin'] ?? null,
    // Not the app's pages: only files.
    fetch("$url/about/")['headers']['access-control-allow-origin'] ?? null,
];
$out['post'] = fetch("$url/logo.svg", 'POST')['status'];

$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
