<?php

declare(strict_types=1);

namespace Zero\Vendor\Rowbot\URL\Tests\Math;

use Zero\Vendor\Rowbot\URL\Component\Host\Math\BrickMathAdapter;
use Zero\Vendor\Rowbot\URL\Component\Host\Math\Exception\MathException;
use Zero\Vendor\Rowbot\URL\Component\Host\Math\NativeIntAdapter;
use Zero\Vendor\Rowbot\URL\Component\Host\Math\NumberInterface;

class NativeIntAdapterTest extends MathTestCase
{
    public function createNumber(int|string $number, int $base = 10): NumberInterface
    {
        return new NativeIntAdapter($number, $base);
    }

    public function testIsEqaulToError(): void
    {
        $this->expectException(MathException::class);
        (new NativeIntAdapter(42))->isEqualTo(new BrickMathAdapter(42));
    }

    public function testIsGreaterThanOrEqualToError(): void
    {
        $this->expectException(MathException::class);
        (new NativeIntAdapter(42))->isGreaterThanOrEqualTo(new BrickMathAdapter(42));
    }

    public function testPlusError(): void
    {
        $this->expectException(MathException::class);
        (new NativeIntAdapter(42))->plus(new BrickMathAdapter(42));
    }
}
