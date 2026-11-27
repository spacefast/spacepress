<?php

declare(strict_types=1);

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

use SpacePress\Crypto;
use SpacePress\Env;
use SpacePress\HttpError;
use SpacePress\JsError;
use SpacePress\JsObject;

// Published test vectors, plus the other digests.
eq(
	'SHA-256 of "abc" is the FIPS 180-2 B.1 digest',
	Crypto::hash( 'sha256', array( 'abc' ), 'hex' ),
	'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
);
eq(
	'digests are over the UTF-8 bytes of every update, in hex, base64 or base64url',
	array(
		Crypto::hash( 'sha1', array( 'abc' ), 'hex' ),
		Crypto::hash( 'md5', array( '' ), 'hex' ),
		substr( Crypto::hash( 'SHA512', array( 'abc' ), 'hex' ), 0, 16 ),
		substr( Crypto::hash( 'sha384', array( 'abc' ), 'hex' ), 0, 16 ),
		Crypto::hash( 'sha256', array( 'é' ), 'hex' ),
		Crypto::hash( 'sha256', array( 'a', 'bc' ), 'base64' ),
		Crypto::hash( 'sha256', array( 'abc' ), 'base64url' ),
	),
	array(
		'a9993e364706816aba3e25717850c26c9cd0d89d',
		'd41d8cd98f00b204e9800998ecf8427e',
		'ddaf35a193617aba',
		'cb00753f45a35e8b',
		hash( 'sha256', "\xc3\xa9" ),
		'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
		'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
	)
);

Env::isolate(
	array(
		'WEBHOOK_SECRET' => " Jefe \n",
		'EMPTY_SECRET'   => '  ',
	)
);
eq(
	'HMAC matches RFC 4231 cases 1 and 2, with a key as given and a key read from process.env (trimmed)',
	array(
		Crypto::hmac( 'sha256', str_repeat( "\x0b", 20 ), array( 'Hi There' ), 'hex' ),
		Crypto::hmacEnv( 'sha256', 'WEBHOOK_SECRET', array( 'what do ya ', 'want for nothing?' ), 'hex' ),
	),
	array(
		'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
		'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
	)
);
$code = static function ( callable $f ): string {
	try {
		$f();
		return 'ok';
	} catch ( HttpError $e ) {
		return $e->errorCode;
	} catch ( JsError $e ) {
		return $e->jsName . ': ' . $e->getMessage();
	}
};
eq(
	'a missing or blank process.env key is crypto_key_unavailable; bad inputs throw as Node does',
	array(
		$code( fn () => Crypto::hmacEnv( 'sha256', 'MISSING', array( 'x' ), 'hex' ) ),
		$code( fn () => Crypto::hmacEnv( 'sha256', 'EMPTY_SECRET', array( 'x' ), 'hex' ) ),
		$code( fn () => Crypto::hash( 'whirlpool', array( 'x' ), 'hex' ) ),
		$code( fn () => Crypto::hash( 'sha256', array( null ), 'hex' ) ),
		$code( fn () => Crypto::hash( 'sha256', array( str_repeat( 'x', Crypto::MAX_DATA ), 'x' ), 'hex' ) ),
		// A key is capped like the data it signs.
		$code( fn () => Crypto::hmac( 'sha256', str_repeat( 'k', Crypto::MAX_DATA + 1 ), array( 'x' ), 'hex' ) ),
	),
	array(
		'crypto_key_unavailable',
		'crypto_key_unavailable',
		'Error: Digest method not supported',
		'TypeError: Hash.update needs a string',
		'crypto_input_too_large',
		'crypto_input_too_large',
	)
);
eq( 'a key at the cap still signs', strlen( Crypto::hmac( 'sha256', str_repeat( 'k', Crypto::MAX_DATA ), array( 'x' ), 'hex' ) ), 64 );
Env::isolate( array() );

eq(
	'timingSafeEqual compares UTF-8 bytes and throws on different byte lengths, as Node does',
	array(
		Crypto::timingSafeEqual( 'abc', 'abc' ),
		Crypto::timingSafeEqual( 'abc', 'abd' ),
		$code( fn () => Crypto::timingSafeEqual( 'é', 'e' ) ),
	),
	array( true, false, 'RangeError: Input buffers must have the same byte length' )
);

$uuid = Crypto::randomUUID();
eq(
	'randomUUID is RFC 4122 version 4; randomBytes has the asked length in each encoding',
	array(
		preg_match( '/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $uuid ),
		strlen( Crypto::randomBytes( 16, 'hex' ) ),
		Crypto::randomBytes( 8, 'hex' ) === Crypto::randomBytes( 8, 'hex' ),
		Crypto::randomBytes( 0, 'base64' ),
		strlen( Crypto::randomBytes( 9, 'base64' ) ),
		$code( fn () => Crypto::randomBytes( 1025, 'hex' ) ),
		$code( fn () => Crypto::randomBytes( 1.5, 'hex' ) ),
	),
	array( 1, 32, false, '', 12, 'RangeError: randomBytes takes 0 to 1024 bytes in SpacePress code', 'RangeError: The "size" argument must be a whole number' )
);

finish( 'crypto' );
