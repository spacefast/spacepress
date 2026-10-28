<?php

declare(strict_types=1);

namespace Zero;

/**
 * JavaScript semantics in PHP. See docs/runtime-contract.md ("class Js").
 *
 * Value model: number = int|float, string = UTF-8 string indexed by code point,
 * null = null|undefined, array = list, object = assoc array, Date = epoch ms.
 */
final class Js
{
    /** JS WhiteSpace + LineTerminator, as a PCRE class body. */
    public const WS = '\x{9}-\x{D}\x{20}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    private const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_LINE_TERMINATORS | JSON_INVALID_UTF8_SUBSTITUTE;

    private const MAX_TIME = 8.64e15;

    /** @var array<string, RegExp> */
    private static array $regexCache = [];

    // ---------------------------------------------------------------- conversions

    public static function str(mixed $v): string
    {
        return match (true) {
            is_string($v) => $v,
            $v === null => 'null',
            is_bool($v) => $v ? 'true' : 'false',
            is_int($v), is_float($v) => self::numStr($v),
            is_array($v) => array_is_list($v) ? self::join($v) : '[object Object]',
            $v instanceof RegExp => (string) $v,
            $v instanceof \Closure => 'function () { [native code] }',
            $v instanceof \Stringable => (string) $v,
            default => '[object Object]',
        };
    }

    public static function numStr(int|float $n): string
    {
        if (is_int($n)) {
            return (string) $n;
        }
        if (is_nan($n)) {
            return 'NaN';
        }
        if (is_infinite($n)) {
            return $n > 0 ? 'Infinity' : '-Infinity';
        }
        if ($n == 0.0) {
            return '0';
        }
        $sign = $n < 0 ? '-' : '';
        [$digits, $point] = self::shortestDigits(abs($n));
        $k = strlen($digits);
        if ($k <= $point && $point <= 21) {
            return $sign . $digits . str_repeat('0', $point - $k);
        }
        if (0 < $point && $point <= 21) {
            return $sign . substr($digits, 0, $point) . '.' . substr($digits, $point);
        }
        if (-6 < $point && $point <= 0) {
            return $sign . '0.' . str_repeat('0', -$point) . $digits;
        }
        $exp = $point - 1;
        $mantissa = $k === 1 ? $digits : $digits[0] . '.' . substr($digits, 1);

        return $sign . $mantissa . 'e' . ($exp < 0 ? '-' : '+') . abs($exp);
    }

    /**
     * Shortest round-tripping decimal digits of a positive finite float, as
     * [digits, point] meaning 0.digits × 10^point (JS's s, n with k = strlen(s)).
     *
     * @return array{string, int}
     */
    private static function shortestDigits(float $x): array
    {
        for ($p = 0; $p < 17; $p++) {
            $s = sprintf('%.' . $p . 'e', $x);
            if ((float) $s === $x) {
                break;
            }
        }
        [$mantissa, $exp] = explode('e', $s);
        $digits = rtrim(str_replace('.', '', $mantissa), '0');

        return [$digits === '' ? '0' : $digits, (int) $exp + 1];
    }

    public static function toNumber(mixed $v): int|float
    {
        if (is_int($v) || is_float($v)) {
            return $v;
        }
        if ($v === null) {
            return 0;
        }
        if (is_bool($v)) {
            return (int) $v;
        }
        if (is_array($v)) {
            return array_is_list($v) ? self::toNumber(self::str($v)) : NAN;
        }
        if (!is_string($v)) {
            return NAN;
        }
        $t = self::trim($v);
        if ($t === '') {
            return 0;
        }
        if (preg_match('/^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$/', $t)) {
            return self::num((float) $t);
        }
        if (preg_match('/^0([xXoObB])(.+)$/', $t, $m)) {
            $radix = ['x' => 16, 'o' => 8, 'b' => 2][strtolower($m[1])];
            [$value, $used] = self::parseDigits($m[2], $radix);

            return $used === strlen($m[2]) ? $value : NAN;
        }

        return match ($t) {
            'Infinity', '+Infinity' => INF,
            '-Infinity' => -INF,
            default => NAN,
        };
    }

    public static function parseInt(string $s, int|float|null $radix = null): int|float
    {
        $s = self::trimStart($s);
        $sign = 1;
        if ($s !== '' && ($s[0] === '-' || $s[0] === '+')) {
            $sign = $s[0] === '-' ? -1 : 1;
            $s = substr($s, 1);
        }
        $r = $radix === null ? 0 : self::toInt32($radix);
        $stripPrefix = true;
        if ($r !== 0) {
            if ($r < 2 || $r > 36) {
                return NAN;
            }
            $stripPrefix = $r === 16;
        } else {
            $r = 10;
        }
        if ($stripPrefix && preg_match('/^0[xX]/', $s)) {
            $s = substr($s, 2);
            $r = 16;
        }
        [$value, $used] = self::parseDigits($s, $r);
        if ($used === 0) {
            return NAN;
        }
        if ($r === 10 && $used > 15) {
            $value = (float) substr($s, 0, $used); // correctly rounded, like V8
        }
        if ($sign < 0) {
            return $value == 0 ? -0.0 : self::num(-(float) $value);
        }

        return self::num((float) $value);
    }

