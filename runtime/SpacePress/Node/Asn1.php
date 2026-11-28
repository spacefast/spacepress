<?php
declare(strict_types=1);
namespace SpacePress\Node;

use SpacePress\JsError;

/** The DER structures PHP's OpenSSL bindings cannot export or configure directly. */
final class Asn1 {

	private const ED_PRIVATE  = "\x30\x2e\x02\x01\x00\x30\x05\x06\x03\x2b\x65\x70\x04\x22\x04\x20";
	private const ED_PUBLIC   = "\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
	private const EC_CURVES   = array(
		'prime256v1' => "\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07",
		'secp384r1'  => "\x06\x05\x2b\x81\x04\x00\x22",
	);
	private const DIGEST_OIDS = array(
		'sha1'   => "\x06\x05\x2b\x0e\x03\x02\x1a",
		'sha224' => "\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x04",
		'sha256' => "\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x01",
		'sha384' => "\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x02",
		'sha512' => "\x06\x09\x60\x86\x48\x01\x65\x03\x04\x02\x03",
	);

	public static function pem( string $der, string $label ): string {
		return "-----BEGIN $label-----\n" . chunk_split( base64_encode( $der ), 64, "\n" ) . "-----END $label-----\n";
	}

	public static function unpem( string $pem ): ?string {
		return self::parse_pem( $pem )[1] ?? null;
	}

	/** Decode an in-memory PEM envelope without forwarding a PHP stream URI to OpenSSL. */
	public static function parse_pem( string $pem ): ?array {
		if ( ! preg_match( '/-----BEGIN ([A-Z ]+)-----\s+([A-Za-z0-9+\/=\r\n]+)-----END \1-----/', $pem, $match ) ) {
			return null;
		}
		$der = base64_decode( $match[2], true );
		return false === $der ? null : array( $match[1], $der );
	}

	public static function ed_der( string $raw, bool $is_private ): string {
		return ( $is_private ? self::ED_PRIVATE : self::ED_PUBLIC ) . $raw;
	}

	/** @return array{string, bool}|null The 32-byte seed or public key and its private/public flag. */
	public static function ed_raw( string $der ): ?array {
		foreach ( array( self::ED_PRIVATE, self::ED_PUBLIC ) as $prefix ) {
			if ( strlen( $der ) === strlen( $prefix ) + 32 && str_starts_with( $der, $prefix ) ) {
				return array( substr( $der, strlen( $prefix ) ), self::ED_PRIVATE === $prefix );
			}
		}
		return null;
	}

	public static function rsa_pkcs1( string $der, bool $is_private ): string {
		[, $key] = self::asymmetric_parts( $der, $is_private );
		return $is_private ? $key : substr( $key, 1 );
	}

	/** PKCS#1 stores the JWK's unsigned integers in the same order. */
	public static function rsa_jwk_der( array $fields, bool $is_private ): string {
		$version = $is_private ? self::integer( "\x00" ) : '';
		return self::element( 0x30, $version . implode( '', array_map( self::integer( ... ), $fields ) ) );
	}

	/** SEC 1 ECPrivateKey, including the named curve and public point that Node emits. */
	public static function ec_sec1( string $curve, string $d, string $x, string $y ): string {
		return self::element(
			0x30,
			self::integer( "\x01" ) . self::element( 0x04, $d )
			. self::element( 0xa0, self::EC_CURVES[ $curve ] )
			. self::element( 0xa1, self::element( 0x03, "\x00\x04" . $x . $y ) )
		);
	}

	public static function ec_spki( string $curve, string $x, string $y ): string {
		return self::ec_point_spki( $curve, "\x04" . $x . $y );
	}

	public static function ec_point_spki( string $curve, string $point ): string {
		$algorithm = self::element( 0x30, "\x06\x07\x2a\x86\x48\xce\x3d\x02\x01" . self::EC_CURVES[ $curve ] );
		return self::element( 0x30, $algorithm . self::element( 0x03, "\x00" . $point ) );
	}

