<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/tests/php/wp.php';
require __DIR__ . '/fixture.php';

$artifact = servicesArtifact();
try {
    $site = wpSite('services-example', ['wpContent' => $artifact['content']]);
} finally {
    servicesRemoveArtifact($artifact['directory']);
}
// This example's native plugin is loaded before init on each real HTTP request.
file_put_contents($site->content . '/mu-plugins/app-services.php', '<?php require_once ' . var_export(__DIR__ . '/wordpress/typedpress-app-services.php', true) . ';');
require_once __DIR__ . '/wordpress/typedpress-app-services.php';
$db = \TypedPress\db();
$db->insert('posts', ['title' => 'A WordPress workshop for small apps', 'excerpt' => 'Build on native publishing and useful services.', 'status' => 'published']);
$site->startServer();
echo 'Example: ' . $site->url() . "/?app-services=1\n";
echo 'Owned site: ' . $site->dir . "\nCtrl-C stops and deletes this site.\n";
pcntl_async_signals(true);
pcntl_signal(SIGINT, static fn () => exit(0));
pcntl_signal(SIGTERM, static fn () => exit(0));
while ($site->serving()) {
    // Wait for a signal; the server is the long-running process this example owns.
    pcntl_signal_dispatch();
    $read = [STDIN];
    $write = $except = [];
    if (stream_select($read, $write, $except, 1) > 0 && feof(STDIN)) {
        exit(0);
    }
}
