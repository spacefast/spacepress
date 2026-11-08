<?php
/**
 * Test-only host for tests/wp/store-run.sh: selects one stored build per request, the way a host
 * with immutable versions does. HTTP names the build in X-Zero-Build and is served only once that
 * build initialized; WP-CLI names it with ZERO_TEST_BUILD (`wp --exec=...`) to initialize or collect.
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

(static function (): void {
    $root = WP_CONTENT_DIR . '/plugins/zero-store';
    $build = defined('ZERO_TEST_BUILD') ? (string) ZERO_TEST_BUILD : ($_SERVER['HTTP_X_ZERO_BUILD'] ?? null);
    if (!is_string($build) || preg_match('/\A[0-9a-f]{64}\z/D', $build) !== 1 || !is_file("$root/build/$build.json")) {
        return;
    }
    $manifest = json_decode((string) file_get_contents("$root/build/$build.json"), true);
    define('ZERO_BUILD_HOST', true);
    require_once "$root/runtime/{$manifest['runtime']}/zero-loader.php";
    if (!defined('ZERO_TEST_BUILD') && \Zero\Loader\Store::receipt($root, $build) === null) {
        return;
    }
    \Zero\Loader\Loader::load($root, $build, ['variables' => [], 'url' => content_url('plugins/zero-store')]);
})();
