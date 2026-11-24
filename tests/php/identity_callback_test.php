<?php

declare(strict_types=1);

/*
 * SpacePress Identity's provider callback under a host route prefix, over HTTP on WordPress with php -S.
 * The site defines SP_AUTH_PREFIX=/__spacefast/auth, and two OpenID providers answer from a stand-in
 * on `pre_http_request` that signs real RS256 ID tokens and checks the redirect URI and PKCE verifier
 * of each code exchange. One provider is registered with the path form
 * (`/__spacefast/auth/callback/spacefast`, chosen through `sp_identity_callback_url`), the other keeps
 * the default query form (`/__spacefast/auth/provider/callback?provider=generic`). Both sign in.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// Identity's issuer pages answer on template_redirect, which the test router runs only with themes on.
putenv( 'SP_WP_THEMES=1' );

$key = openssl_pkey_new(
	array(
		'private_key_bits' => 2048,
		'private_key_type' => OPENSSL_KEYTYPE_RSA,
	)
);
openssl_pkey_export( $key, $pem );
$provider = str_replace(
	'{PEM}',
	var_export( $pem, true ),
	<<<'PHP'
<?php
// php -S speaks HTTP only; Identity allows that on a local site with this switch.
define('SP_IDENTITY_DEV_HTTP', true);
// The host's issuer prefix, as Spacefast sets it.
define('SP_AUTH_PREFIX', '/__spacefast/auth');

const TEST_IDP = 'http://127.0.0.1:8080/idp';
add_filter('sp_identity_providers', static fn (array $providers): array => $providers + [
    'spacefast' => ['issuer' => TEST_IDP . '/spacefast', 'client_id' => 'spacefast-client', 'secret' => ''],
    'generic' => ['issuer' => TEST_IDP . '/generic', 'client_id' => 'generic-client', 'secret' => 'generic-secret'],
]);
// The Spacefast provider is registered with the path form; every other provider keeps the default.
add_filter('sp_identity_callback_url', static fn (string $url, string $name, string $path): string => $name === 'spacefast' ? $path : $url, 10, 3);
// The stand-in issuers live on a loopback address WordPress treats as internal.
add_filter('http_request_host_is_external', static fn (bool $external, string $host): bool => $external || $host === '127.0.0.1', 10, 2);

add_filter('pre_http_request', static function (mixed $pre, array $args, string $url): mixed {
    if (!str_starts_with($url, TEST_IDP . '/')) {
        return $pre;
    }
    $b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $answer = static fn (array $body, int $status = 200): array => ['headers' => [], 'body' => json_encode($body), 'response' => ['code' => $status, 'message' => 'OK'], 'cookies' => [], 'filename' => null];
    $pem = {PEM};
    [, $name, $endpoint] = explode('/', substr($url, strlen(TEST_IDP)), 3) + [2 => ''];
    $issuer = TEST_IDP . '/' . $name;
    $endpoint = (string) parse_url('/' . $endpoint, PHP_URL_PATH);
    if ($endpoint === '/.well-known/openid-configuration') {
        return $answer(['issuer' => $issuer, 'authorization_endpoint' => "$issuer/authorize", 'token_endpoint' => "$issuer/token",
            'userinfo_endpoint' => "$issuer/userinfo", 'jwks_uri' => "$issuer/jwks"]);
    }
    if ($endpoint === '/jwks') {
        $rsa = openssl_pkey_get_details(openssl_pkey_get_private($pem))['rsa'];
        return $answer(['keys' => [['kty' => 'RSA', 'kid' => 'test', 'alg' => 'RS256', 'use' => 'sig', 'n' => $b64($rsa['n']), 'e' => $b64($rsa['e'])]]]);
    }
    if ($endpoint === '/token') {
        // The code is what the authorize step granted: the client, redirect URI, PKCE challenge and nonce.
        $body = (array) $args['body'];
        $grant = json_decode((string) base64_decode(strtr((string) ($body['code'] ?? ''), '-_', '+/')), true);
        if (!is_array($grant) || $grant['client_id'] !== ($body['client_id'] ?? null) || $grant['redirect_uri'] !== ($body['redirect_uri'] ?? null)
            || $b64(hash('sha256', (string) ($body['code_verifier'] ?? ''), true)) !== $grant['code_challenge']) {
            return $answer(['error' => 'invalid_grant'], 400);
        }
        $claims = ['iss' => $issuer, 'aud' => $grant['client_id'], 'sub' => "$name-subject", 'iat' => time() - 1, 'exp' => time() + 300, 'nonce' => $grant['nonce']];
        $token = \SpacePress\Identity\Vendor\Firebase\JWT\JWT::encode($claims, $pem, 'RS256', 'test');
        return $answer(['access_token' => "$name-access", 'token_type' => 'Bearer', 'expires_in' => 300, 'id_token' => $token]);
    }
    if ($endpoint === '/userinfo') {
        return $answer(['sub' => "$name-subject", 'email' => "$name-user@example.test", 'email_verified' => true, 'name' => "$name user"]);
    }
    return $answer(['error' => 'not_found'], 404);
}, 10, 3);
PHP
);

$site = wpSite(
	'identity-callback',
	array(
		'schema'    => array(
			'name'        => 'callback',
			'collections' => array(),
		),
		'identity'  => true,
		'muPlugins' => array( 'identity-provider' => $provider ),
	)
);
$site->startServer();
$url = $site->url();

/** One request with a cookie jar and no redirects: [status, Location, Set-Cookie names]. */
function visit( string $target, string $jar ): array {
	$ch = curl_init( $target );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HEADER         => true,
			CURLOPT_FOLLOWLOCATION => false,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_COOKIEFILE     => $jar,
			CURLOPT_COOKIEJAR      => $jar,
		)
	);
	$response = (string) curl_exec( $ch );
	$status   = curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
	$head     = substr( $response, 0, curl_getinfo( $ch, CURLINFO_HEADER_SIZE ) );
	preg_match( '/^Location: (.+)$/mi', $head, $location );
	preg_match_all( '/^Set-Cookie: ([^=]+)=/mi', $head, $cookies );
	return array( $status, trim( $location[1] ?? '' ), $cookies[1], substr( $response, strlen( $head ) ) );
}

