<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL\Component\Host;

use First\Vendor\Rowbot\URL\Component\Host\Serializer\HostSerializerInterface;
use First\Vendor\Rowbot\URL\Component\Host\Serializer\StringHostSerializer;
use First\Vendor\Rowbot\URL\String\Utf8String;

/**
 * @see https://url.spec.whatwg.org/#concept-domain
 * @see https://url.spec.whatwg.org/#opaque-host
 * @see https://url.spec.whatwg.org/#empty-host
 */
class StringHost extends Utf8String implements HostInterface
{
    public function equals(HostInterface $other): bool
    {
        return $other instanceof self && $this->string === $other->string;
    }

    public function getSerializer(): HostSerializerInterface
    {
        return new StringHostSerializer($this->string);
    }

    public function isLocalHost(): bool
    {
        return $this->string === 'localhost';
    }

    public function isNull(): bool
    {
        return false;
    }
}
