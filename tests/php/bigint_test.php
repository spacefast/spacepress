<?php

declare(strict_types=1);

// TypedPress\JsBigInt against Node: tests/php/fixtures/bigint-vectors.json holds random operands and
// Node's result for every operation (regenerate with `node tests/php/fixtures/bigint-vectors.mjs
// > tests/php/fixtures/bigint-vectors.json`). Pure PHP, no GMP or bcmath.

require __DIR__ . '/../../runtime/TypedPress/bootstrap.php';

use TypedPress\JsBigInt as B;

$vectors = json_decode(file_get_contents(__DIR__ . '/fixtures/bigint-vectors.json'), true, 512, JSON_THROW_ON_ERROR);
$show = static function (callable $f): string {
    try {
        $r = $f();
        return match (true) {
            is_string($r) => $r,
            is_bool($r) => $r ? 'true' : 'false',
            is_int($r), is_float($r) => \TypedPress\Js::numStr($r),
            default => (string) $r,
        };
    } catch (\TypedPress\JsError $e) {
        return $e->jsName;
    }
};
$failures = 0;
$checked = 0;
foreach ($vectors as $i => $row) {
    [$as, $bs, $ss] = $row;
    [$a, $b, $s] = [B::fromDecimal($as), B::fromDecimal($bs), B::fromDecimal($ss)];
    $e = B::fromInt(abs((int) $ss) % 7);
    $got = [$as, $bs, $ss,
        $show(fn () => $a->add($b)), $show(fn () => $a->sub($b)), $show(fn () => $a->mul($b)),
        $show(fn () => $a->divRem($b)[0]), $show(fn () => $a->divRem($b)[1]),
        $show(fn () => $a->bitwise('&', $b)), $show(fn () => $a->bitwise('|', $b)), $show(fn () => $a->bitwise('^', $b)),
        $show(fn () => $a->not()), $show(fn () => $a->shift($s, true)), $show(fn () => $a->shift($s, false)),
        $show(fn () => $a->compare($b) < 0), $show(fn () => $a->equals($b)), $show(fn () => $a->pow($e)),
        $show(fn () => $a->toRadix(16)), $show(fn () => $a->toRadix(36)), $show(fn () => $a->toNumber()),
        $show(fn () => $a->asN(64, true)), $show(fn () => $a->asN(13, false))];
    foreach ($row as $k => $want) {
        $checked++;
        if ($got[$k] !== $want) {
            $failures++;
            if ($failures <= 10) { fwrite(STDERR, "vector $i column $k: $as $bs $ss: want $want, got {$got[$k]}\n"); }
        }
    }
}
echo "bigint: $checked checked, $failures failed\n";
exit($failures === 0 ? 0 : 1);