/** The provider's authorize step: what it would redirect the browser back to, with a code it can check. */
function authorize( string $location ): array {
	parse_str( (string) parse_url( $location, PHP_URL_QUERY ), $request );
	$code = rtrim(
		strtr(
			base64_encode(
				json_encode(
					array(
						'client_id'      => $request['client_id'],
						'redirect_uri'   => $request['redirect_uri'],
						'code_challenge' => $request['code_challenge'],
						'nonce'          => $request['nonce'],
					)
				)
			),
			'+/',
			'-_'
		),
		'='
	);
	$back = $request['redirect_uri'] . ( str_contains( $request['redirect_uri'], '?' ) ? '&' : '?' ) . http_build_query(
		array(
			'code'  => $code,
			'state' => $request['state'],
		)
	);
	return array( $request, $back );
}

$prefix = '/__spacefast/auth';
eq(
	'the issuer and its callbacks live under SP_AUTH_PREFIX',
	array( \SpacePress\Identity\Plugin::basePath(), \SpacePress\Identity\Providers::callbackUrl( 'spacefast' ), \SpacePress\Identity\Providers::callbackUrl( 'generic' ) ),
	array( $prefix, "$url$prefix/callback/spacefast", "$url$prefix/provider/callback?provider=generic" )
);
eq(
	'both callback forms name their provider; other routes name none',
	array(
		\SpacePress\Identity\Providers::callbackProvider( '/callback/spacefast', array() ),
		\SpacePress\Identity\Providers::callbackProvider( '/provider/callback', array( 'provider' => 'generic' ) ),
		\SpacePress\Identity\Providers::callbackProvider( '/callback/spacefast/extra', array() ),
		\SpacePress\Identity\Providers::callbackProvider( '/authorize', array( 'provider' => 'generic' ) ),
	),
	array( 'spacefast', 'generic', null, null )
);

$signIn = static function ( string $name, string $expectedCallback ) use ( $url, $prefix ): array {
	$jar                               = tempnam( sys_get_temp_dir(), 'sp-identity-jar' );
	[$status, $location, , $startBody] = visit( "$url$prefix/provider/start?provider=$name", $jar );
	if ( '' === $location ) {
		throw new RuntimeException( "provider/start answered $status without a redirect: " . substr( $startBody, 0, 600 ) );
	}
	[$request, $back]                     = authorize( $location );
	$started                              = array( $status, str_starts_with( $location, "http://127.0.0.1:8080/idp/$name/authorize?" ), $request['redirect_uri'] );
	[$status, $location, $cookies, $body] = visit( $back, $jar );
	@unlink( $jar );
	return array( $started, array( $status, $location, in_array( 'zi_session', $cookies, true ) ), $body, array( $status, $location, $cookies, $back ) );
};

[$started, $finished, $body, $debug] = $signIn( 'spacefast', "$url$prefix/callback/spacefast" );
eq( 'the Spacefast provider starts with the path-form redirect URI under the prefix', $started, array( 302, true, "$url$prefix/callback/spacefast" ) );
check( 'its callback at /__spacefast/auth/callback/spacefast signs the browser in and returns to the issuer', $finished === array( 302, "$url$prefix", true ), array( $finished, $debug, substr( $body, 0, 400 ) ) );

[$started, $finished, $body, $debug] = $signIn( 'generic', "$url$prefix/provider/callback?provider=generic" );
eq( 'a generic provider keeps the query-form redirect URI, under the prefix', $started, array( 302, true, "$url$prefix/provider/callback?provider=generic" ) );
check( 'its callback at /__spacefast/auth/provider/callback?provider=generic signs the browser in', $finished === array( 302, "$url$prefix", true ), array( $finished, $debug, substr( $body, 0, 400 ) ) );

$db = \SpacePress\Identity\Plugin::$db;
eq(
	'each provider identity is linked to its own new account',
	array_map( static fn ( array $row ): string => $row['subject'], $db->rows( "SELECT subject FROM {$db->prefix}providers ORDER BY subject" ) ),
	array( 'generic-subject', 'spacefast-subject' )
);

// A callback for one provider can't finish a sign-in another provider started.
$jar                 = tempnam( sys_get_temp_dir(), 'sp-identity-jar' );
[, $location]        = visit( "$url$prefix/provider/start?provider=generic", $jar );
[, $back]            = authorize( $location );
$crossed             = str_replace( "$prefix/provider/callback?provider=generic&", "$prefix/callback/spacefast?", $back );
[$status, , , $body] = visit( $crossed, $jar );
@unlink( $jar );
eq( 'a path-form callback naming another provider is refused', array( $status, json_decode( $body, true )['error'] ?? null ), array( 400, 'invalid_state' ) );

finish( 'identity_callback' );