	/**
	 * RSA-PSS key constraints configure OpenSSL's salt size without implementing a signature
	 * scheme in PHP. Without constraints the bindings use OpenSSL's automatic salt size.
	 */
	public static function rsa_pss( string $der, bool $is_private, string $digest, int $salt_length ): string {
		$oid             = self::DIGEST_OIDS[ $digest ] ?? throw self::error();
		[$version, $key] = self::asymmetric_parts( $der, $is_private );
		$hash            = self::element( 0x30, $oid . "\x05\x00" );
		$mgf             = self::element( 0x30, "\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x08" . $hash );
		$salt            = self::integer( pack( 'N', $salt_length ) );
		$parameters      = self::element( 0x30, self::element( 0xa0, $hash ) . self::element( 0xa1, $mgf ) . self::element( 0xa2, $salt ) );
		$algorithm       = self::element( 0x30, "\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x0a" . $parameters );
		return self::element( 0x30, $version . $algorithm . self::element( $is_private ? 0x04 : 0x03, $key ) );
	}

	public static function derToP1363( string $der, int $size ): string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- P1363 is the signature format name.
		$offset   = 0;
		$sequence = self::read( $der, $offset, 0x30 );
		if ( strlen( $der ) !== $offset ) {
			throw self::error();
		}
		$offset = 0;
		$r      = ltrim( self::read( $sequence, $offset, 0x02 ), "\0" );
		$s      = ltrim( self::read( $sequence, $offset, 0x02 ), "\0" );
		if ( strlen( $sequence ) !== $offset || strlen( $r ) > $size || strlen( $s ) > $size ) {
			throw self::error();
		}
		return str_pad( $r, $size, "\0", STR_PAD_LEFT ) . str_pad( $s, $size, "\0", STR_PAD_LEFT );
	}

	public static function p1363ToDer( string $signature, int $size ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- P1363 is the signature format name.
		if ( strlen( $signature ) !== $size * 2 ) {
			return null;
		}
		return self::element( 0x30, self::integer( substr( $signature, 0, $size ) ) . self::integer( substr( $signature, $size ) ) );
	}

	/** @return array{string, string} PKCS#8 version element (empty for SPKI) and key payload. */
	private static function asymmetric_parts( string $der, bool $is_private ): array {
		$offset   = 0;
		$sequence = self::read( $der, $offset, 0x30 );
		$offset   = 0;
		$version  = $is_private ? self::integer( self::read( $sequence, $offset, 0x02 ) ) : '';
		self::read( $sequence, $offset, 0x30 );
		return array( $version, self::read( $sequence, $offset, $is_private ? 0x04 : 0x03 ) );
	}

	private static function integer( string $bytes ): string {
		$bytes = ltrim( $bytes, "\0" );
		if ( '' === $bytes || ord( $bytes[0] ) >= 128 ) {
			$bytes = "\0" . $bytes;
		}
		return self::element( 0x02, $bytes );
	}

	private static function element( int $tag, string $bytes ): string {
		$length = strlen( $bytes );
		if ( $length < 128 ) {
			return chr( $tag ) . chr( $length ) . $bytes;
		}
		$encoded = ltrim( pack( 'N', $length ), "\0" );
		return chr( $tag ) . chr( 128 + strlen( $encoded ) ) . $encoded . $bytes;
	}

	private static function read( string $der, int &$offset, int $tag ): string {
		if ( ! isset( $der[ $offset + 1 ] ) || ord( $der[ $offset++ ] ) !== $tag ) {
			throw self::error();
		}
		$length = ord( $der[ $offset++ ] );
		if ( $length >= 128 ) {
			$width = $length - 128;
			if ( $width < 1 || $width > 4 || ! isset( $der[ $offset + $width - 1 ] ) ) {
				throw self::error();
			}
			$length = 0;
			for ( $i = 0; $i < $width; ++$i ) {
				$length = ( $length << 8 ) | ord( $der[ $offset++ ] );
			}
		}
		if ( $length > strlen( $der ) - $offset ) {
			throw self::error();
		}
		$bytes   = substr( $der, $offset, $length );
		$offset += $length;
		return $bytes;
	}

	private static function error(): JsError {
		return JsError::node( 'Unsupported key or signature encoding', 'Error', 'ERR_OSSL_UNSUPPORTED' );
	}
}
