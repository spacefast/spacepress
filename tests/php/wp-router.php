<?php

declare(strict_types=1);

/*
 * `php -S` router for a WpSite (tests/php/wp.php): what the production web server does for Zero.
 * Static files are served from the site; `/wp-content/uploads/zero-private/` is denied (the
 * private-files probe checks exactly that); `/wp-json/...` becomes a `rest_route` request; and
 * everything else runs WordPress's index.php. ZERO_TEST_SITE names the site directory.
 */

$dir = getenv('ZERO_TEST_SITE') ?: throw new RuntimeException('ZERO_TEST_SITE is not set');
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
$core = $site['core'];
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/__zero_site') {
    // Which site answers here: the harness checks this before trusting the port.
    header('Content-Type: text/plain');
    echo $dir;
    exit;
}
if (str_starts_with($path, '/wp-content/uploads/zero-private/')) {
    http_response_code(403);
    exit;
}
if (str_starts_with($path, '/wp-content/') && !str_ends_with($path, '.php') && is_file("$dir/content/" . substr($path, strlen('/wp-content/')))) {
    $file = "$dir/content/" . substr($path, strlen('/wp-content/'));
    header('Content-Type: ' . (mime_content_type($file) ?: 'application/octet-stream'));
    readfile($file);
    exit;
}
if ($path !== '/' && !str_ends_with($path, '.php') && is_file($core . $path)) {
    return false;
}
if (preg_match('#^/wp-json(/.*)?$#', $path, $m) === 1) {
    $_GET['rest_route'] = ($m[1] ?? '') === '' ? '/' : $m[1];
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
