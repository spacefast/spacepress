<?php

declare(strict_types=1);

namespace First\Identity\Vendor\CBOR\OtherObject;

use First\Identity\Vendor\CBOR\Normalizable;
use First\Identity\Vendor\CBOR\OtherObject as Base;

final class NullObject extends Base implements Normalizable
{
    public function __construct()
    {
        parent::__construct(self::OBJECT_NULL, null);
    }

    public static function create(): self
    {
        return new self();
    }

    public static function supportedAdditionalInformation(): array
    {
        return [self::OBJECT_NULL];
    }

    public static function createFromLoadedData(int $additionalInformation, ?string $data): Base
    {
        return new self();
    }

    public function normalize(): ?string
    {
        return null;
    }
}
