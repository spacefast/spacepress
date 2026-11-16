<?php

declare(strict_types=1);

/*
 * Serves a `typedpress build` artifact on WordPress-on-SQLite with the theme front end on, for a browser
 * test (tests/app_router.rs `client_components_hydrate_in_the_browser`). Prints one JSON line
 * ({url}) and serves until killed. TP_WP_SCRIPT_DEBUG=1 is passed through to the server.
 *
 * With a seed records directory (what a hosted compile writes for synced files), the site is
 * seeded from it first, as a publish seeds it.
 *
 *   TP_WP_THEMES=1 php tests/php/serve_built.php <wp-content dir> [seed records dir]
 */

require __DIR__ . '/wp.php';

// TP_SERVE_MU names a must-use plugin a browser test needs on the server (its test hooks).
$mu = getenv('TP_SERVE_MU');
$site = wpSite('serve-built', ['wpContent' => $argv[1]] + (is_string($mu) && is_file($mu) ? ['muPlugins' => ['test' => (string) file_get_contents($mu)]] : []));
if (isset($argv[2])) {
    \TypedPress\Sync\Seed::run(\TypedPress\Wp\Runtime::plugin(), $argv[2]);
}
$site->startServer();
echo json_encode(['url' => $site->url()]), "\n";
fclose(STDOUT);
pcntl_signal(SIGTERM, static function () use ($site): void {
    $site->destroy();
    exit(0);
});
while (true) {
    pcntl_signal_dispatch();
    if (!$site->serving()) {
        $site->destroy();
        exit(1);
    }
    usleep(100_000);
}
