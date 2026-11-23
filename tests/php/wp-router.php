<?php

declare(strict_types=1);

/*
 * `php -S` router for a WpSite (tests/php/wp.php): what the production web server does for SpacePress.
 * Static files are served from the site; `/wp-content/uploads/spacepress-private/` is denied (the
 * private-files probe checks exactly that); and everything else runs WordPress's index.php, which
 * parses `/wp-json/...` itself, as behind a real web server. SP_TEST_SITE names the site directory.
 */

$dir = getenv('SP_TEST_SITE') ?: throw new RuntimeException('SP_TEST_SITE is not set');
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
$core = $site['core'];
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/__sp_site') {
    // Which site answers here: the harness checks this before trusting the port.
    header('Content-Type: text/plain');
    echo $dir;
    exit;
}
// A site in a subdirectory (`base`) answers only below it, and the rules below read the path
// inside it. REQUEST_URI keeps the full path, as a web server passes it to WordPress.
$base = (string) ($site['base'] ?? '');
if ($base !== '') {
    if ($path !== $base && !str_starts_with($path, "$base/")) {
        http_response_code(404);
        exit;
    }
    $path = substr($path, strlen($base)) ?: '/';
}
if (str_starts_with($path, '/wp-content/uploads/spacepress-private/')) {
    http_response_code(403);
    exit;
}
// Static files, from the site's wp-content, its synced root public symlinks, or core, with the
// types a browser needs (a module script must be JavaScript; mime_content_type() calls .js text/plain).
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$decoded = rawurldecode($path);
$serveStatic = static function (string $file) use ($method): never {
    $type = match (strtolower(pathinfo($file, PATHINFO_EXTENSION))) {
        'js', 'mjs' => 'text/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'html', 'htm' => 'text/html; charset=utf-8',
        'json' => 'application/json',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'avif' => 'image/avif',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
        'otf' => 'font/otf',
        'mp4' => 'video/mp4',
        'webm' => 'video/webm',
        'mp3' => 'audio/mpeg',
        'pdf' => 'application/pdf',
        'wasm' => 'application/wasm',
        'md' => 'text/markdown; charset=utf-8',
        'txt' => 'text/plain; charset=utf-8',
        default => mime_content_type($file) ?: 'application/octet-stream',
    };
    header('Content-Type: ' . $type);
    header('Content-Length: ' . (string) filesize($file));
    if ($method !== 'HEAD') {
        readfile($file);
    }
    exit;
};
$safeStatic = static function (string $candidate, array $roots): ?string {
    if (str_contains($candidate, "\0") || str_contains($candidate, '..')) {
        return null;
    }
    if (is_dir($candidate) && is_file("$candidate/index.html")) {
        $candidate = "$candidate/index.html";
    }
    if (!is_file($candidate)) {
        return null;
    }
    $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
    if (in_array($ext, ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'htaccess', 'htpasswd', 'ini'], true)) {
        return null;
    }
    $real = realpath($candidate);
    if ($real === false) {
        return null;
    }
    foreach ($roots as $root) {
        $top = realpath($root);
        if ($top !== false && str_starts_with($real, $top . DIRECTORY_SEPARATOR)) {
            return $real;
        }
    }
    return null;
};
if (($method === 'GET' || $method === 'HEAD') && !str_contains($decoded, '..') && !str_contains($decoded, '\\')) {
    if (str_starts_with($decoded, '/wp-content/')) {
        $found = $safeStatic("$dir/content/" . substr($decoded, strlen('/wp-content/')), ["$dir/content"]);
        if ($found !== null) {
            $serveStatic($found);
        }
    } elseif ($decoded !== '/') {
        $publicRoot = "$dir/public-root";
        if (is_dir($publicRoot)) {
            $found = $safeStatic($publicRoot . $decoded, ["$dir/content", $publicRoot]);
            if ($found !== null) {
                $serveStatic($found);
            }
        }
        $found = $safeStatic($core . $decoded, [$core]);
        if ($found !== null) {
            $serveStatic($found);
        }
    }
}
// wp-login.php and wp-admin's screens run as their own files, as a web server runs them: they boot
// through wp-load.php, which needs a wp-config.php, so they run from the site's WP-CLI root (core
// linked in, with a wp-config.php that defines this site).
if (preg_match('#^/(wp-login\.php|wp-admin/(?:[a-z0-9-]+\.php)?)$#', $path, $m) === 1) {
    require __DIR__ . '/wp.php';
    $root = wpCliRoot($dir);
    $file = $m[1] === 'wp-admin/' ? 'wp-admin/index.php' : $m[1];
    define('ABSPATH', "$root/");
    // Each script and stylesheet on its own URL, so a browser test's failed request names the file.
    define('CONCATENATE_SCRIPTS', false);
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = "$base/$file";
    $_SERVER['SCRIPT_FILENAME'] = "$root/$file";
    chdir(dirname("$root/$file"));
    require "$root/$file";
    exit;
}
// Core's comment form handler is a script of its own, as on any web server. The shared core has no
// wp-config.php for its wp-load.php to find, so the site's settings load first and the script runs
// with them already in place (wp-load.php skips its own setup once ABSPATH's settings have run).
if ($path === '/wp-comments-post.php') {
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $base . $path;
    $_SERVER['SCRIPT_FILENAME'] = "$core/wp-comments-post.php";
    require __DIR__ . '/wp.php';
    wpDefine($dir, $site['url']);
    chdir($core);
    require "$core/wp-settings.php";
    $script = (string) file_get_contents("$core/wp-comments-post.php");
    // The same file, minus its own `require wp-load.php` (done above).
    eval('?>' . str_replace("require __DIR__ . '/wp-load.php';", '', $script));
    exit;
}
$_SERVER['SCRIPT_NAME'] = "$base/index.php";
$_SERVER['PHP_SELF'] = "$base/index.php";
$_SERVER['SCRIPT_FILENAME'] = "$core/index.php";
// What index.php → wp-blog-header.php does, with the site's constants in place of a wp-config.php.
require __DIR__ . '/wp.php';
wpDefine($dir, $site['url']);
chdir($core);
require "$core/wp-settings.php";
wp();
require ABSPATH . WPINC . '/template-loader.php';
