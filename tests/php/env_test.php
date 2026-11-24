<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\Env;

define( 'SP_ENV_CONSTANT', 'standalone-constant' );
putenv( 'SP_ENV_PROCESS=standalone-process' );
eq(
	'standalone env reads process values and WordPress constants',
	array( Env::get( 'SP_ENV_PROCESS' ), Env::resolve( array( 'env' => 'SP_ENV_CONSTANT' ) ) ),
	array( 'standalone-process', 'standalone-constant' )
);

Env::isolate(
	array(
		'APP_VALUE'      => 'space-version',
		'SP_ENV_PROCESS' => '',
	)
);
eq(
	'managed env preserves values and empty overrides without ambient fallback',
	array( Env::get( 'APP_VALUE' ), Env::get( 'SP_ENV_PROCESS' ), Env::resolve( array( 'env' => 'SP_ENV_CONSTANT' ) ), Env::get( 'MISSING' ), Env::resolve( 'literal' ) ),
	array( 'space-version', '', null, null, 'literal' )
);

Env::isolate( array() );
eq(
	'an empty managed scope denies all ambient values',
	array( Env::get( 'APP_VALUE' ), Env::get( 'SP_ENV_PROCESS' ), Env::get( 'SP_ENV_CONSTANT' ) ),
	array( null, null, null )
);

define( 'DB_PASSWORD', 'box-database-password' );
define( 'LOGGED_IN_SALT', 'box-salt' );
define( 'SECRET_KEY', 'legacy-salt' );
define( 'WP_SECRETS_KEY', 'secrets-api-site-key' );
putenv( 'HTTP_COOKIE=wordpress_logged_in_x=platform-session' );
putenv( 'HTTP_PROXY=http://attacker.example' );
putenv( 'PHP_AUTH_PW=basic-password' );
Env::isolate(
	array(
		'DB_PASSWORD' => 'from-a-variable',
		'HTTP_PROXY'  => 'http://proxy.internal:3128',
		'DB_URL'      => 'mysql://app',
		'APP_VALUE'   => 'kept',
	)
);
eq(
	'an isolated host never passes WordPress secrets, but its own variables keep request-like names',
	array( Env::get( 'DB_PASSWORD' ), Env::get( 'db_password' ), Env::get( 'HTTP_PROXY' ), Env::get( 'DB_URL' ), Env::get( 'HTTP_COOKIE' ), Env::get( 'APP_VALUE' ) ),
	array( null, null, 'http://proxy.internal:3128', 'mysql://app', null, 'kept' )
);
( static function (): void {
	$scope = new ReflectionProperty( Env::class, 'variables' );
	$scope->setValue( null, null );
} )();
eq(
	'standalone lookup never falls back to WordPress secrets or per-request server values',
	array( Env::get( 'DB_PASSWORD' ), Env::get( 'LOGGED_IN_SALT' ), Env::get( 'SECRET_KEY' ), Env::get( 'WP_SECRETS_KEY' ), Env::get( 'HTTP_COOKIE' ), Env::get( 'HTTP_PROXY' ), Env::get( 'PHP_AUTH_PW' ), Env::resolve( array( 'env' => 'DB_PASSWORD' ) ), Env::get( 'SP_ENV_CONSTANT' ) ),
	array( null, null, null, null, null, null, null, null, 'standalone-constant' )
);
eq(
	'host secrets are exact names; request values are prefixes',
	array(
		array_map( array( Env::class, 'hostSecret' ), array( 'db_host', 'DB_URL', 'NONCE_KEY', 'SECRET_SALT', 'wp_secrets_key_previous', 'WEBHOOK_SECRET' ) ),
		array_map( array( Env::class, 'requestValue' ), array( 'HTTP_X_ANYTHING', 'query_string', 'PHP_AUTH_USER', 'REMOTE_USER', 'HTTPS_ONLY', 'SP_NOW' ) ),
	),
	array( array( true, false, true, true, true, false ), array( true, true, true, true, false, false ) )
);
eq(
	'core\'s filesystem and proxy credentials are WordPress secrets too',
	array_map( array( Env::class, 'hostSecret' ), array( 'FTP_PASS', 'ftp_privkey', 'FTP_USER', 'FTP_PUBKEY', 'WP_PROXY_USERNAME', 'WP_PROXY_PASSWORD', 'WP_PROXY_HOST' ) ),
	array( true, true, true, true, true, true, false )
);
eq(
	'CGI meta-variables are request values by exact name; an app\'s look-alike names are not',
	array_map(
		array( Env::class, 'requestValue' ),
		array(
			'QUERY_STRING',
			'REQUEST_URI',
			'PATH_INFO',
			'CONTENT_TYPE',
			'REMOTE_ADDR',
			'SCRIPT_FILENAME',
			'ORIG_SCRIPT_NAME',
			'REDIRECT_STATUS',
			'REDIRECT_URI',
			'SERVER_URL',
			'URL',
			'PATH',
			'CONTENT_API_KEY',
			'REQUEST_TIMEOUT',
		)
	),
	array( true, true, true, true, true, true, true, true, false, false, false, false, false, false )
);
( static function (): void {
	putenv( 'QUERY_STRING=visitor=1' );
	putenv( 'REDIRECT_URI=https://app.example/process' );
	define( 'FTP_PASS', 'ftp-secret' );
	define( 'WP_PROXY_PASSWORD', 'proxy-secret' );
	define( 'QUERY_STRING', 'from-wp-config' );
} )();
eq(
	'standalone: a request value never comes from the process environment, but a wp-config constant of that name still reads; core credentials never read',
	array( Env::get( 'QUERY_STRING' ), Env::get( 'REDIRECT_URI' ), Env::get( 'FTP_PASS' ), Env::get( 'WP_PROXY_PASSWORD' ) ),
	array( 'from-wp-config', 'https://app.example/process', null, null )
);
putenv( 'QUERY_STRING' );
putenv( 'REDIRECT_URI' );

putenv( 'HTTP_COOKIE' );
putenv( 'HTTP_PROXY' );
putenv( 'PHP_AUTH_PW' );
putenv( 'SP_ENV_PROCESS' );
finish( 'env' );
