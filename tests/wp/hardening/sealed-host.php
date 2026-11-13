<?php
// Test stack only: what a host does to enforce a sealed build's allow-list before plugins load
// (docs/sealed.md). Installed as a must-use plugin by tests/wp/hardening/sealed.test.ts while it runs:
// WordPress reads `active_plugins` after mu-plugins load, so this filter decides which plugins load.
// The list is the one the build wrote; the helper is the loader's.
defined('ABSPATH') || exit;
(static function (): void {
    $manifest = json_decode((string) @file_get_contents(WP_CONTENT_DIR . '/first-manifest.json'), true);
    $sealed = is_array($manifest['sealed'] ?? null) ? $manifest['sealed'] : null;
    $loader = WP_CONTENT_DIR . '/first-loader.php';
    if ($sealed === null || !is_file($loader)) {
        return;
    }
    require_once $loader;
    define('FIRST_SEALED_ENFORCED', true);
    add_filter('option_active_plugins', static fn ($active) => \First\Loader\Loader::allowedPlugins((array) $active, $sealed), PHP_INT_MAX);
})();
