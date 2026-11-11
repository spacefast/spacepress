<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Webauthn\AuthenticationExtensions;

use First\Identity\Vendor\CBOR\CBORObject;
use First\Identity\Vendor\CBOR\MapObject;
use First\Identity\Vendor\Webauthn\Exception\AuthenticationExtensionException;

abstract class AuthenticationExtensionLoader
{
    public static function load(CBORObject $object): AuthenticationExtensions
    {
        $object instanceof MapObject || throw AuthenticationExtensionException::create('Invalid extension object');
        /** @var array<string, mixed> $data */
        $data = $object->normalize();
        return AuthenticationExtensions::create(
            array_map(
                fn (mixed $value, string $key) => AuthenticationExtension::create($key, $value),
                $data,
                array_keys($data)
            )
        );
    }
}
