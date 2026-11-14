<?php

declare(strict_types=1);

/*
 * A root catch-all `route.ts` over HTTP (tests/app_router.rs
 * `a_root_catch_all_leaves_reserved_paths_alone`): the fixture tests/fixtures/app-router-reserved,
 * built by `first build`, served by php -S. Prints one JSON object: label => [status, body].
 *
 *   FIRST_WP_THEMES=1 php tests/php/app_router_reserved.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('app-reserved', ['wpContent' => $argv[1]]);
$site->startServer();
$url = $site->url();

function answer(string $url, string $method = 'GET'): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $body = (string) curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $body === 'app' ? 'app' : 'not the app'];
}

echo json_encode([
    'app path' => answer("$url/notes/hello"),
    'app path POST' => answer("$url/notes/hello", 'POST'),
    // The host answers these before WordPress on Spacefast; elsewhere they reach WordPress, never the app.
    'connector GET' => answer("$url/__spacefast/connectors/crm/list_deals"),
    'connector POST' => answer("$url/__spacefast/connectors/crm/create_deal", 'POST'),
    'space client' => answer("$url/__spacefast/client.js"),
    'first' => answer("$url/__first/client.js"),
    'zero' => answer("$url/__zero/client.js"),
    'rest' => answer("$url/wp-json/"),
], JSON_UNESCAPED_SLASHES), "\n";
$site->destroy();