    public static function parseFloat(string $s): int|float
    {
        $s = self::trimStart($s);
        if (!preg_match('/^[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/', $s, $m)) {
            return NAN;
        }
        $t = $m[0];
        if (str_ends_with($t, 'Infinity')) {
            return $t[0] === '-' ? -INF : INF;
        }

        return self::num((float) $t);
    }

    /**
     * Longest prefix of $s made of digits valid in $radix.
     *
     * @return array{int|float, int} [value, number of bytes consumed]
     */
    private static function parseDigits(string $s, int $radix): array
    {
        $value = 0;
        $len = strlen($s);
        for ($i = 0; $i < $len; $i++) {
            $c = ord($s[$i]);
            $d = match (true) {
                $c >= 48 && $c <= 57 => $c - 48,
                $c >= 97 && $c <= 122 => $c - 87,
                $c >= 65 && $c <= 90 => $c - 55,
                default => 99,
            };
            if ($d >= $radix) {
                break;
            }
            $value = $value * $radix + $d; // int overflows to float on its own
        }

        return [$value, $i];
    }

    /** Integral finite floats within int range become ints (except -0). */
    private static function num(float $f): int|float
    {
        if (is_finite($f) && floor($f) === $f && $f >= -9.2233720368547758E18 && $f < 9.2233720368547758E18
            && !($f === 0.0 && fdiv(1, $f) < 0)) {
            return (int) $f;
        }

        return $f;
    }

    /** Truncate toward zero, keeping float type (and -0). */
    private static function trunc(float $f): float
    {
        return $f < 0 ? ceil($f) : floor($f);
    }

    private static function toInt32(int|float $n): int
    {
        if (is_float($n)) {
            if (!is_finite($n)) {
                return 0;
            }
            $n = fmod(self::trunc($n), 4294967296.0);
            $n = (int) $n;
        }
        $n &= 0xFFFFFFFF;

        return $n >= 0x80000000 ? $n - 0x100000000 : $n;
    }

    private static function toUint32(int|float $n): int
    {
        return self::toInt32($n) & 0xFFFFFFFF;
    }

    /** ToIntegerOrInfinity: NaN → 0, truncation toward zero. */
    private static function toInteger(int|float $n): int|float
    {
        if (is_int($n)) {
            return $n;
        }
        if (is_nan($n)) {
            return 0;
        }
        if (is_infinite($n)) {
            return $n;
        }

        return self::num(self::trunc($n)) + 0;
    }

    /** Resolve a relative index (slice/at semantics) against a length. */
    private static function relIndex(int|float $i, int $len): int
    {
        $i = self::toInteger($i);
        if ($i < 0) {
            return (int) max($len + $i, 0);
        }

        return (int) min($i, $len);
    }

    private static function clampIndex(int|float $i, int $len): int
    {
        return (int) min(max(self::toInteger($i), 0), $len);
    }

    public static function truthy(mixed $v): bool
    {
        return match (true) {
            $v === null, $v === false, $v === '', $v === 0 => false,
            is_float($v) => !($v == 0.0 || is_nan($v)),
            default => true,
        };
    }

    public static function typeOf(mixed $v): string
    {
        return match (true) {
            is_string($v) => 'string',
            is_int($v), is_float($v) => 'number',
            is_bool($v) => 'boolean',
            $v instanceof \Closure => 'function',
            default => 'object',
        };
    }

    public static function strictEq(mixed $a, mixed $b): bool
    {
        if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) {
            return is_int($a) && is_int($b) ? $a === $b : (float) $a == (float) $b;
        }

