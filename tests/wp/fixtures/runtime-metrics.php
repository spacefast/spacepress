<?php

declare(strict_types=1);

// Installed explicitly by bench-runtime.py in its disposable stack, never in an app artifact.
$zeroBenchStart = hrtime(true);
add_filter('rest_pre_serve_request', static function (mixed $served) use ($zeroBenchStart): mixed {
    header('X-Zero-Bench: ' . json_encode([
        'php_ms' => (hrtime(true) - $zeroBenchStart) / 1e6,
        'peak_bytes' => memory_get_peak_usage(),
        'allocated_bytes' => memory_get_peak_usage(true),
        'included_files' => count(get_included_files()),
    ], JSON_THROW_ON_ERROR));

    return $served;
}, 0);
