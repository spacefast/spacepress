<?php

declare(strict_types=1);

// WP-CLI supplies the arguments of eval-file in $args.
try {
    $request = json_decode($args[0] ?? '', true, flags: JSON_THROW_ON_ERROR);
    [$operation, $positionals, $flags] = $request;
    if ($operation === 'tables') {
        require_once __DIR__ . '/import-tables.php';
        if (count($positionals) !== 1 || array_diff(array_keys($flags), ['apply', 'dry-run']) !== []
            || (isset($flags['apply']) && ($flags['apply'] !== true || isset($flags['dry-run'])))
            || (isset($flags['dry-run']) && $flags['dry-run'] !== true)) {
            throw new RuntimeException('Usage: wordpress tables <table-import.json> [--apply]');
        }
        global $wpdb;
        WP_CLI::line(wp_json_encode(['data' => typedpress_migrate_tables($wpdb, $positionals[0], isset($flags['apply']))]));
        return;
    }

    $plugin = \TypedPress\Wp\Runtime::plugin();
    if ($plugin === null || $plugin->unavailable() !== null) {
        throw new RuntimeException('Activate and initialize the destination TypedPress app first');
    }
    require_once __DIR__ . '/bootstrap.php';
    $code = \TypedPress\Wp\Legacy\Module::wpCli($plugin, $operation, $positionals, $flags);
    if ($code !== 0) {
        WP_CLI::halt($code);
    }
} catch (Throwable $error) {
    WP_CLI::line(wp_json_encode(['error' => ['code' => 'migration_refused', 'detail' => $error->getMessage()]]));
    WP_CLI::halt(1);
}
