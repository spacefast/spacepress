<?php

declare(strict_types=1);

/*
 * The project's public/ folder served from wp-content/ + root symlinks + /.well-known/* PHP
 * fallback (tests/app_router.rs `public_files_serve_at_the_site_root`): tests/fixtures/public-root
 * as built, served by php -S, read over HTTP. Prints one JSON object.
 *
 *   SP_WP_THEMES=1 php tests/php/public_root.php <wp-content dir>
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
$publicRoot = $site->dir . '/public-root';
$pluginPublic = $site->content . '/plugins/spacepress-app-publicroot/public';

// A link planted in the built plugin's public/ that points out of it (the build copies a linked
// file in as a file, so only a hand edit makes one): never followed and never symlinked.
symlink(dirname(__DIR__, 2) . '/runtime/SpacePress/Wp/Plugin.php', $pluginPublic . '/linked.txt');
// A real file already present in the document root must never be overwritten by symlink sync.
file_put_contents($publicRoot . '/existing-real.txt', 'real-root-file');

// Re-sync symlinks after planting the real file and escaping symlink.
\SpacePress\Wp\PublicFiles::syncSymlinks($site->plugin());

// Packaged plugin must never contain refused files (.env, run.php) and must ship public/.htaccess.
$out['packaged'] = [
    'env' => file_exists($pluginPublic . '/.env'),
    'php' => file_exists($pluginPublic . '/nested/run.php'),
    'htaccess' => is_file($pluginPublic . '/.htaccess'),
    'indexSymlinked' => is_link($publicRoot . '/index.html'),
    'existingPreserved' => file_get_contents($publicRoot . '/existing-real.txt'),
    'logoIsSymlink' => is_link($publicRoot . '/logo.svg'),
    'logoTargetInWpContent' => is_link($publicRoot . '/logo.svg') && str_starts_with((string) readlink($publicRoot . '/logo.svg'), (string) realpath($site->content)),
];

// Direct root paths (served directly via symlinks without PHP) and /.well-known/ai.json (via PHP).
// The top-level index.html is never linked (DirectoryIndex would serve it for `/`), so PHP answers
// it at /index.html.
foreach (['/compiler.wasm', '/logo.svg', '/files/blog.json', '/files/blobs/0a1b.txt', '/files/', '/og/index.png', '/.well-known/ai.json', '/notes.md', '/robots-extra.txt', "/it's.txt", '/index.html'] as $path) {
    $r = fetch("$url$path");
    $out['served'][$path] = [$r['status'], $r['type'], strlen($r['body'])];
}

// Direct wp-content URL for public/index.html works, while `/` stays WordPress's home page.
$wpIndex = fetch("$url/wp-content/plugins/spacepress-app-publicroot/public/index.html");
$out['wpIndex'] = [$wpIndex['status'], $wpIndex['type'], strlen($wpIndex['body'])];
$out['home'] = str_contains(fetch("$url/")['body'], 'Public index');

// WordPress's own answers stay WordPress's, whatever public/ holds: robots.txt, llms.txt, feeds,
// SpacePress Identity's discovery document.
foreach (['/robots.txt', '/llms.txt', '/feed/x.txt', '/.well-known/openid-configuration'] as $path) {
    $file = (string) file_get_contents($argv[1] . '/plugins/spacepress-app-publicroot/public' . $path);
    $out['wordpress'][$path] = trim(fetch("$url$path")['body']) !== trim($file);
}

// A dynamic route at the root (`[slug]`) doesn't take a file's path.
$out['beside a dynamic route'] = fetch("$url/logo.svg")['status'];

// App page wins over public/about, and <Link> to a public/ file keeps its root URL.
$about = fetch("$url/about/");
$out['about'] = [$about['status'], str_contains($about['body'], '<h1>About</h1>'), str_contains($about['body'], 'named like a page')];
preg_match_all('#<a href="([^"]+)"[^>]*class="(file|nested|page)"#', $about['body'], $links, PREG_SET_ORDER);
$out['about links'] = [];
foreach ($links as $m) {
    $out['about links'][$m[2]] = (string) parse_url(html_entity_decode($m[1]), PHP_URL_PATH);
}

foreach (['/.env', '/nested/run.php', '/wp-json/index.json', '/wp-login.php.txt', '/files/../.env', '/files/%2e%2e/.env', '/files/..%2f.env', '/nested/', '/missing.png', '/nested/run.php.', '/nested/run.php%20', '/nested/run.php::$DATA', '/files%5c..%5c.env', '/linked.txt', '/NESTED/RUN.PHP'] as $path) {
    $r = fetch("$url$path");
    $out['refused'][$path] = [$r['status'] === 404, str_contains($r['body'], 'secret') || str_contains($r['body'], 'echo "ran"') || $r['body'] === 'ran' || $r['body'] === '{}' || $r['body'] === 'shadow' || str_contains($r['body'], 'namespace SpacePress')];
}

// HEAD has no body; /.well-known/ai.json (served via PHP) has ETag/304, Cache-Control, and CORS.
$head = fetch("$url/files/blog.json", 'HEAD');
$out['head'] = [$head['status'], $head['body'], $head['headers']['content-length'] ?? null];
$wk = fetch("$url/.well-known/ai.json");
$etag = $wk['headers']['etag'] ?? '';
$out['wellKnown'] = [
    'cache' => $wk['headers']['cache-control'] ?? null,
    'notModified' => [
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: $etag"])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: W/$etag"])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: \"other\", $etag"])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ['If-None-Match: *'])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ['If-None-Match: "other"'])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ['If-None-Match: "a,*,b"'])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: w/$etag"])['status'],
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: *, $etag"])['status'],
    ],
    'cors' => [
        fetch("$url/.well-known/ai.json", 'GET', ['Origin: https://playground.wordpress.net'])['headers']['access-control-allow-origin'] ?? null,
        fetch("$url/.well-known/ai.json", 'GET', ["If-None-Match: $etag"])['headers']['access-control-allow-origin'] ?? null,
        fetch("$url/about/")['headers']['access-control-allow-origin'] ?? null,
    ],
];
$out['post'] = fetch("$url/logo.svg", 'POST')['status'];

// Deactivation cleanup removes created symlinks and empty dirs while preserving pre-existing real files.
\SpacePress\Wp\PublicFiles::removeSymlinks();
$out['cleaned'] = [
    'logoRemoved' => !file_exists($publicRoot . '/logo.svg') && !is_link($publicRoot . '/logo.svg'),
    'filesDirRemoved' => !is_dir($publicRoot . '/files'),
    'existingStillThere' => file_get_contents($publicRoot . '/existing-real.txt'),
];

$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES), "\n";
