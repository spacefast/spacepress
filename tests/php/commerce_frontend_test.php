<?php

declare(strict_types=1);

/*
 * A store whose config names an external `frontend` (tests/commerce.rs): that origin may read the
 * Store API, without credentials, and nothing else on the site is opened to it.
 *
 *   TP_WP_THEMES=1 php tests/php/commerce_frontend_test.php <wp-content dir> <frontend origin>
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$site = wpSite('commerce-frontend', ['wpContent' => $argv[1], 'server' => true]);
$frontend = $argv[2];
$request = static function (string $path, array $headers = [], string $method = 'GET') use ($site): array {
    $client = curl_init($site->url() . $path);
    $seen = [];
    curl_setopt_array($client, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $headers, CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$seen): int {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) { $seen[strtolower($parts[0])] = trim($parts[1]); }
            return strlen($line);
        },
    ]);
    $body = curl_exec($client);
    return [(int) curl_getinfo($client, CURLINFO_RESPONSE_CODE), $seen, (string) $body];
};
$cors = static fn (array $headers): array => [$headers['access-control-allow-origin'] ?? null, $headers['access-control-allow-credentials'] ?? null];
$cart = '/wp-json/wc/store/v1/cart';

// The storefront's first read holds no Cart-Token yet.
[$status, $headers] = $request($cart, ["Origin: $frontend"]);
eq('the frontend origin reads the Store API, without credentials', [$status, ...$cors($headers)], [200, $frontend, null]);
check('it may send and read the cart token', ($headers['cart-token'] ?? '') !== ''
    && str_contains($headers['access-control-allow-headers'] ?? '', 'Cart-Token') && str_contains($headers['access-control-expose-headers'] ?? '', 'Cart-Token'), $headers);
check('the answer is private', str_contains($headers['cache-control'] ?? '', 'private, no-store') && ($headers['a8c-edge-cache'] ?? '') === 'no-cache', $headers);
$token = $headers['cart-token'] ?? '';
eq('with its token too, the frontend origin gets no credentialed access', $cors($request($cart, ["Origin: $frontend", "Cart-Token: $token"])[1]), [$frontend, null]);
eq('the plain-permalink Store API address is the same route', $cors($request('/?rest_route=/wc/store/v1/cart', ["Origin: $frontend"])[1]), [$frontend, null]);
foreach (['https://evil.example.test', "$frontend.evil.example.test", str_replace('https://', 'http://', $frontend), strtoupper($frontend), 'null'] as $origin) {
    eq("another origin is not allowed: $origin", $cors($request($cart, ["Origin: $origin"])[1])[0], null);
}

// A visitor's cookie cart, their address and its Cart-Token stay out of a frontend script's reach:
// a browser hands a credentialed answer to a script only with Allow-Credentials.
$jar = curl_init();
curl_setopt_array($jar, [CURLOPT_COOKIEFILE => '', CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_URL => $site->url() . $cart]);
curl_exec($jar);
$cookie = implode('; ', array_map(static fn (string $line): string => explode("\t", $line)[5] . '=' . explode("\t", $line)[6], curl_getinfo($jar, CURLINFO_COOKIELIST)));
[$status, $headers] = $request($cart, ["Origin: $frontend", "Cookie: $cookie"]);
eq('a credentialed read from the frontend origin is not readable there', [$status, ...$cors($headers)], [200, $frontend, null]);

// An administrator's browser, driven by a script on the frontend origin. `rest_route` in the query
// string makes WooCommerce call any address a Store API request (WC()->is_store_api_request()).
$admin = 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($site->userId('admin'), time() + 3600, 'logged_in'));
[$status, $headers, $body] = $request('/wp-admin/admin-ajax.php?action=rest-nonce&rest_route=/wc/store/', [$admin, "Origin: $frontend"]);
check('the probe is signed in: admin-ajax answers with a REST nonce', $status === 200 && preg_match('/^[a-f0-9]{10}$/', $body) === 1, [$status, $body]);
eq('admin-ajax is not opened to the frontend origin', $cors($headers), [null, null]);
eq('the frontend origin is not one of WordPress\'s allowed origins', in_array($frontend, get_allowed_http_origins(), true), false);
[$status, $headers] = $request('/wp-admin/admin-ajax.php?action=heartbeat&rest_route=/wc/store/v1/cart', [$admin, "Origin: $frontend"], 'POST');
eq('nor is any other admin-ajax action', $cors($headers), [null, null]);

// WordPress's own pages go to the frontend, the addresses Woo sends a shopper back to included.
[$status, $headers] = $request('/checkout/order-received/7/?key=wc_order_abc');
eq('a payment return address goes to the frontend with its path and query', [$status, $headers['location'] ?? null], [308, "$frontend/checkout/order-received/7/?key=wc_order_abc"]);

$log = $site->debugLog();
check('no PHP warnings or fatal errors', !preg_match('/PHP (Warning|Fatal error):/', $log), $log);
finish('commerce_frontend');
