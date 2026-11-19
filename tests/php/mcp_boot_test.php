<?php

declare(strict_types=1);

/*
 * TypedPress's API (`/wp-json/typedpress/v1`) never dispatches to `/mcp`, so it builds no MCP server and no
 * abilities; `/wp-json` requests, MCP's own route and REST discovery are unchanged. On WordPress on
 * SQLite over HTTP, with the pinned MCP Adapter active.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$log = sys_get_temp_dir() . '/typedpress-mcp-boot-' . bin2hex(random_bytes(4)) . '.json';
$logFile = var_export($log, true);
$wp = wpSite('mcp-boot', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'muPlugins' => ['observe' => <<<PHP
        <?php
        register_shutdown_function(static function (): void {
            \$adapter = class_exists(\\WP\\MCP\\Core\\McpAdapter::class) ? \\WP\\MCP\\Core\\McpAdapter::instance() : null;
            file_put_contents($logFile, json_encode([
                'app server' => \$adapter !== null && \$adapter->get_server('typedpress-blog') !== null,
                'default server' => \$adapter !== null && \$adapter->get_server('mcp-adapter-default-server') !== null,
                'abilities' => did_action('wp_abilities_api_init'),
            ]));
        });
        PHP],
]);
register_shutdown_function(static fn () => @unlink($log));
$url = 'http://127.0.0.1:' . $wp->startServer();
$basic = 'Authorization: Basic ' . base64_encode($wp->appPassword('admin'));

/** @return array{int, array} the status and what the request built */
function get(string $url, array $headers = [], ?string $body = null): array
{
    global $log;
    @unlink($log);
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    curl_exec($ch);
    clearstatcache();

    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), json_decode((string) @file_get_contents($log), true) ?? []];
}

$none = ['app server' => false, 'default server' => false, 'abilities' => 0];
eq('an API list builds no MCP server and no abilities', get("$url/wp-json/typedpress/v1/posts"), [200, $none]);
eq('signed in, the same', get("$url/wp-json/typedpress/v1/posts", [$basic])[1], $none);
// An action is dispatched through the abilities API, so the abilities are registered; still no MCP server.
eq('an action through the API runs: abilities are registered, no MCP server is built', get("$url/wp-json/typedpress/v1/actions/publishedCount", [$basic, 'Content-Type: application/json'], '{}'), [200, ['app server' => false, 'default server' => false, 'abilities' => 1]]);
[$status, $built] = get("$url/wp-json/mcp/typedpress-blog", [$basic, 'Content-Type: application/json', 'Accept: application/json, text/event-stream'], json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize',
    'params' => ['protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(), 'clientInfo' => ['name' => 'test', 'version' => '1']]]));
eq('the app\'s MCP route answers on /wp-json, with both servers', [$status, $built['app server'] ?? null, $built['default server'] ?? null], [200, true, true]);
eq('core REST requests build them as before', get("$url/wp-json/wp/v2/types")[1], ['app server' => true, 'default server' => true, 'abilities' => 1]);
finish('mcp_boot');
