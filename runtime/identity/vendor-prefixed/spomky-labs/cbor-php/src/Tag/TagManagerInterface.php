<?php

declare(strict_types=1);

namespace First\Identity\Vendor\CBOR\Tag;

use First\Identity\Vendor\CBOR\CBORObject;

interface TagManagerInterface
{
    public function createObjectForValue(int $additionalInformation, ?string $data, CBORObject $object): TagInterface;
}
