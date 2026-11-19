<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

putenv('KITCHEN_REGISTRATION_SECRET=local-test-registration-key');
$site = wpSite('kitchen-sink', [
    'wpContent' => $argv[1],
    'users' => ['cook' => 'subscriber', 'host' => 'editor'],
    'server' => true,
]);

function visit(string $path, array $headers = [], ?string $body = null): array
{
    global $site;
    $ch = curl_init($site->url() . $path);
    $response = [];
    curl_setopt_array($ch, [
        CURLOPT_TIMEOUT => 30, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$response): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $response[strtolower($name)] = trim($value);
            }
            return strlen($line);
        },
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $html = (string) curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $html, $response];
}

function session(WpSite $site, string $user): string
{
    $id = $site->userId($user);
    $expires = time() + 3600;
    return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, $expires, 'logged_in'));
}

$paths = [
    '/' => ['/', 'Workshops'],
    'api/registration' => ['/api/registration?workshop=bread-basics', ''],
    'api/schedule' => ['/api/schedule?kitchen=annex', '"kitchen":"annex"'],
    'events/[slug]' => ['/events/bread-basics/', 'Bread basics'],
    'journal/[slug]' => ['/journal/feeding-a-starter/', 'Feeding a starter'],
    'visits/[day]' => ['/visits/saturday/', 'Saturday visits'],
    'handbook' => ['/handbook/', 'Using the kitchen'],
    'handbook/[...path]' => ['/handbook/using-the-kitchen/', 'Clean as you go'],
    'about' => ['/about/', 'hands-on classes'],
    'cart' => ['/cart/', 'Cart'],
    'checkout' => ['/checkout/', 'Checkout'],
    'find' => ['/find/?q=bread', 'Bread basics'],
    'shop' => ['/shop/', 'Bench scraper'],
    'staff' => ['/staff/', 'Kitchen staff'],
    'kitchen.start' => ['/start/', ''],
];
$routes = array_column($site->plugin()->schema->app()['routes'], 'id');
sort($routes);
$covered = array_keys($paths);
sort($covered);
eq('every compiled route has an HTTP case', $covered, $routes);
foreach ($paths as $id => [$path, $marker]) {
    $status = match ($id) {
        'api/registration' => 401,
        'kitchen.start' => 301,
        default => 200,
    };
    $headers = $id === 'staff' ? [session($site, 'host')] : [];
    [$actual, $body, $response] = visit($path, $headers, $id === 'api/registration' ? '{}' : null);
    eq("$id returns $status", $actual, $status);
    if ($marker !== '') {
        check("$id renders $marker", str_contains($body, $marker));
    }
    if ($id === 'kitchen.start') {
        eq('start redirect points to About', parse_url($response['location'] ?? '', PHP_URL_PATH), '/about/');
    }
}
eq('a guest is sent to sign-in from the staff layout', visit('/staff/')[0], 302);
eq('a subscriber cannot open the staff layout', visit('/staff/', [session($site, 'cook')])[0], 403);
[$status, $body] = visit('/wp-login.php');
eq('WordPress login renders', $status, 200);
check('WordPress uses the app login component', str_contains($body, 'Sign in to the Community Kitchen'));
[$status, $body] = visit('/events/missing/');
eq('a missing workshop returns 404', $status, 404);
check('a missing workshop uses the app 404', str_contains($body, 'Kitchen page not found'));
[$status, $body] = visit('/events/bread-basics/', [session($site, 'cook')]);
eq('a visitor can open the workshop and see the form after sign-in', $status, 200);
check('the action form renders for a member', str_contains($body, 'Reserve seats'));
check('the workshop renders its comments', str_contains($body, 'typedpress-comments-form'));
check('the workshop renders its live fragment', str_contains($body, 'data-tp-live'));
[$status, $prerender] = $site->call('GET', '/prerender', as: 'host');
eq('the visit page enumerates its static route', [$status, array_column($prerender['urls'] ?? [], 'path')], [200, ['/visits/saturday']]);

$mcp = '/wp-json/mcp/typedpress-kitchen-sink';
$headers = ['Authorization: Basic ' . base64_encode($site->appPassword('admin')),
    'Content-Type: application/json', 'Accept: application/json, text/event-stream'];
[$status, , $init] = visit($mcp, $headers, json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize',
    'params' => ['protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(), 'clientInfo' => ['name' => 'test', 'version' => '1']]]));
eq('the app MCP server accepts a session', $status, 200);
[$status, $body] = visit($mcp, [...$headers,
    'Mcp-Session-Id: ' . ($init['mcp-session-id'] ?? ''), 'Mcp-Protocol-Version: 2025-11-25',
], json_encode(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list', 'params' => new stdClass()]));
eq('the app MCP server answers', $status, 200);
check('the app exposes the workshop schedule to MCP', str_contains($body, 'kitchen-sink-upcoming'));
finish('kitchen_sink');
