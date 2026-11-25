<?php
/**
 * Test-only host for tests/wp/store-run.sh: selects one stored build per request, the way a host
 * with immutable versions does, with SpacePress Identity mounted (`users`). HTTP names the build in
 * X-SpacePress-Build and is served only once that
 * build initialized; WP-CLI names it with SP_TEST_BUILD (`wp --exec=...`) to initialize or collect,
 * and adds SP_TEST_INSPECT to mount it for inspection.
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

(static function (): void {
    $root = WP_CONTENT_DIR . '/plugins/spacepress-store';
    $build = defined('SP_TEST_BUILD') ? (string) SP_TEST_BUILD : ($_SERVER['HTTP_X_SPACEPRESS_BUILD'] ?? null);
    if (!is_string($build) || preg_match('/\A[0-9a-f]{64}\z/D', $build) !== 1 || !is_file("$root/build/$build.json")) {
        return;
    }
    $manifest = json_decode((string) file_get_contents("$root/build/$build.json"), true);
    require_once "$root/runtime/{$manifest['runtime']}/spacepress-loader.php";
    if (!defined('SP_TEST_BUILD') && \SpacePress\Loader\Store::receipt($root, $build) === null) {
        return;
    }
    \SpacePress\Loader\Loader::load($root, $build, ['variables' => [], 'users' => true, 'url' => content_url('plugins/spacepress-store'), 'inspect' => defined('SP_TEST_INSPECT')]);
})();
