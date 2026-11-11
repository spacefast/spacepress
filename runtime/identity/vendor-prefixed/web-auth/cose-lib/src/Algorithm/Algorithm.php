<?php

declare(strict_types=1);

namespace First\Identity\Vendor\Cose\Algorithm;

interface Algorithm
{
    public static function identifier(): int;
}
