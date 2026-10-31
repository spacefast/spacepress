<?php
/**
 * Test-only mu-plugin: the ORIGINAL Zero kernel (monorepo runtime/engine/wordpress, staged next to
 * this file as legacy-engine/) serving the captured release from a private tree, exactly where the
 * original runtime kept it. The Space role stands in for the platform's per-request grant.
 */
declare(strict_types=1);

$release = getenv('ZERO_LEGACY_RELEASE');
if (!is_string($release) || $release === '') {
    return;
}
// The release names its own revision; the directory and the .sha256 pointer carry it as stored.
$revision = 'sha256:' . basename($release);
$GLOBALS['SPACEFAST_CONTENT_SPACE_ID'] = 'legacy-space';
$GLOBALS['SPACEFAST_CONTENT_MODEL_RELEASE_ROOT'] = $release;
$GLOBALS['SPACEFAST_CONTENT_MODEL_REVISION'] = $revision;
$GLOBALS['SPACEFAST_CONTENT_WORDPRESS_ROLE'] = 'administrator';
// Uploads land in the Space's private storage root, as on the original platform (not wp-content/uploads).
$GLOBALS['SPACEFAST_CONTENT_PRIVATE_ROOT'] = WP_CONTENT_DIR . '/.stattic/storage';
require WP_CONTENT_DIR . '/legacy-engine/wordpress/content-kernel.php';
