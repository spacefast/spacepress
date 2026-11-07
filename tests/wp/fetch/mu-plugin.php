<?php
// Fetch lane only: `fetch-origin.test` names the host-side receiver (the docker host gateway, a
// private address), trusted by its own CA. Every other private address stays refused.
$origin = 'fetch-origin.test';
$gateway = gethostbyname('host.docker.internal');
add_filter('zero_fetch_allow_address', static fn ($open, $address, $host) => $open || ($host === $origin && $address === $gateway), 10, 3);
add_filter('zero_fetch_resolve', static fn ($answer, $host) => $host === $origin ? [$gateway] : $answer, 10, 2);
// Lane probe: `?zero-fetch-transport=streams` offers WordPress only the streams transport, as a
// host without ext-curl would; fetch() must then refuse rather than send unpinned.
// The swapped transport answers like a real one (it records the call and returns 200), so the
// only thing that can stop fetch() returning its body is fetch() noticing the pin never ran.
if (($_GET['zero-fetch-transport'] ?? '') === 'streams') {
    add_action('requests-requests.before_request', static function (&$url, &$headers, &$data, &$type, &$options): void {
        $options['transport'] = new class implements \WpOrg\Requests\Transport {
            public function request($url, $headers = [], $data = [], $options = []) {
                file_put_contents('/zero-fetch/unpinned.log', $url . "\n", FILE_APPEND);
                return "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nunpinned";
            }
            public function request_multiple($requests, $options) { return []; }
            public static function test($capabilities = []) { return true; }
        };
    }, 10, 5);
}
// Requests verifies against `sslcertificates`; the lane's CA replaces the bundle for its origin only.
add_filter('http_request_args', static function ($args, $url) use ($origin) {
    if (strtolower((string) parse_url($url, PHP_URL_HOST)) === $origin) {
        $args['sslcertificates'] = '/zero-fetch/ca.pem';
    }
    return $args;
}, 10, 2);
