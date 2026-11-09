<?php

declare(strict_types=1);

namespace First\Identity\Vendor\CBOR;

interface DecoderInterface
{
    public function decode(Stream $stream): CBORObject;
}
