<?php

declare(strict_types=1);

/*
 * The site brand_upgrade/legacy-site.php builds with LEGACY_COMMIT's runtime (exported from git),
 * and what it holds. Removed when the suite ends, unless SP_WP_KEEP=1. `$legacyOnly` (set by the
 * including suite) builds it with identity alone: no runtime, no app.
 */

$repo = dirname(__DIR__, 3);
$checkout = sys_get_temp_dir() . '/spacepress-legacy-' . bin2hex(random_bytes(4));
mkdir($checkout);
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($checkout)));
exec('git -C ' . escapeshellarg($repo) . ' archive ' . LEGACY_COMMIT . ' tests/php tests/fixtures/blog tests/fixtures/blog.schema.json tests/fixtures/platform.json runtime | tar -x -C ' . escapeshellarg($checkout), $out, $code);
$code === 0 || throw new RuntimeException('cannot export ' . LEGACY_COMMIT . ': ' . implode("\n", $out));
$errors = tempnam(sys_get_temp_dir(), 'spacepress-legacy-');
$out = [];
// The earlier harness reads its download cache from the variable of its own name; share this checkout's.
exec('TP_WP_CACHE=' . escapeshellarg((string) realpath(wpCache())) . ' ' . escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__DIR__ . '/legacy-site.php') . ' ' . escapeshellarg($checkout) . ' 2>' . escapeshellarg($errors), $out, $code);
$before = json_decode((string) end($out), true);
($code === 0 && is_array($before)) || throw new RuntimeException("the legacy site failed:\n" . implode("\n", $out) . file_get_contents($errors));
unlink($errors);
register_shutdown_function(static fn () => getenv('SP_WP_KEEP') === '1' || exec('rm -rf ' . escapeshellarg($before['dir'])));

return $before;
