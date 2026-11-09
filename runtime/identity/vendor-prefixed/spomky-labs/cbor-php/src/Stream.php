<?php

declare(strict_types=1);

namespace First\Identity\Vendor\CBOR;

interface Stream
{
    public function read(int $length): string;
}
