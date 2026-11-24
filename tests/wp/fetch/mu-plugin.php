<?php
// Fetch lane only: `fetch-origin.test` names the host-side receiver (the docker host gateway, a
// private address), trusted by its own CA. Every other private address stays refused.
$origin  = 'fetch-origin.test';
$gateway = gethostbyname( 'host.docker.internal' );
add_filter( 'sp_fetch_allow_address', static fn ( $open, $address, $host ) => $open || ( $host === $origin && $address === $gateway ), 10, 3 );
add_filter( 'sp_fetch_resolve', static fn ( $answer, $host ) => $host === $origin ? array( $gateway ) : $answer, 10, 2 );
// Lane probe: `?spacepress-fetch-transport=streams` swaps in a transport that answers like a real one
// without any pinned connection, as a site plugin choosing another transport would. fetch() must
// send through its own pinned cURL connection instead, so this transport is never used.
if ( ( $_GET['spacepress-fetch-transport'] ?? '' ) === 'streams' ) {
	add_action(
		'requests-requests.before_request',
		static function ( &$url, &$headers, &$data, &$type, &$options ): void {
			$options['transport'] = new class() implements \WpOrg\Requests\Transport {
				public function request( $url, $headers = array(), $data = array(), $options = array() ) {
					file_put_contents( '/spacepress-fetch/unpinned.log', $url . "\n", FILE_APPEND );
					return "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nunpinned";
				}
				public function request_multiple( $requests, $options ) {
					return array(); }
				public static function test( $capabilities = array() ) {
					return true; }
			};
		},
		10,
		5
	);
}
// Requests verifies against `sslcertificates`; the lane's CA replaces the bundle for its origin only.
add_filter(
	'http_request_args',
	static function ( $args, $url ) use ( $origin ) {
		if ( strtolower( (string) parse_url( $url, PHP_URL_HOST ) ) === $origin ) {
			$args['sslcertificates'] = '/spacepress-fetch/ca.pem';
		}
		return $args;
	},
	10,
	2
);
