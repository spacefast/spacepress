<?php

declare(strict_types=1);

namespace First\Identity\Vendor\CBOR;

interface EncoderInterface
{
    public function encode(mixed $data, int $options = 0): string;
}
