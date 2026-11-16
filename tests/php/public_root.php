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

$site = wpSite('public-root', ['wpContent' => $argv[1], 'muPlugins' => [
    // Says on the response that WordPress reached `init`: an answer without it was sent before.
    'reached-init' => <<<'PHP'
        <?php
        add_action('init', static function (): void {
            header('X-Test-Init: 1');
        }, PHP_INT_MIN);
        PHP,
    // Stands in for the engine's `Accept: text/markdown` lane (docs/runtime-contract.md): after
    // wp-load.php it calls negotiate() and sends what it returns.
    'engine-accept-lane' => <<<'PHP'
        <?php
        add_action('wp_loaded', static function (): void {
            if (str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'text/markdown') && isset($_SERVER['HTTP_X_TEST_ENGINE'])) {
                $answer = \First\Wp\MarkdownTwins::negotiate((string) $_SERVER['REQUEST_URI']);
                if ($answer !== null) {
                    status_header($answer['status']);
                    foreach ($answer['headers'] as $name => $value) {
                        header("$name: $value");
                    }
                    echo $answer['body'];
                    exit;
                }
            }
        });
        PHP,
]]);
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
symlink(dirname(__DIR__, 2) . '/runtime/First/Wp/Plugin.php', $argv[1] . '/plugins/first-app-publicroot/public/linked.txt');
foreach (['/compiler.wasm', '/logo.svg', '/files/blog.json', '/files/blobs/0a1b.txt', '/files/', '/og/index.png', '/.well-known/ai.json', '/notes.md', '/robots-extra.txt', '/index.html', "/it's.txt"] as $path) {
    $r = fetch("$url$path");
    $out['served'][$path] = [$r['status'], $r['type'], strlen($r['body'])];
}
// The app's own page wins over a file of the same name; dotfiles, PHP, WordPress's paths and
// paths that leave the folder are never served from it.
// The home page stays WordPress's: a public/index.html answers at /index.html, not at /.
$out['home'] = str_contains(fetch("$url/")['body'], 'Public index');
// WordPress's own answers stay WordPress's, whatever public/ holds: robots.txt, llms.txt, feeds,
// First Identity's discovery document.
foreach (['/robots.txt', '/llms.txt', '/feed/x.txt', '/.well-known/openid-configuration'] as $path) {
    $file = (string) file_get_contents($argv[1] . '/plugins/first-app-publicroot/public' . $path);
    $out['wordpress'][$path] = trim(fetch("$url$path")['body']) !== trim($file);
}
// A dynamic route at the root (`[slug]`) doesn't take a file's path.
$out['beside a dynamic route'] = fetch("$url/logo.svg")['status'];
$about = fetch("$url/about");
$out['about'] = [$about['status'], str_contains($about['body'], '<h1>About</h1>'), str_contains($about['body'], 'named like a page')];
foreach (['/.env', '/nested/run.php', '/wp-json/index.json', '/wp-login.php.txt', '/files/../.env', '/files/%2e%2e/.env', '/files/..%2f.env', '/nested/', '/missing.png', '/nested/run.php.', '/nested/run.php%20', '/nested/run.php::$DATA', '/files%5c..%5c.env', '/linked.txt', '/NESTED/RUN.PHP', '/lo\\go.svg'] as $path) {
    $r = fetch("$url$path");
    // Never the file's bytes: the dotfile's text, the PHP source, or what running it prints.
    $out['refused'][$path] = [$r['status'] === 404, str_contains($r['body'], 'secret') || str_contains($r['body'], 'echo "ran"') || $r['body'] === 'ran' || $r['body'] === '{}' || $r['body'] === 'shadow' || str_contains($r['body'], 'namespace First')];
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
// A file is answered before WordPress initializes (no `init`), on a 200, a 304 and a HEAD alike; a
// page is not.
$reached = static fn (array $r): ?string => $r['headers']['x-test-init'] ?? null;
$out['before init'] = [
    $reached(fetch("$url/logo.svg")),
    $reached(fetch("$url/logo.svg", 'GET', ["If-None-Match: $etag"])),
    $reached(fetch("$url/files/blog.json", 'HEAD')),
    $reached(fetch("$url/files/")),
    $reached(fetch("$url/about")),
];
// A request that asks for Markdown waits for the request to be parsed, where an engine's
// negotiation is known: without one the file answers as before, and a negotiation is never
// answered with the file.
$asked = fetch("$url/notes.md", 'GET', ['Accept: text/markdown']);
$negotiated = fetch("$url/notes.md", 'GET', ['Accept: text/markdown', 'X-Test-Engine: 1']);
$out['asks for markdown'] = [$asked['status'], $asked['type'], $asked['body'], $reached($asked)];
$out['negotiated'] = [$negotiated['status'], $negotiated['body'] === $asked['body'], $negotiated['headers']['cache-control'] ?? null];
// Any origin may read any public file, whatever its type, and the answer says so the same way
// whether or not the request names an origin (so a shared cache's copy serves both), on a 200, a
// 304 and a HEAD. Nothing varies on the origin. A page says nothing of the kind.
$allow = static fn (array $r): ?string => $r['headers']['access-control-allow-origin'] ?? null;
$origin = 'Origin: https://playground.wordpress.net';
$out['other origins'] = [
    'named' => $allow(fetch("$url/files/blog.json", 'GET', [$origin])),
    'unnamed' => $allow(fetch("$url/files/blog.json")),
    'not modified' => $allow(fetch("$url/logo.svg", 'GET', [$origin, "If-None-Match: $etag"])),
    'head' => $allow(fetch("$url/compiler.wasm", 'HEAD', [$origin])),
    'html' => $allow(fetch("$url/files/", 'GET', [$origin])),
    'markdown' => $allow(fetch("$url/notes.md", 'GET', [$origin])),
    'svg' => $allow(fetch("$url/logo.svg", 'GET', [$origin])),
    'asks for markdown' => $allow($asked),
    'vary' => fetch("$url/files/blog.json", 'GET', [$origin])['headers']['vary'] ?? null,
    'page' => $allow(fetch("$url/about", 'GET', [$origin])),
    // No preflight is answered: every read a public file is for is a plain GET.
    'preflight' => $allow(fetch("$url/files/blog.json", 'OPTIONS', [$origin, 'Access-Control-Request-Method: GET', 'Access-Control-Request-Headers: if-none-match'])),
];
// A Range request gets the whole file, as HTTP allows a server without ranges to answer.
$range = fetch("$url/files/blog.json", 'GET', [$origin, 'Range: bytes=0-3']);
$out['range'] = [$range['status'], strlen($range['body']), $allow($range), $range['headers']['content-range'] ?? null];
$out['post'] = fetch("$url/logo.svg", 'POST')['status'];

$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
