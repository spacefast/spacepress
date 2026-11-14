<?php

declare(strict_types=1);

/*
 * `php -S` router for a WpSite (tests/php/wp.php): what the production web server does for First.
 * Static files are served from the site; `/wp-content/uploads/first-private/` is denied (the
 * private-files probe checks exactly that); `/wp-json/...` becomes a `rest_route` request; and
 * everything else runs WordPress's index.php. FIRST_TEST_SITE names the site directory.
 */

$dir = getenv('FIRST_TEST_SITE') ?: throw new RuntimeException('FIRST_TEST_SITE is not set');
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
$core = $site['core'];
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/__first_site') {
    // Which site answers here: the harness checks this before trusting the port.
    header('Content-Type: text/plain');
    echo $dir;
    exit;
}
if (str_starts_with($path, '/wp-content/uploads/first-private/')) {
    http_response_code(403);
    exit;
}
// Static files, from the site's wp-content or from core, with the types a browser needs (a module
// script must be JavaScript; mime_content_type() calls a .js file text/plain).
$static = match (true) {
    str_starts_with($path, '/wp-content/') => "$dir/content/" . substr($path, strlen('/wp-content/')),
    $path !== '/' => $core . $path,
    default => null,
};
if ($static !== null && !str_ends_with($path, '.php') && !str_contains($path, '..') && is_file($static)) {
    $type = match (strtolower(pathinfo($static, PATHINFO_EXTENSION))) {
        'js', 'mjs' => 'text/javascript',
        'css' => 'text/css',
        'json' => 'application/json',
        'svg' => 'image/svg+xml',
        default => mime_content_type($static) ?: 'application/octet-stream',
    };
    header('Content-Type: ' . $type);
    readfile($static);
    exit;
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
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = "/$file";
    $_SERVER['SCRIPT_FILENAME'] = "$root/$file";
    chdir(dirname("$root/$file"));
    require "$root/$file";
    exit;
}
if (preg_match('#^/wp-json(/.*)?$#', $path, $m) === 1) {
    $_GET['rest_route'] = ($m[1] ?? '') === '' ? '/' : $m[1];
}
// Core's comment form handler is a script of its own, as on any web server. The shared core has no
// wp-config.php for its wp-load.php to find, so the site's settings load first and the script runs
// with them already in place (wp-load.php skips its own setup once ABSPATH's settings have run).
if ($path === '/wp-comments-post.php') {
    $_SERVER['SCRIPT_NAME'] = $_SERVER['PHP_SELF'] = $path;
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
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = "$core/index.php";
// What index.php → wp-blog-header.php does, with the site's constants in place of a wp-config.php.
require __DIR__ . '/wp.php';
wpDefine($dir, $site['url']);
chdir($core);
require "$core/wp-settings.php";
wp();
require ABSPATH . WPINC . '/template-loader.php';
