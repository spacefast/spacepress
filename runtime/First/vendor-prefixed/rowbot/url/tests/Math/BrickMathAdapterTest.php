<?php

declare(strict_types=1);

namespace First\Vendor\Rowbot\URL\Tests\Math;

use First\Vendor\Rowbot\URL\Component\Host\Math\BrickMathAdapter;
use First\Vendor\Rowbot\URL\Component\Host\Math\Exception\MathException;
use First\Vendor\Rowbot\URL\Component\Host\Math\NativeIntAdapter;
use First\Vendor\Rowbot\URL\Component\Host\Math\NumberInterface;

class BrickMathAdapterTest extends MathTestCase
{
    public function createNumber(int|string $number, int $base = 10): NumberInterface
    {
        return new BrickMathAdapter($number, $base);
    }

    public function testIsEqaulToError(): void
    {
        $this->expectException(MathException::class);
        (new BrickMathAdapter(42))->isEqualTo(new NativeIntAdapter(42));
    }

    public function testIsGreaterThanOrEqualToError(): void
    {
        $this->expectException(MathException::class);
        (new BrickMathAdapter(42))->isGreaterThanOrEqualTo(new NativeIntAdapter(42));
    }

    public function testPlusError(): void
    {
        $this->expectException(MathException::class);
        (new BrickMathAdapter(42))->plus(new NativeIntAdapter(42));
    }
}
