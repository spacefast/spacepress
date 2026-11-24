<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * The global `fetch(url, init?)`: outbound HTTPS from handlers through the WordPress HTTP API.
 *
 * The policy: HTTPS only, no URL credentials, no
 * `localhost` names, and no address in a private, loopback, link-local, CGNAT, documentation,
 * multicast or other special-purpose range, for IPv4 and IPv6 (IPv4-mapped and 6to4 forms
 * unwrapped). Redirects are followed here, at most three, and every hop is resolved and checked
 * again, so a public URL cannot redirect into the network. The connection is pinned to the checked
 * address (CURLOPT_RESOLVE), so DNS cannot answer differently between the check and the connect.
 * Request and response bodies are capped at 1 MiB, and the whole call at 10 seconds.
 */
final class Fetch {

	public const TIMEOUT  = 10;
	public const MAX_BODY = 1048576;
	/** Relaxed limits inside background jobs (e.g. LLM / vision / bank API calls). */
	public const JOB_TIMEOUT    = 60;
	public const JOB_MAX_BODY   = 16777216;
	public const MAX_REDIRECTS  = 3;
	private static bool $in_job = false;

	/** Run `$fn` with background-job outbound fetch limits (`JOB_TIMEOUT`, `JOB_MAX_BODY`). */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Keep the existing public method signature.
	public static function inJob( callable $fn ): mixed {
		$previous     = self::$in_job;
		self::$in_job = true;
		try {
			return $fn();
		} finally {
			self::$in_job = $previous;
		}
	}

