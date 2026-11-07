<?php
// Fetch lane only: `fetch-origin.test` names the host-side receiver (the docker host gateway, a
// private address), trusted by its own CA. Every other private address stays refused.
$origin = 'fetch-origin.test';
$gateway = gethostbyname('host.docker.internal');
add_filter('zero_fetch_allow_address', static fn ($open, $address, $host) => $open || ($host === $origin && $address === $gateway), 10, 3);
add_filter('zero_fetch_resolve', static fn ($answer, $host) => $host === $origin ? [$gateway] : $answer, 10, 2);
// Requests verifies against `sslcertificates`; the lane's CA replaces the bundle for its origin only.
add_filter('http_request_args', static function ($args, $url) use ($origin) {
    if (strtolower((string) parse_url($url, PHP_URL_HOST)) === $origin) {
        $args['sslcertificates'] = '/zero-fetch/ca.pem';
    }
    return $args;
}, 10, 2);
