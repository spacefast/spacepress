<?php
/**
 * Test-only host for tests/wp/store-run.sh: selects one stored build per request, the way a host
 * with immutable versions does, with TypedPress Identity mounted (`users`). HTTP names the build in
 * X-TypedPress-Build and is served only once that
 * build initialized; WP-CLI names it with TP_TEST_BUILD (`wp --exec=...`) to initialize or collect,
 * and adds TP_TEST_INSPECT to mount it for inspection.
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

(static function (): void {
    $root = WP_CONTENT_DIR . '/plugins/typedpress-store';
    $build = defined('TP_TEST_BUILD') ? (string) TP_TEST_BUILD : ($_SERVER['HTTP_X_TYPEDPRESS_BUILD'] ?? null);
    if (!is_string($build) || preg_match('/\A[0-9a-f]{64}\z/D', $build) !== 1 || !is_file("$root/build/$build.json")) {
        return;
    }
    $manifest = json_decode((string) file_get_contents("$root/build/$build.json"), true);
    require_once "$root/runtime/{$manifest['runtime']}/typedpress-loader.php";
    if (!defined('TP_TEST_BUILD') && \TypedPress\Loader\Store::receipt($root, $build) === null) {
        return;
    }
    \TypedPress\Loader\Loader::load($root, $build, ['variables' => [], 'users' => true, 'url' => content_url('plugins/typedpress-store'), 'inspect' => defined('TP_TEST_INSPECT')]);
})();