	public static function timeout(): int {
		return self::$in_job ? self::JOB_TIMEOUT : self::TIMEOUT;
	}

	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Keep the existing public method signature.
	public static function maxBody(): int {
		return self::$in_job ? self::JOB_MAX_BODY : self::MAX_BODY;
	}
	private const METHODS       = array( 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS' );
	private const DROP_REQUEST  = array( 'connection', 'content-length', 'host', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade' );
	private const DROP_RESPONSE = array( 'connection', 'keep-alive', 'proxy-authenticate', 'set-cookie', 'set-cookie2', 'te', 'trailer', 'transfer-encoding', 'upgrade' );
	/** Hosts the platform itself serves; a Space never reaches another Space through them. */
	private const INTERNAL = array( 'space.fast', 'view.fast', 'atomicsites.net' );
	/** [network, prefix] pairs of the IPv4 ranges fetch never connects to. */
	private const DENIED_V4 = array(
		array( '0.0.0.0', 8 ),
		array( '10.0.0.0', 8 ),
		array( '100.64.0.0', 10 ),
		array( '127.0.0.0', 8 ),
		array( '169.254.0.0', 16 ),
		array( '172.16.0.0', 12 ),
		array( '192.0.0.0', 24 ),
		array( '192.0.2.0', 24 ),
		array( '192.31.196.0', 24 ),
		array( '192.52.193.0', 24 ),
		array( '192.88.99.0', 24 ),
		array( '192.168.0.0', 16 ),
		array( '192.175.48.0', 24 ),
		array( '198.18.0.0', 15 ),
		array( '198.51.100.0', 24 ),
		array( '203.0.113.0', 24 ),
		array( '224.0.0.0', 3 ),
	);
	/** From DENIED_IPV6_NETWORKS. IPv4-mapped addresses are checked as IPv4 first. */
	private const DENIED_V6 = array(
		array( '::', 96 ),
		array( '::ffff:0:0', 96 ),
		array( '::ffff:0:0:0', 96 ),
		array( '64:ff9b::', 96 ),
		array( '64:ff9b:1::', 48 ),
		array( '100::', 64 ),
		array( '2001::', 23 ),
		array( '2001:db8::', 32 ),
		array( '2002::', 16 ),
		array( '2620:4f:8000::', 48 ),
		array( '3fff::', 20 ),
		array( '5f00::', 16 ),
		array( 'fc00::', 7 ),
		array( 'fe80::', 10 ),
		array( 'fec0::', 10 ),
		array( 'ff00::', 8 ),
	);

	/** @var null|\Closure(string): list<string> test seam for name resolution */
	public static ?\Closure $resolver = null;

	/**
	 * @param JsObject|array{method?: mixed, headers?: mixed, body?: mixed, redirect?: mixed}|JsUndefined|null $init
	 * @param list<string>|null $hosts a plugin's locked hosts: every hop must reach one of them
	 */
	public static function call( mixed $url, mixed $init = null, ?array $hosts = null ): FetchResponse {
		if ( $url instanceof JsUrl ) {
			$url = (string) $url;
		}
		if ( ! is_string( $url ) ) {
			throw new JsError( 'fetch() needs a URL string or URL', 'TypeError' );
		}
		$init = $init instanceof JsObject ? $init->p : ( is_array( $init ) ? $init : array() );
		$init = array_filter( $init, static fn ( $v ): bool => JsUndefined::Value !== $v && null !== $v );
		// The compiler refuses other keys in written-out init objects; a computed init is checked here.
		$unknown = array_diff( array_keys( $init ), array( 'method', 'headers', 'body', 'redirect' ) );
		if ( array() !== $unknown ) {
			throw new JsError( 'fetch() init option ' . reset( $unknown ) . ' isn\'t available in SpacePress code', 'TypeError' );
		}
		if ( isset( $init['method'] ) && ! is_string( $init['method'] ) ) {
			throw new JsError( 'fetch() method must be a string', 'TypeError' );
		}
		$method = strtoupper( $init['method'] ?? 'GET' );
		if ( ! in_array( $method, self::METHODS, true ) ) {
			throw self::refuse( 'sp_fetch_method_denied', 'The fetch method is not permitted.' );
		}
		$redirect = $init['redirect'] ?? 'follow';
		if ( ! in_array( $redirect, array( 'follow', 'manual', 'error' ), true ) ) {
			throw new JsError( "fetch() redirect must be 'follow', 'manual' or 'error'", 'TypeError' );
		}
		$headers = self::request_headers( $init['headers'] ?? null );
		$body    = $init['body'] ?? null;
		if ( $body instanceof JsUrlSearchParams ) {
			$headers['content-type'] ??= 'application/x-www-form-urlencoded;charset=UTF-8';
			$body                      = (string) $body;
		} elseif ( is_string( $body ) ) {
			$headers['content-type'] ??= 'text/plain;charset=UTF-8';
		} elseif ( null !== $body ) {
			throw new JsError( 'fetch() body must be a string or URLSearchParams', 'TypeError' );
		}
		$max_body = self::maxBody();
		if ( null !== $body && strlen( $body ) > $max_body ) {
			throw self::refuse( 'sp_fetch_payload_too_large', 'The fetch request body is too large.' );
		}
		if ( null !== $body && in_array( $method, array( 'GET', 'HEAD' ), true ) ) {
			throw new JsError( "Request with $method method cannot have body.", 'TypeError' );
		}
		$deadline = microtime( true ) + self::timeout();
		for ( $hop = 0; ; $hop++ ) {
			[$host, $port, $address] = self::target( $url, $hosts );
			$remaining               = $deadline - microtime( true );
			if ( $remaining <= 0 ) {
				throw self::refuse( 'sp_fetch_timeout', 'The fetch target did not answer in time.' );
			}
			$response = self::send( $url, $host, $port, $address, $method, $headers, $body, $remaining );
			$status   = $response['status'];
			$location = $response['headers']['location'] ?? null;
			if ( 'manual' !== $redirect && in_array( $status, array( 301, 302, 303, 307, 308 ), true ) && is_string( $location ) ) {
				if ( 'error' === $redirect ) {
					throw self::refuse( 'sp_fetch_redirect_denied', 'The fetch target redirected and redirect is "error".' );
				}
				if ( $hop >= self::MAX_REDIRECTS ) {
					throw self::refuse( 'sp_fetch_too_many_redirects', 'The fetch target redirected too many times.' );
				}
				$url = self::resolveUrl( $url, $location );
				// Like browsers: 303, and 301/302 for POST, become GET without a body.
				if ( 303 === $status || ( in_array( $status, array( 301, 302 ), true ) && 'POST' === $method ) ) {
					$method = 'HEAD' === $method ? 'HEAD' : 'GET';
					$body   = null;
					unset( $headers['content-type'] );
				}
				// Credentials never follow a redirect to another origin: scheme, host and effective
				// port (scheme is always https here, so host and port decide).
				[$next_host, $next_port] = self::origin( $url );
				if ( $next_host !== $host || $next_port !== $port ) {
					unset( $headers['authorization'], $headers['cookie'] );
				}
				continue;
			}
			return new FetchResponse(
				$status,
				$response['statusText'],
				$url,
				$hop > 0,
				FetchHeaders::received( $response['headers'] ),
				'HEAD' === $method ? '' : $response['body']
			);
		}
	}

	/**
	 * `headers` as an object, an array of pairs or a Headers, validated as Headers does.
	 *
	 * @return array<string, string> lowercase names
	 */
	private static function request_headers( mixed $headers ): array {
		$out = array();
		foreach ( ( new FetchHeaders( $headers ) )->sorted() as $name => $value ) {
			if ( ! in_array( $name, self::DROP_REQUEST, true ) ) {
				$out[ $name ] = $value;
			}
		}

		return $out;
	}

	/** @return array{string, int, string} host, port and the checked address to connect to */
	public static function target( string $url, ?array $hosts = null ): array {
		$parts = parse_url( $url );
		if ( ! is_array( $parts ) || strtolower( $parts['scheme'] ?? '' ) !== 'https' || ! isset( $parts['host'] ) ) {
			throw self::refuse( 'sp_fetch_scheme_denied', 'fetch() reaches HTTPS URLs only.' );
		}
		if ( isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			throw self::refuse( 'sp_fetch_credentials_denied', 'fetch() URLs cannot carry credentials.' );
		}
		$host = self::host( $parts['host'] );
		if ( '' === $host || 'localhost' === $host || str_ends_with( $host, '.localhost' ) ) {
			throw self::refuse( 'sp_fetch_host_denied', 'The fetch host is not permitted.' );
		}
		if ( null !== $hosts && ! in_array( $host, $hosts, true ) ) {
			throw self::refuse( 'sp_fetch_host_denied', 'The fetch host is outside this plugin\'s grant.' );
		}
		foreach ( self::INTERNAL as $internal ) {
			if ( $host === $internal || str_ends_with( $host, '.' . $internal ) ) {
				throw self::refuse( 'sp_fetch_host_denied', 'The fetch host is not permitted.' );
			}
		}
		$port      = (int) ( $parts['port'] ?? 443 );
		$addresses = filter_var( $host, FILTER_VALIDATE_IP ) !== false ? array( $host ) : self::resolve( $host );
		if ( array() === $addresses ) {
			throw self::refuse( 'sp_fetch_upstream_unavailable', 'The fetch target could not be reached.' );
		}
		// Every address the name answers with must be public: a mixed answer is refused, not filtered.
		// `sp_fetch_allow_address` lets a trusted site plugin open one named internal target
		// (a test receiver, a sidecar); request input can never reach it.
		foreach ( $addresses as $address ) {
			$open = function_exists( 'apply_filters' ) && apply_filters( 'sp_fetch_allow_address', false, $address, $host, $port ) === true;
			if ( ! $open && ! self::allowed( $address ) ) {
				throw self::refuse( 'sp_fetch_address_denied', 'The fetch target address is not permitted.' );
			}
		}

		return array( $host, $port, $addresses[0] );
	}

	/** @return list<string> */
	private static function resolve( string $host ): array {
		if ( null !== self::$resolver ) {
			return ( self::$resolver )( $host );
		}
		// A trusted plugin may answer for a name the site resolves privately; answers still pass
		// the address policy (and `sp_fetch_allow_address`).
		$answer = function_exists( 'apply_filters' ) ? apply_filters( 'sp_fetch_resolve', null, $host ) : null;
		if ( is_array( $answer ) ) {
			return array_values( array_filter( $answer, 'is_string' ) );
		}
		$out = array();
		foreach ( array( DNS_A, DNS_AAAA ) as $type ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- DNS failures use the empty-result path below.
			$records = @dns_get_record( $host, $type );
			foreach ( false === $records ? array() : $records as $record ) {
				$ip = $record['ip'] ?? $record['ipv6'] ?? null;
				if ( is_string( $ip ) ) {
					$out[] = $ip;
				}
			}
		}
		if ( array() === $out ) {
			$ip = gethostbyname( $host );
			if ( $ip !== $host ) {
				$out[] = $ip;
			}
		}

		return array_values( array_unique( $out ) );
	}

	public static function allowed( string $address ): bool {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Handle invalid addresses via the false return value.
		$packed = @inet_pton( $address );
		if ( false === $packed ) {
			return false;
		}
		if ( strlen( $packed ) === 16 && str_starts_with( $packed, str_repeat( "\0", 10 ) . "\xff\xff" ) ) {
			$packed = substr( $packed, 12 );
		}
		$denied = strlen( $packed ) === 4 ? self::DENIED_V4 : self::DENIED_V6;
		foreach ( $denied as [$network, $prefix] ) {
			if ( self::contains( $packed, (string) inet_pton( $network ), $prefix ) ) {
				return false;
			}
		}

		return true;
	}

	private static function contains( string $address, string $network, int $prefix ): bool {
		$bytes = intdiv( $prefix, 8 );
		if ( strncmp( $address, $network, $bytes ) !== 0 ) {
			return false;
		}
		$bits = $prefix % 8;
		if ( 0 === $bits ) {
			return true;
		}
		$mask = ( 0xff << ( 8 - $bits ) ) & 0xff;

		return ( ord( $address[ $bytes ] ) & $mask ) === ( ord( $network[ $bytes ] ) & $mask );
	}

	/** @return array{status: int, statusText: string, headers: array<string, string>, body: string} */
	private static function send( string $url, string $host, int $port, string $address, string $method, array $headers, ?string $body, float $timeout ): array {
		if ( ! function_exists( 'wp_remote_request' ) ) {
			throw new \LogicException( 'fetch() needs WordPress loaded (wp_remote_request)' );
		}
		// Pin the connection to the address checked above. Only the cURL transport can pin: any
		// other transport would resolve the name again, and could connect to a rebound address. So
		// the request is sent with cURL or not at all, and the pin runs before cURL connects.
		if ( ! class_exists( \WpOrg\Requests\Transport\Curl::class ) || ! \WpOrg\Requests\Transport\Curl::test( array( 'ssl' => true ) ) ) {
			throw self::refuse( 'sp_fetch_upstream_unavailable', 'Outbound fetch needs the cURL transport to pin the checked address.' );
		}
		// The URL cURL sees names exactly the host the pin covers: `example.com.` and `EXAMPLE.com`
		// would otherwise miss the CURLOPT_RESOLVE entry and let cURL resolve the name itself.
		$url    = self::with_host( $url, $host );
		$pinned = false;
		$handle = null;
		$pin    = static function ( $curl ) use ( $host, $port, $address, &$pinned, &$handle ): void {
			$handle = $curl;
			$pinned = self::pin( $curl, $host, $port, $address );
		};
		$force  = static function ( &$url, &$headers, &$data, &$type, &$options ): void {
			$options['transport'] = \WpOrg\Requests\Transport\Curl::class;
		};
		add_action( 'http_api_curl', $pin, PHP_INT_MAX );
		add_action( 'requests-requests.before_request', $force, PHP_INT_MAX, 5 );
		$max_body = self::maxBody();
		try {
			$response = wp_remote_request(
				$url,
				array(
					'method'              => $method,
					'headers'             => $headers,
					'body'                => $body,
					'timeout'             => max( 1, (int) ceil( $timeout ) ),
					'redirection'         => 0,
					'limit_response_size' => $max_body + 1,
					'reject_unsafe_urls'  => false,
					'sslverify'           => true,
					'user-agent'          => 'SpacePress (WordPress)',
					'decompress'          => true,
				)
			);
		} finally {
			remove_action( 'http_api_curl', $pin, PHP_INT_MAX );
			remove_action( 'requests-requests.before_request', $force, PHP_INT_MAX );
		}
		// Fail closed: a request the pin did not reach, or that connected anywhere but the checked
		// address (a later `http_api_curl` hook rewrote the handle), returns nothing to the handler.
		if ( ! $pinned || ! $handle instanceof \CurlHandle || ! self::same_address( (string) curl_getinfo( $handle, CURLINFO_PRIMARY_IP ), $address ) ) {
			throw self::refuse( 'sp_fetch_upstream_unavailable', 'Outbound fetch needs the cURL transport to pin the checked address.' );
		}
		if ( is_wp_error( $response ) ) {
			throw self::refuse( 'sp_fetch_upstream_unavailable', 'The fetch target could not be reached.' );
		}
		$raw = (string) wp_remote_retrieve_body( $response );
		if ( strlen( $raw ) > $max_body ) {
			throw self::refuse( 'sp_fetch_response_too_large', 'The fetch response is too large.' );
		}
		$out = array();
		foreach ( wp_remote_retrieve_headers( $response ) as $name => $value ) {
			$name = strtolower( (string) $name );
			if ( ! in_array( $name, self::DROP_RESPONSE, true ) ) {
				$out[ $name ] = is_array( $value ) ? implode( ', ', $value ) : (string) $value;
			}
		}

		return array(
			'status'     => (int) wp_remote_retrieve_response_code( $response ),
			'statusText' => self::status_text( $response ),
			'headers'    => $out,
			'body'       => $raw,
		);
	}

	/**
	 * The reason phrase the server sent, as fetch's `statusText`. WordPress replaces it with its own
	 * text for the code, so read the status line of the raw response when Requests kept it.
	 */
	private static function status_text( array $response ): string {
		$object = $response['http_response'] ?? null;
		$raw    = is_object( $object ) && method_exists( $object, 'get_response_object' ) ? $object->get_response_object()->raw ?? null : null;
		if ( is_string( $raw ) && preg_match( '#\AHTTP/\S+ \d{3}(?: ([^\r\n]*))?\r?\n#', $raw, $m ) === 1 ) {
			return $m[1] ?? '';
		}

		return (string) wp_remote_retrieve_response_message( $response );
	}

	/** The URL with its host replaced by the normalized one the address check and pin used. */
	private static function with_host( string $url, string $host ): string {
		$parts     = parse_url( $url );
		$authority = ( str_contains( $host, ':' ) ? '[' . $host . ']' : $host ) . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );

		return 'https://' . $authority . ( $parts['path'] ?? '' ) . ( isset( $parts['query'] ) ? '?' . $parts['query'] : '' );
	}

	/**
	 * Pins `$curl` to the checked address before it connects. When an option can't be set, the
	 * handle is pointed at an address nothing listens on and limited to connecting, so no request
	 * byte leaves. Where cURL offers a pre-request hook (PHP 8.4+), the connected address is
	 * checked again there, after every other `http_api_curl` hook has run, and a mismatch aborts
	 * before the request is sent.
	 *
	 * @param null|callable(\CurlHandle, int, mixed): bool $setopt `curl_setopt` unless a test replaces it
	 */
	public static function pin( \CurlHandle $curl, string $host, int $port, string $address, ?callable $setopt = null ): bool {
		$setopt ??= curl_setopt( ... );
		$ip       = str_contains( $address, ':' ) ? '[' . $address . ']' : $address;
		$pinned   = $setopt( $curl, CURLOPT_RESOLVE, array( "$host:$port:$ip" ) )
			&& $setopt( $curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS );
		if ( $pinned && defined( 'CURLOPT_PREREQFUNCTION' ) ) {
			$pinned = $setopt( $curl, CURLOPT_PREREQFUNCTION, static fn ( $h, string $connected ): int => self::same_address( $connected, $address ) ? CURL_PREREQFUNC_OK : CURL_PREREQFUNC_ABORT );
		}
		if ( ! $pinned ) {
			curl_setopt( $curl, CURLOPT_URL, 'https://0.0.0.0:0/' );
			curl_setopt( $curl, CURLOPT_CONNECT_ONLY, true );
		}

		return $pinned;
	}

	private static function same_address( string $a, string $b ): bool {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Handle invalid addresses via the false return value.
		$a = @inet_pton( trim( $a, '[]' ) );
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- Handle invalid addresses via the false return value.
		$b = @inet_pton( trim( $b, '[]' ) );

		return false !== $a && $a === $b;
	}

	/** @return array{string, int} lowercase host and effective port of an https URL */
	private static function origin( string $url ): array {
		$parts = parse_url( $url );

		return array( self::host( (string) ( $parts['host'] ?? '' ) ), (int) ( $parts['port'] ?? 443 ) );
	}

	/**
	 * The one spelling of a URL's host that the policy, the pin and the redirect origin check all
	 * use: lowercase, brackets off, and a trailing root dot dropped (`Example.COM.` is
	 * `example.com`). A name with an empty label (`.a.com`, `a..com`) normalizes to '' and is refused.
	 */
	private static function host( string $host ): string {
		$host = strtolower( rtrim( trim( $host, "[] \t\n\r\0\x0B" ), '.' ) );

		return str_starts_with( $host, '.' ) || str_contains( $host, '..' ) ? '' : $host;
	}

	/** A Location header resolved against the request URL as RFC 3986 §5.2 does; fragments drop. */
	// phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Keep the existing public method signature.
	public static function resolveUrl( string $base, string $location ): string {
		$location = (string) preg_replace( '/#.*\z/s', '', $location );
		if ( preg_match( '#\A[a-z][a-z0-9+.-]*:#i', $location ) === 1 ) {
			return $location;
		}
		$b          = parse_url( $base );
		$authority  = $b['host'] . ( isset( $b['port'] ) ? ':' . $b['port'] : '' );
		$base_path  = $b['path'] ?? '/';
		$base_query = isset( $b['query'] ) ? '?' . $b['query'] : '';
		if ( str_starts_with( $location, '//' ) ) {
			return 'https:' . $location;
		}
		[$path, $query] = array_pad( explode( '?', $location, 2 ), 2, null );
		$query          = null === $query ? '' : '?' . $query;
		if ( '' === $path ) {
			// `?page=2` keeps the whole base path; an empty reference keeps the base query too.
			return 'https://' . $authority . $base_path . ( '' !== $query ? $query : $base_query );
		}
		$merged = str_starts_with( $path, '/' ) ? $path : preg_replace( '#/[^/]*\z#', '/', $base_path ) . $path;

		return 'https://' . $authority . self::remove_dots( $merged ) . $query;
	}

	/** RFC 3986 §5.2.4: drop `.` segments and fold `..` into their parent. */
	private static function remove_dots( string $path ): string {
		$out      = array();
		$segments = explode( '/', $path );
		foreach ( $segments as $i => $segment ) {
			if ( '.' === $segment || '..' === $segment ) {
				if ( '..' === $segment && count( $out ) > 1 ) {
					array_pop( $out );
				}
				if ( count( $segments ) - 1 === $i ) {
					$out[] = '';
				}
				continue;
			}
			$out[] = $segment;
		}
		$result = implode( '/', $out );

		return str_starts_with( $result, '/' ) ? $result : '/' . $result;
	}

	private static function refuse( string $code, string $message ): HttpError {
		return new HttpError( 502, $code, $message );
	}
}