        return $a === $b;
    }

    private static function sameValueZero(mixed $a, mixed $b): bool
    {
        if (is_float($a) && is_float($b) && is_nan($a) && is_nan($b)) {
            return true;
        }

        return self::strictEq($a, $b);
    }

    public static function isInteger(mixed $v): bool
    {
        return is_int($v) || (is_float($v) && is_finite($v) && floor($v) === $v);
    }

    public static function isFinite(mixed $v): bool
    {
        return is_int($v) || (is_float($v) && is_finite($v));
    }

    public static function toFixed(int|float $n, int $digits = 0): string
    {
        if ($digits < 0 || $digits > 100) {
            throw new JsError('toFixed() digits argument must be between 0 and 100', 'RangeError');
        }
        if (is_int($n)) {
            return $n . ($digits > 0 ? '.' . str_repeat('0', $digits) : '');
        }
        if (is_nan($n)) {
            return 'NaN';
        }
        if (abs($n) >= 1e21) {
            return self::numStr($n);
        }
        $sign = $n < 0 ? '-' : '';
        [$int, $frac] = self::exactDecimal(abs($n));
        $frac = str_pad($frac, $digits + 1, '0');
        $kept = $int . substr($frac, 0, $digits);
        if ($frac[$digits] >= '5') { // ties round up (the larger n), exact value decides
            $kept = self::incrementDecimal($kept);
        }
        $intLen = strlen($kept) - $digits;
        $out = substr($kept, 0, $intLen) . ($digits > 0 ? '.' . substr($kept, $intLen) : '');

        return $sign . $out;
    }

    /**
     * Exact decimal expansion of a non-negative finite float.
     *
     * @return array{string, string} [integer digits, fraction digits]
     */
    private static function exactDecimal(float $x): array
    {
        $bits = unpack('J', pack('E', $x))[1];
        $exp = ($bits >> 52) & 0x7FF;
        $mant = $bits & 0xFFFFFFFFFFFFF;
        if ($exp === 0) {
            $e = -1074;
        } else {
            $mant |= 1 << 52;
            $e = $exp - 1075;
        }
        if ($mant === 0) {
            return ['0', ''];
        }
        $limbs = [];
        for ($m = $mant; $m > 0; $m = intdiv($m, 1000000000)) {
            $limbs[] = $m % 1000000000;
        }
        // value = mant × 2^e = (mant × 5^-e) / 10^-e when e < 0
        [$factor, $times] = $e >= 0 ? [2, $e] : [5, -$e];
        $chunk = $factor === 2 ? 30 : 13; // 2^30, 5^13 keep limb × factor < 2^63
        for (; $times > 0; $times -= $chunk) {
            $step = min($chunk, $times);
            $mul = $factor ** $step;
            $carry = 0;
            foreach ($limbs as $i => $limb) {
                $v = $limb * $mul + $carry;
                $limbs[$i] = $v % 1000000000;
                $carry = intdiv($v, 1000000000);
            }
            while ($carry > 0) {
                $limbs[] = $carry % 1000000000;
                $carry = intdiv($carry, 1000000000);
            }
        }
        $s = (string) array_pop($limbs);
        foreach (array_reverse($limbs) as $limb) {
            $s .= str_pad((string) $limb, 9, '0', STR_PAD_LEFT);
        }
        if ($e >= 0) {
            return [$s, ''];
        }
        $point = -$e;
        $s = str_pad($s, $point + 1, '0', STR_PAD_LEFT);

        return [substr($s, 0, -$point), substr($s, -$point)];
    }

    private static function incrementDecimal(string $digits): string
    {
        for ($i = strlen($digits) - 1; $i >= 0; $i--) {
            if ($digits[$i] !== '9') {
                $digits[$i] = (string) ((int) $digits[$i] + 1);

                return $digits;
            }
            $digits[$i] = '0';
        }

        return '1' . $digits;
    }

    // ---------------------------------------------------------------- strings

    public static function slice(string $s, int|float $start = 0, int|float|null $end = null): string
    {
        $len = mb_strlen($s);
        $from = self::relIndex($start, $len);
        $to = $end === null ? $len : self::relIndex($end, $len);

        return $from >= $to ? '' : mb_substr($s, $from, $to - $from);
    }

    public static function substring(string $s, int|float $start, int|float|null $end = null): string
    {
        $len = mb_strlen($s);
        $a = self::clampIndex($start, $len);
        $b = $end === null ? $len : self::clampIndex($end, $len);
        [$from, $to] = $a <= $b ? [$a, $b] : [$b, $a];

        return mb_substr($s, $from, $to - $from);
    }

    public static function charAt(string $s, int|float $i): string
    {
        $i = self::toInteger($i);
        if ($i < 0 || $i >= mb_strlen($s)) {
            return '';
        }

        return mb_substr($s, (int) $i, 1);
    }

    /** `String.prototype.length`: UTF-16 code units (astral characters count twice). */
    public static function length(string $s): int
    {
        return intdiv(strlen((string) mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
    }

    public static function strAt(string $s, int|float $i): ?string
    {
        $len = mb_strlen($s);
        $i = self::toInteger($i);
        $i = $i < 0 ? $len + $i : $i;
        if ($i < 0 || $i >= $len) {
            return null;
        }

        return mb_substr($s, (int) $i, 1);
    }

    /** String.prototype.indexOf for strings, Array.prototype.indexOf for lists. */
    public static function indexOf(string|array $s, mixed $needle, int|float $from = 0): int
    {
        if (is_array($s)) {
            $len = count($s);
            for ($i = self::relIndex($from, $len); $i < $len; $i++) {
                if (self::strictEq($s[$i], $needle)) {
                    return $i;
                }
            }

            return -1;
        }
        $needle = self::str($needle);
        $pos = self::clampIndex($from, mb_strlen($s));
        $found = mb_strpos($s, $needle, $pos);

        return $found === false ? -1 : $found;
    }

    /** String.prototype.lastIndexOf for strings, Array.prototype.lastIndexOf for lists. */
    public static function lastIndexOf(string|array $s, mixed $needle): int
    {
        if (is_array($s)) {
            for ($i = count($s) - 1; $i >= 0; $i--) {
                if (self::strictEq($s[$i], $needle)) {
                    return $i;
                }
            }

            return -1;
        }
        $found = mb_strrpos($s, self::str($needle));

        return $found === false ? -1 : $found;
    }

    /** @return list<?string> */
    public static function split(string $s, string|RegExp $sep, int|float|null $limit = null): array
    {
        $lim = $limit === null ? 0xFFFFFFFF : self::toUint32($limit);
        if ($lim === 0) {
            return [];
        }
        if (is_string($sep)) {
            if ($sep === '') {
                $parts = mb_str_split($s);
            } else {
                $parts = explode($sep, $s);
            }

            return array_slice($parts, 0, $lim);
        }
        if ($s === '') {
            return $sep->matchAt($s, 0) !== null ? [] : [$s];
        }
        $out = [];
        $size = strlen($s);
        $p = 0;
        $q = 0;
        while ($q < $size) {
            $m = $sep->matchAt($s, $q);
            if ($m === null || $m[0] >= $size) {
                break;
            }
            [$start, $end, $groups] = $m;
            if ($end === $p) {
                $q = $start + self::charLenAt($s, $start);
                continue;
            }
            $out[] = substr($s, $p, $start - $p);
            if (count($out) === $lim) {
                return $out;
            }
            foreach ($groups as $g) {
                $out[] = $g;
                if (count($out) === $lim) {
                    return $out;
                }
            }
            $p = $q = $end;
        }
        $out[] = substr($s, $p);

        return $out;
    }

    /** Byte length of the UTF-8 character starting at byte $i (1 at end of string). */
    public static function charLenAt(string $s, int $i): int
    {
        if ($i >= strlen($s)) {
            return 1;
        }
        $b = ord($s[$i]);

        return match (true) {
            $b >= 0xF0 => 4,
            $b >= 0xE0 => 3,
            $b >= 0xC0 => 2,
            default => 1,
        };
    }

    public static function padStart(string $s, int|float $len, string $fill = ' '): string
    {
        return self::pad($s, $len, $fill, true);
    }

    public static function padEnd(string $s, int|float $len, string $fill = ' '): string
    {
        return self::pad($s, $len, $fill, false);
    }

    private static function pad(string $s, int|float $len, string $fill, bool $start): string
    {
        $target = max(0, self::toInteger($len));
        $cur = mb_strlen($s);
        if ($target <= $cur || $fill === '') {
            return $s;
        }
        if ($target > 536870888) {
            throw new JsError('Invalid string length', 'RangeError');
        }
        $need = (int) $target - $cur;
        $fillLen = mb_strlen($fill);
        $padding = mb_substr(str_repeat($fill, intdiv($need, $fillLen) + 1), 0, $need);

        return $start ? $padding . $s : $s . $padding;
    }

    public static function trim(string $s): string
    {
        return preg_replace('/^[' . self::WS . ']+|[' . self::WS . ']+$/uD', '', $s) ?? trim($s);
    }

    public static function trimStart(string $s): string
    {
        return preg_replace('/^[' . self::WS . ']+/u', '', $s) ?? ltrim($s);
    }

    public static function trimEnd(string $s): string
    {
        return preg_replace('/[' . self::WS . ']+$/uD', '', $s) ?? rtrim($s);
    }

    public static function replace(string $s, string|RegExp $pattern, string|callable $replacement): string
    {
        if ($pattern instanceof RegExp) {
            $matches = $pattern->global ? $pattern->matchAll($s) : array_filter([$pattern->matchAt($s, 0)]);

            return self::applyReplacements($s, $matches, $replacement, $pattern->hasNamedGroups());
        }
        $pos = strpos($s, $pattern);
        if ($pos === false) {
            return $s;
        }

        return self::applyReplacements($s, [[$pos, $pos + strlen($pattern), [], []]], $replacement, false);
    }

    public static function replaceAll(string $s, string|RegExp $pattern, string|callable $replacement): string
    {
        if ($pattern instanceof RegExp) {
            if (!$pattern->global) {
                throw new JsError('replaceAll must be called with a global RegExp', 'TypeError');
            }

            return self::replace($s, $pattern, $replacement);
        }
        $matches = [];
        $plen = strlen($pattern);
        $size = strlen($s);
        for ($pos = strpos($s, $pattern); $pos !== false; $pos = $next <= $size ? strpos($s, $pattern, $next) : false) {
            $matches[] = [$pos, $pos + $plen, [], []];
            $next = $pos + ($plen > 0 ? $plen : self::charLenAt($s, $pos));
        }

        return self::applyReplacements($s, $matches, $replacement, false);
    }

    /**
     * @param iterable<array{int, int, list<?string>, array<string, ?string>}> $matches byte ranges + captures
     */
    private static function applyReplacements(string $s, iterable $matches, string|callable $replacement, bool $named): string
    {
        $out = '';
        $last = 0;
        foreach ($matches as [$start, $end, $groups, $names]) {
            $matched = substr($s, $start, $end - $start);
            if (is_string($replacement)) {
                $rep = self::expandReplacement($replacement, $s, $start, $end, $groups, $named ? $names : null);
            } else {
                $rep = self::str($replacement($matched, ...[...$groups, mb_strlen(substr($s, 0, $start)), $s]));
            }
            $out .= substr($s, $last, $start - $last) . $rep;
            $last = $end;
        }

        return $out . substr($s, $last);
    }

    /**
     * GetSubstitution: $$, $&, $`, $', $n / $nn, $<name>.
     *
     * @param list<?string> $groups
     * @param ?array<string, ?string> $names null when the pattern has no named groups
     */
    private static function expandReplacement(string $tpl, string $s, int $start, int $end, array $groups, ?array $names): string
    {
        if (!str_contains($tpl, '$')) {
            return $tpl;
        }
        $m = count($groups);

        return preg_replace_callback('/\$(?:(\$)|(&)|(`)|(\')|(\d\d?)|<([^>]*)>)/', static function (array $x) use ($s, $start, $end, $groups, $names, $m): string {
            $tok = $x[0];
            return match (true) {
                $tok === '$$' => '$',
                $tok === '$&' => substr($s, $start, $end - $start),
                $tok === '$`' => substr($s, 0, $start),
                $tok === "\$'" => substr($s, $end),
                $tok[1] === '<' => $names === null ? $tok : ($names[$x[6]] ?? ''),
                default => self::numberedGroup($x[5], $groups, $m),
            };
        }, $tpl);
    }

    /** @param list<?string> $groups */
    private static function numberedGroup(string $digits, array $groups, int $m): string
    {
        $two = (int) $digits;
        if (strlen($digits) === 2 && $two >= 1 && $two <= $m) {
            return $groups[$two - 1] ?? '';
        }
        $one = (int) $digits[0];
        if ($one >= 1 && $one <= $m) {
            return ($groups[$one - 1] ?? '') . substr($digits, 1);
        }

        return '$' . $digits;
    }

    public static function repeat(string $s, int|float $n): string
    {
        $n = self::toInteger($n);
        if ($n < 0 || is_infinite($n)) {
            throw new JsError('Invalid count value: ' . self::numStr($n), 'RangeError');
        }
        if ($n * strlen($s) > 536870888) {
            throw new JsError('Invalid string length', 'RangeError');
        }

        return str_repeat($s, (int) $n);
    }

    /** Byte comparison (documented deviation from locale-aware collation). */
    public static function localeCompare(string $a, string $b): int
    {
        return strcmp($a, $b) <=> 0;
    }

    /** @return ?list<?string> */
    public static function strMatch(string $s, RegExp $re): ?array
    {
        if ($re->global) {
            $all = [];
            foreach ($re->matchAll($s) as [$start, $end]) {
                $all[] = substr($s, $start, $end - $start);
            }

            return $all === [] ? null : $all;
        }
        $m = $re->matchAt($s, 0);

        return $m === null ? null : [substr($s, $m[0], $m[1] - $m[0]), ...$m[2]];
    }

    // ---------------------------------------------------------------- regexp

    public static function re(string $source, string $flags): RegExp
    {
        return self::$regexCache[$flags . '/' . $source] ??= new RegExp($source, $flags);
    }

    // ---------------------------------------------------------------- arrays

    public static function find(array $a, callable $f): mixed
    {
        foreach ($a as $i => $item) {
            if (self::truthy($f($item, $i))) {
                return $item;
            }
        }

        return null;
    }

    public static function findIndex(array $a, callable $f): int
    {
        foreach ($a as $i => $item) {
            if (self::truthy($f($item, $i))) {
                return $i;
            }
        }

        return -1;
    }

    public static function findLast(array $a, callable $f): mixed
    {
        $i = self::findLastIndex($a, $f);

        return $i < 0 ? null : $a[$i];
    }

    public static function findLastIndex(array $a, callable $f): int
    {
        for ($i = count($a) - 1; $i >= 0; $i--) {
            if (self::truthy($f($a[$i], $i))) {
                return $i;
            }
        }

        return -1;
    }

    public static function some(array $a, callable $f): bool
    {
        return self::findIndex($a, $f) >= 0;
    }

    public static function every(array $a, callable $f): bool
    {
        foreach ($a as $i => $item) {
            if (!self::truthy($f($item, $i))) {
                return false;
            }
        }

        return true;
    }

    public static function filter(array $a, callable $f): array
    {
        $out = [];
        foreach ($a as $i => $item) {
            if (self::truthy($f($item, $i))) {
                $out[] = $item;
            }
        }

        return $out;
    }

    public static function map(array $a, callable $f): array
    {
        $out = [];
        foreach ($a as $i => $item) {
            $out[] = $f($item, $i);
        }

        return $out;
    }

    public static function includes(array $a, mixed $v): bool
    {
        foreach ($a as $item) {
            if (self::sameValueZero($item, $v)) {
                return true;
            }
        }

        return false;
    }

    public static function join(array $a, string $sep = ','): string
    {
        $parts = [];
        foreach ($a as $item) {
            $parts[] = $item === null ? '' : self::str($item);
        }

        return implode($sep, $parts);
    }

    public static function arrSlice(array $a, int|float $start = 0, int|float|null $end = null): array
    {
        $len = count($a);
        $from = self::relIndex($start, $len);
        $to = $end === null ? $len : self::relIndex($end, $len);

        return $from >= $to ? [] : array_slice($a, $from, $to - $from);
    }

    public static function arrAt(array $a, int|float $i): mixed
    {
        $len = count($a);
        $i = self::toInteger($i);
        $i = $i < 0 ? $len + $i : $i;

        return $i >= 0 && $i < $len ? $a[(int) $i] : null;
    }

    public static function splice(array &$a, int|float $start, int|float|null $deleteCount = null, mixed ...$items): array
    {
        $len = count($a);
        $from = self::relIndex($start, $len);
        $count = $deleteCount === null ? $len - $from : self::clampIndex($deleteCount, $len - $from);

        return array_splice($a, $from, $count, $items);
    }

    public static function reverse(array &$a): array
    {
        $a = array_reverse($a);

        return $a;
    }

    public static function sort(array &$a, ?callable $cmp = null): array
    {
        $a = self::sorted($a, $cmp);

        return $a;
    }

    public static function sorted(array $a, ?callable $cmp = null): array
    {
        if ($cmp !== null) {
            usort($a, static function (mixed $x, mixed $y) use ($cmp): int {
                $r = $cmp($x, $y);
                $r = is_int($r) || is_float($r) ? $r : self::toNumber($r);

                return $r > 0 ? 1 : ($r < 0 ? -1 : 0);
            });

            return $a;
        }
        // Default order: String(x) compared by UTF-16 code units (UTF-16BE bytes), stable.
        $keyed = [];
        foreach ($a as $item) {
            $keyed[] = [mb_convert_encoding(self::str($item), 'UTF-16BE', 'UTF-8'), $item];
        }
        usort($keyed, static fn (array $x, array $y): int => strcmp($x[0], $y[0]) <=> 0);

        return array_column($keyed, 1);
    }

    public static function reduce(array $a, callable $f, mixed ...$init): mixed
    {
        $i = 0;
        if ($init !== []) {
            $acc = $init[0];
        } elseif ($a === []) {
            throw new JsError('Reduce of empty array with no initial value', 'TypeError');
        } else {
            $acc = $a[0];
            $i = 1;
        }
        for ($n = count($a); $i < $n; $i++) {
            $acc = $f($acc, $a[$i], $i);
        }

        return $acc;
    }

    public static function flat(array $a, int|float $depth = 1): array
    {
        $depth = self::toInteger($depth);
        $out = [];
        foreach ($a as $item) {
            if ($depth >= 1 && is_array($item) && array_is_list($item)) {
                array_push($out, ...self::flat($item, $depth - 1));
            } else {
                $out[] = $item;
            }
        }

        return $out;
    }

    public static function flatMap(array $a, callable $f): array
    {
        return self::flat(self::map($a, $f), 1);
    }

    public static function fill(array &$a, mixed $v, int|float $start = 0, int|float|null $end = null): array
    {
        $len = count($a);
        $to = $end === null ? $len : self::relIndex($end, $len);
        for ($i = self::relIndex($start, $len); $i < $to; $i++) {
            $a[$i] = $v;
        }

        return $a;
    }

    public static function max(int|float ...$n): int|float
    {
        $best = -INF;
        foreach ($n as $x) {
            if (is_nan((float) $x)) {
                return NAN;
            }
            if ($x > $best || ($x == 0 && $best == 0 && !self::isNegZero($x))) {
                $best = $x;
            }
        }

        return $best;
    }

    public static function min(int|float ...$n): int|float
    {
        $best = INF;
        foreach ($n as $x) {
            if (is_nan((float) $x)) {
                return NAN;
            }
            if ($x < $best || ($x == 0 && $best == 0 && self::isNegZero($x))) {
                $best = $x;
            }
        }

        return $best;
    }

    private static function isNegZero(int|float $x): bool
    {
        return is_float($x) && $x === 0.0 && fdiv(1, $x) < 0;
    }

    public static function range(int $n, callable $f): array
    {
        $out = [];
        for ($i = 0; $i < $n; $i++) {
            $out[] = $f($i);
        }

        return $out;
    }

    // ---------------------------------------------------------------- objects

    /**
     * Property order of an object: array-index keys ascending, then the rest in
     * insertion order.
     *
     * @return list<int|string>
     */
    private static function ownKeys(array $o): array
    {
        if (array_is_list($o)) {
            return array_keys($o);
        }
        $indexes = [];
        $names = [];
        foreach ($o as $k => $_) {
            if (is_int($k) && $k >= 0 && $k < 4294967295) {
                $indexes[] = $k;
            } else {
                $names[] = $k;
            }
        }
        sort($indexes);

        return [...$indexes, ...$names];
    }

    /** @return list<string> */
    public static function keys(array $o): array
    {
        return array_map('strval', self::ownKeys($o));
    }

    public static function values(array $o): array
    {
        return array_map(static fn ($k) => $o[$k], self::ownKeys($o));
    }

    /** @return list<array{string, mixed}> */
    public static function entries(array $o): array
    {
        return array_map(static fn ($k) => [(string) $k, $o[$k]], self::ownKeys($o));
    }

    public static function fromEntries(iterable $e): array
    {
        $out = [];
        foreach ($e as $entry) {
            $out[self::str($entry[0] ?? null)] = $entry[1] ?? null;
        }

        return $out;
    }

    public static function omit(array $o, array $keys): array
    {
        foreach ($keys as $k) {
            unset($o[$k]);
        }

        return $o;
    }

    public static function hasOwn(array $o, string $k): bool
    {
        return array_key_exists($k, $o);
    }

    // ---------------------------------------------------------------- JSON

    public static function jsonStringify(mixed $v, int|float|string|null $indent = null): ?string
    {
        if (is_string($indent)) {
            $gap = mb_substr($indent, 0, 10);
        } elseif ($indent !== null) {
            $gap = str_repeat(' ', (int) min(10, max(0, self::toInteger($indent))));
        } else {
            $gap = '';
        }

        return self::encode($v, $gap, '');
    }

    private static function encode(mixed $v, string $gap, string $indent): ?string
    {
        if ($v === null || is_bool($v) || is_int($v) || is_string($v)) {
            return json_encode($v, self::JSON_FLAGS);
        }
        if (is_float($v)) {
            return is_finite($v) ? self::numStr($v) : 'null';
        }
        if ($v instanceof \Closure) {
            return null;
        }
        if ($v instanceof \JsonSerializable) {
            return self::encode($v->jsonSerialize(), $gap, $indent);
        }
        if (is_object($v)) {
            $v = $v instanceof RegExp ? [] : get_object_vars($v);
            if ($v === []) {
                return '{}';
            }
        }
        if ($v === []) {
            return '[]';
        }
        $inner = $indent . $gap;
        $parts = [];
        $isList = array_is_list($v);
        foreach ($isList ? array_keys($v) : self::ownKeys($v) as $k) {
            $enc = self::encode($v[$k], $gap, $inner);
            if ($isList) {
                $parts[] = $enc ?? 'null';
            } elseif ($enc !== null) {
                $parts[] = json_encode((string) $k, self::JSON_FLAGS) . ($gap === '' ? ':' : ': ') . $enc;
            }
        }
        [$open, $close] = $isList ? ['[', ']'] : ['{', '}'];
        if ($parts === []) {
            return $open . $close;
        }
        if ($gap === '') {
            return $open . implode(',', $parts) . $close;
        }

        return $open . "\n" . $inner . implode(",\n" . $inner, $parts) . "\n" . $indent . $close;
    }

    public static function jsonParse(string $s): mixed
    {
        try {
            return json_decode($s, true, 4096, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new JsError('Unexpected token in JSON: ' . $e->getMessage(), 'SyntaxError');
        }
    }

    // ---------------------------------------------------------------- misc

    /**
     * Epoch ms. `ZERO_NOW` (ISO string or epoch ms) pins the clock for time-travel tests (§9.1);
     * it is read on every call so an in-process test can move it.
     */
    public static function now(): int
    {
        $pinned = getenv('ZERO_NOW');
        if ($pinned !== false && $pinned !== '') {
            $ms = preg_match('/^-?\d+$/D', $pinned) ? (int) $pinned : self::date($pinned);
            if (is_int($ms)) {
                return $ms;
            }
        }

        return (int) floor(microtime(true) * 1000);
    }

    /** new Date(v).getTime() */
    public static function date(mixed $v): int|float
    {
        if (is_int($v) || is_float($v)) {
            return self::timeClip((float) $v);
        }
        if ($v === null || is_bool($v)) {
            return (int) $v;
        }
        if (is_array($v)) {
            $v = self::str($v);
        }

        return is_string($v) ? self::parseDate($v) : NAN;
    }

    private static function timeClip(float $t): int|float
    {
        if (!is_finite($t) || abs($t) > self::MAX_TIME) {
            return NAN;
        }

        return (int) self::trunc($t);
    }

    /** ES date-time string format (plus a space separator and ±HHmm offsets); no zone = UTC. */
    private static function parseDate(string $s): int|float
    {
        $re = '/^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?'
            . '(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/D';
        if (!preg_match($re, $s, $m)) {
            return NAN;
        }
        if ($m[1] === '-000000') {
            return NAN;
        }
        $y = (int) $m[1];
        $mo = ($m[2] ?? '') === '' ? 1 : (int) $m[2];
        $d = ($m[3] ?? '') === '' ? 1 : (int) $m[3];
        $h = (int) ($m[4] ?? 0);
        $mi = (int) ($m[5] ?? 0);
        $sec = (int) ($m[6] ?? 0);
        $ms = ($m[7] ?? '') === '' ? 0 : (int) substr($m[7] . '00', 0, 3);
        if ($mo < 1 || $mo > 12 || $d < 1 || $d > 31 || $mi > 59 || $sec > 59
            || $h > 24 || ($h === 24 && ($mi + $sec + $ms) > 0)) {
            return NAN;
        }
        $offset = 0;
        $zone = $m[8] ?? '';
        if ($zone !== '' && $zone !== 'Z') {
            $zh = (int) substr($zone, 1, 2);
            $zm = (int) substr($zone, -2);
            if ($zh > 23 || $zm > 59) {
                return NAN;
            }
            $offset = ($zone[0] === '-' ? -1 : 1) * ($zh * 60 + $zm) * 60000;
        }
        $days = self::daysFromCivil($y, $mo, 1) + $d - 1;

        return self::timeClip((float) ($days * 86400000 + (($h * 60 + $mi) * 60 + $sec) * 1000 + $ms - $offset));
    }

    private static function daysFromCivil(int $y, int $m, int $d): int
    {
        $y -= $m <= 2 ? 1 : 0;
        $era = intdiv($y >= 0 ? $y : $y - 399, 400);
        $yoe = $y - $era * 400;
        $doy = intdiv(153 * ($m + ($m > 2 ? -3 : 9)) + 2, 5) + $d - 1;
        $doe = $yoe * 365 + intdiv($yoe, 4) - intdiv($yoe, 100) + $doy;

        return $era * 146097 + $doe - 719468;
    }

    /** @return array{int, int, int} */
    private static function civilFromDays(int $z): array
    {
        $z += 719468;
        $era = intdiv($z >= 0 ? $z : $z - 146096, 146097);
        $doe = $z - $era * 146097;
        $yoe = intdiv($doe - intdiv($doe, 1460) + intdiv($doe, 36524) - intdiv($doe, 146096), 365);
        $doy = $doe - (365 * $yoe + intdiv($yoe, 4) - intdiv($yoe, 100));
        $mp = intdiv(5 * $doy + 2, 153);
        $d = $doy - intdiv(153 * $mp + 2, 5) + 1;
        $m = $mp + ($mp < 10 ? 3 : -9);

        return [$yoe + $era * 400 + ($m <= 2 ? 1 : 0), $m, $d];
    }

    /** Date.prototype.toISOString */
    public static function iso(int|float $ms): string
    {
        $t = self::timeClip((float) $ms);
        if (is_float($t)) {
            throw new JsError('Invalid time value', 'RangeError');
        }
        $days = intdiv($t, 86400000) - ($t % 86400000 < 0 ? 1 : 0);
        $rem = $t - $days * 86400000;
        [$y, $m, $d] = self::civilFromDays($days);
        $year = $y >= 0 && $y <= 9999 ? sprintf('%04d', $y) : ($y < 0 ? '-' : '+') . sprintf('%06d', abs($y));

        return sprintf(
            '%s-%02d-%02dT%02d:%02d:%02d.%03dZ',
            $year, $m, $d,
            intdiv($rem, 3600000), intdiv($rem, 60000) % 60, intdiv($rem, 1000) % 60, $rem % 1000,
        );
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr(ord($b[6]) & 0x0F | 0x40);
        $b[8] = chr(ord($b[8]) & 0x3F | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    public static function random(): float
    {
        return random_int(0, (1 << 53) - 1) / 9007199254740992.0;
    }

    public static function log(string $level, mixed ...$args): void
    {
        $parts = array_map(
            static fn ($a) => is_array($a) || (is_object($a) && !$a instanceof RegExp) ? (self::jsonStringify($a) ?? 'undefined') : self::str($a),
            $args,
        );
        error_log('[zero] ' . ($level === 'log' ? '' : $level . ': ') . implode(' ', $parts));
    }
}
