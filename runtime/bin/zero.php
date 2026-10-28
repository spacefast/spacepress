<?php

declare(strict_types=1);

// Installed at <out>/zero/bin/zero.php; the app root is two levels up.
if (PHP_SAPI !== 'cli') {
    exit(1);
}
$root = dirname(__DIR__, 2);
require $root . '/zero/runtime/bootstrap.php';

$args = array_slice($argv, 1);
try {
    // `migrate` applies migrations itself; everything else auto-migrates per ZERO_AUTO_MIGRATE.
    $app = \Zero\App::boot($root, ($args[0] ?? '') === 'migrate' ? false : null);
    [$code, $out] = $app->cli($args);
} catch (\Throwable $e) {
    [$code, $out] = [1, \Zero\Js::jsonStringify(['error' => \Zero\App::problem($e)])];
}
fwrite(STDOUT, $out . "\n");
exit($code);
