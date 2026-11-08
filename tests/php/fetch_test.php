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
eq('a trailing root dot and case name the same host the policy checks and the pin covers',
    [Fetch::target('https://PUBLIC.example./a'), $code('https://internal.example./'), $code('https://site.space.fast./'),
        $code('https://a..example/'), Fetch::target('https://public.example./', ['public.example'])],
    [['public.example', 443, '93.184.216.34'], 'zero_fetch_address_denied', 'zero_fetch_host_denied', 'zero_fetch_host_denied',
        ['public.example', 443, '93.184.216.34']]);
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
        $type(fn () => Fetch::call('https://a.example/', ['redirect' => 'never'])),
        $type(fn () => Fetch::call('https://a.example/', ['method' => 'POST', 'body' => new \Zero\JsArray([])])),
        $type(fn () => Fetch::call('https://a.example/', ['signal' => true])),
        $type(fn () => Fetch::call('https://a.example/', ['method' => 1])),
    ],
    ['fetch() needs a URL string', 'zero_fetch_method_denied', 'Request with GET method cannot have body.',
        'Headers: invalid header value', 'zero_fetch_payload_too_large',
        "fetch() redirect must be 'follow', 'manual' or 'error'", 'fetch() body must be a string or URLSearchParams',
        "fetch() init option signal isn't available in Zero code", 'fetch() method must be a string']);

// Headers, URLSearchParams and Response, as the WHATWG classes behave (Node prints the same).
$h = new \Zero\FetchHeaders(new \Zero\JsArray([new \Zero\JsArray(['X-A', ' 1 ']), new \Zero\JsArray(['x-a', '2'])]));
$p = new \Zero\SearchParams('a=1&b=two+words&a=%C3%A9&c&%zz=%');
$r = new \Zero\FetchResponse(200, 'OK', 'https://a.example/', false, \Zero\FetchHeaders::received(['x' => 'y']), '{"a":1}');
eq('Headers join repeated names; URLSearchParams parse and serialize like the URL Standard; a body reads once',
    [$h->get('x-A'), $h->sorted(), (string) $p, $p->getAll('a')->a, $p->get('%zz'),
        $r->ok, $r->json()->p, $r->bodyUsed(), $type(fn () => $r->text()), $type(fn () => $r->headers->set('x', 'z'))],
    ['1, 2', ['x-a' => '1, 2'], 'a=1&b=two+words&a=%C3%A9&c=&%25zz=%25', ['1', 'é'], '%',
        true, ['a' => 1], true, 'Body is unusable: Body has already been read', 'immutable']);

// Location resolution, RFC 3986 §5.2: query-only and fragment-only references keep the base path.
foreach ([
    ['https://api.example/items/42', '?page=2', 'https://api.example/items/42?page=2'],
    ['https://api.example/items/42?x=1', '#frag', 'https://api.example/items/42?x=1'],
    ['https://api.example/a/b/c', '../d', 'https://api.example/a/d'],
    ['https://api.example/a/b/c', './d?q', 'https://api.example/a/b/d?q'],
    ['https://api.example/a/b', '../../../x', 'https://api.example/x'],
    ['https://api.example:8443/a/b', '/c', 'https://api.example:8443/c'],
    ['https://api.example/a', '//other.example/x', 'https://other.example/x'],
] as [$base, $location, $expected]) {
    eq("Location $location against $base", Fetch::resolveUrl($base, $location), $expected);
}

// The pin fails closed before anything is sent. A local listener stands in for the target, and the
// handle names it `localhost`, which resolves to the listener on its own: an unpinned handle would
// reach it. When the pin can't be set, the handle must not connect there or send anything.
$server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
$port = (int) substr(strrchr(stream_socket_get_name($server, false), ':'), 1);
stream_set_blocking($server, false);
$attempt = static function (?callable $setopt) use ($port): array {
    $curl = curl_init("https://localhost:$port/secret?token=1");
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 2, CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => false, CURLOPT_POSTFIELDS => 'leak']);
    $pinned = Fetch::pin($curl, 'localhost', $port, '127.0.0.1', $setopt);
    curl_exec($curl);
    return [$pinned, (string) curl_getinfo($curl, CURLINFO_PRIMARY_IP), (int) curl_getinfo($curl, CURLINFO_REQUEST_SIZE)];
};
$accepted = static function () use ($server): int {
    $n = 0;
    while (($peer = @stream_socket_accept($server, 0)) !== false) {
        $n++;
        fclose($peer);
    }
    return $n;
};
[$pinned, $ip] = $attempt(null);
eq('a pinned handle connects to the checked address, not wherever the name resolves', [$pinned, $ip, $accepted()], [true, '127.0.0.1', 1]);
$failing = static fn (\CurlHandle $c, int $option, mixed $value): bool => $option === CURLOPT_RESOLVE ? false : curl_setopt($c, $option, $value);
[$pinned, $ip, $sent] = $attempt($failing);
eq('when the pin can\'t be set, the handle never reaches the target and sends no request', [$pinned, $accepted(), $sent], [false, 0, 0]);
fclose($server);

finish('fetch');
