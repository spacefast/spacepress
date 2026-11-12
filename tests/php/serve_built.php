<?php

declare(strict_types=1);

/*
 * Serves a `first build` artifact on WordPress-on-SQLite with the theme front end on, for a browser
 * test (tests/app_router.rs `client_components_hydrate_in_the_browser`). Prints one JSON line
 * ({url}) and serves until killed. FIRST_WP_SCRIPT_DEBUG=1 is passed through to the server.
 *
 *   FIRST_WP_THEMES=1 php tests/php/serve_built.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('serve-built', ['wpContent' => $argv[1]]);
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
