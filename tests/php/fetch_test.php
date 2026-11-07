<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\Fetch;
use Zero\HttpError;

// The address policy, without a network: the same ranges the original Zero runtime denied.
$denied = [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.9',
    '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1',
    '2001::1', '2001:db8::1', '2002:7f00:1::', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'fec0::1', 'ff02::1',
];
$allowed = ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:1.1.1.1'];
eq('private, loopback, link-local and special-purpose addresses are denied',
    array_values(array_filter($denied, [Fetch::class, 'allowed'])), []);
eq('public addresses are allowed, including IPv4-mapped public ones',
    array_values(array_filter($allowed, [Fetch::class, 'allowed'])), $allowed);

$code = static function (string $url): string {
    try {
        Fetch::target($url);
        return 'allowed';
    } catch (HttpError $e) {
        return $e->errorCode;
    }
};
Fetch::$resolver = static fn (string $host): array => match ($host) {
    'public.example' => ['93.184.216.34'],
    'internal.example' => ['10.0.0.5'],
    'mixed.example' => ['93.184.216.34', '127.0.0.1'],
    'v6.example' => ['fe80::1'],
    default => [],
};
eq('URL policy: HTTPS only, no credentials, no local or platform hosts, every resolved address checked',
    array_map($code, [
        'https://public.example/x', 'http://public.example/x', 'ftp://public.example/', 'https://user:pw@public.example/',
        'https://localhost/', 'https://app.localhost/', 'https://site.space.fast/', 'https://internal.example/',
        'https://mixed.example/', 'https://v6.example/', 'https://127.0.0.1/', 'https://[::1]/', 'https://nowhere.example/',
        'https://169.254.169.254/latest/meta-data/',
    ]),
    ['allowed', 'zero_fetch_scheme_denied', 'zero_fetch_scheme_denied', 'zero_fetch_credentials_denied',
        'zero_fetch_host_denied', 'zero_fetch_host_denied', 'zero_fetch_host_denied', 'zero_fetch_address_denied',
        'zero_fetch_address_denied', 'zero_fetch_address_denied', 'zero_fetch_address_denied', 'zero_fetch_address_denied',
        'zero_fetch_upstream_unavailable', 'zero_fetch_address_denied']);
eq('a plugin\'s locked hosts are checked before resolution, on every hop',
    array_map(static function (string $url): string {
        try {
            Fetch::target($url, ['public.example']);
            return 'allowed';
        } catch (HttpError $e) {
            return $e->errorCode;
        }
    }, ['https://public.example/x', 'https://PUBLIC.example./y', 'https://other.example/', 'https://internal.example/']),
    ['allowed', 'allowed', 'zero_fetch_host_denied', 'zero_fetch_host_denied']);
eq('the checked address is the one the connection is pinned to',
    Fetch::target('https://public.example:8443/a'), ['public.example', 8443, '93.184.216.34']);
Fetch::$resolver = null;

$type = static function (callable $f): string {
    try {
        $f();
        return 'ok';
    } catch (\Zero\JsError $e) {
        return $e->getMessage();
    } catch (HttpError $e) {
        return $e->errorCode;
    }
};
eq('request shape is checked before any network work',
    [
        $type(fn () => Fetch::call(42)),
        $type(fn () => Fetch::call('https://a.example/', ['method' => 'CONNECT'])),
        $type(fn () => Fetch::call('https://a.example/', ['method' => 'GET', 'body' => 'x'])),
        $type(fn () => Fetch::call('https://a.example/', ['headers' => ['x-a' => "b\r\nInjected: 1"]])),
        $type(fn () => Fetch::call('https://a.example/', ['method' => 'POST', 'body' => str_repeat('x', Fetch::MAX_BODY + 1)])),
    ],
    ['fetch() needs a URL string', 'zero_fetch_method_denied', 'Request with GET method cannot have body.',
        'fetch() header names and values must be valid strings', 'zero_fetch_payload_too_large']);

finish('fetch');
