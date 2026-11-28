<?php

declare(strict_types=1);

namespace SpacePress\Node;

use SpacePress\JsArray;
use SpacePress\JsObject;
use SpacePress\JsUndefined;
use SpacePress\JsTypedArray;

/** An opaque Web Crypto handle. Metadata reads cannot change the key's permissions. */
final class CryptoKey implements Dispatch {
	public function __construct(
		public readonly KeyObject $key,
		public readonly string $type,
		public readonly bool $extractable,
		public readonly array $algorithm,
		public readonly array $usages
	) {}

	public function read( string $key ): mixed {
		return match ( $key ) {
			'type' => $this->type,
			'extractable' => $this->extractable,
			'algorithm' => $this->algorithm_properties(),
			'usages' => new JsArray( $this->usages ),
			default => JsUndefined::Value,
		};
	}

	private function algorithm_properties(): JsObject {
		$properties = $this->algorithm;
		if ( isset( $properties['hash'] ) ) {
			$properties['hash'] = new JsObject( $properties['hash'] );
		}
		if ( isset( $properties['publicExponent'] ) ) {
			$properties['publicExponent'] = JsTypedArray::fromBytes( $properties['publicExponent'] );
		}
		return new JsObject( $properties );
	}

	public function invoke( string $name, array $args ): mixed {
		return Module::inherited( $this, $name );
	}
}
