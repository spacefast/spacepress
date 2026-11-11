<?php

declare(strict_types=1);

// Test-only diagnostic probe; never included in a deployed app.
$zeroBenchStart = hrtime(true);
$zeroMcpMetrics = [];
add_action('rest_api_init', static function () use (&$zeroMcpMetrics): void {
    global $wp_filter;
    foreach ($wp_filter['rest_api_init']->callbacks as &$callbacks) {
        foreach ($callbacks as &$callback) {
            $fn = $callback['function'];
            if (!is_array($fn) || !$fn[0] instanceof \WP\MCP\Core\McpAdapter || $fn[1] !== 'init') {
                continue;
            }
            $callback['function'] = static function (...$args) use ($fn, &$zeroMcpMetrics) {
                $start = hrtime(true);
                $memory = memory_get_usage();
                try {
                    return $fn(...$args);
                } finally {
                    $zeroMcpMetrics = [(hrtime(true) - $start) / 1e6, memory_get_usage() - $memory];
                }
            };
        }
    }
}, PHP_INT_MIN);
add_filter('rest_pre_serve_request', static function (mixed $served) use ($zeroBenchStart, &$zeroMcpMetrics): mixed {
    if (count($zeroMcpMetrics) !== 2) {
        throw new RuntimeException('MCP init callback was not measured');
    }
    $phpMs = (hrtime(true) - $zeroBenchStart) / 1e6;
    header('X-First-Bench: ' . json_encode([
        'php_ms' => $phpMs,
        'peak_bytes' => memory_get_peak_usage(),
        'allocated_bytes' => memory_get_peak_usage(true),
        'included_files' => count(get_included_files()),
        'mcp_init_ms' => $zeroMcpMetrics[0],
        'mcp_init_live_bytes' => $zeroMcpMetrics[1],
        'mcp_share_percent' => $zeroMcpMetrics[0] / $phpMs * 100,
    ], JSON_THROW_ON_ERROR));
    return $served;
}, 0);
