<?php

declare(strict_types=1);

/*
 * Parity harness for Zero\Js: every case is a JS expression plus the PHP call the
 * compiler would emit for it. All JS runs in one `node` process (TZ=UTC); results
 * are compared with a typed comparison (NaN, ±Infinity and -0 are explicit).
 *
 * Strings: the runtime indexes by UTF-16 code unit, like JS, so astral cases are
 * plain native JS. A lone surrogate can't exist in PHP's UTF-8 strings (it becomes
 * U+FFFD); the one case that produces them maps the JS result through TextEncoder.
 */

require __DIR__ . '/../../runtime/Zero/bootstrap.php';

use Zero\Js;
use Zero\JsError;

$re = Js::re(...);

$cases = [
    // ---- numStr / str
    ['String(0.1 + 0.2)', fn () => Js::numStr(0.1 + 0.2)],
    ['String(1e21)', fn () => Js::numStr(1e21)],
    ['String(1e21 - 65536)', fn () => Js::numStr(1e21 - 65536)],
    ['String(1e-7)', fn () => Js::numStr(1e-7)],
    ['String(0.000001)', fn () => Js::numStr(0.000001)],
    ['String(-1.5e-7)', fn () => Js::numStr(-1.5e-7)],
    ['String(-0)', fn () => Js::numStr(-0.0)],
    ['String(123456789012345680000)', fn () => Js::numStr(123456789012345680000)],
    ['String(5e-324)', fn () => Js::numStr(5e-324)],
    ['String(1.7976931348623157e308)', fn () => Js::numStr(1.7976931348623157e308)],
    ['String(2 ** 53 + 2)', fn () => Js::numStr(2 ** 53 + 2)],
    // n(): an integer result past ±2^53 rounds to a double; postStep() steps through it.
    ['[2 ** 53 + 1, -(2 ** 53) - 1, 2 ** 53 * 3 + 1, 2 ** 53 - 1, 1 + 2]', fn () => [Js::n(2 ** 53 + 1), Js::n(-(2 ** 53) - 1), Js::n(2 ** 53 * 3 + 1), Js::n(2 ** 53 - 1), Js::n(1 + 2)]],
    // add/sub/mul/neg/pow: an exact int operand past ±2^53 (stored, or from input) is the double JS holds.
    ['(() => { const n = 9007199254740993, m = -9007199254740995; let k = n; const old = k++; return [old - 1, n + 1, n - 1, n * 1, -n, m + 2, n - m, n ** 1, k]; })()',
        function () { $n = 9007199254740993; $m = -9007199254740995; $k = $n; $old = Js::postStep($k, 1); return [$old - 1, Js::add($n, 1), Js::sub($n, 1), Js::mul($n, 1), Js::neg($n), Js::add($m, 2), Js::sub($n, $m), Js::pow($n, 1), $k]; }],
    ['(() => { let i = 2 ** 53; const old = i++; const pre = ++i; return [old, pre, i, i + 1 === i]; })()', function () { $i = 2 ** 53; $old = Js::postStep($i, 1); $pre = Js::preStep($i, 1); return [$old, $pre, $i, Js::n($i + 1) === $i]; }],
    ['String(100 / 3)', fn () => Js::numStr(100 / 3)],
    ['String(NaN) + String(-Infinity)', fn () => Js::numStr(NAN) . Js::numStr(-INF)],
    ['String([1, [2, null], "a", true])', fn () => Js::str([1, [2, null], 'a', true])],
    ['String({a: 1}) + String(null)', fn () => Js::str(['a' => 1]) . Js::str(null)],
    ['String(/a\/b/gi)', fn () => Js::str($re('a\/b', 'ig'))],

    // ---- toNumber / parseInt / parseFloat
    ['["", "  12  ", " \n 4.5e1  ", ".5", "5.", "-0", "+.5e-2"].map(Number)',
        fn () => array_map(Js::toNumber(...), ['', '  12  ', "\u{a0}\n 4.5e1 \u{2028}", '.5', '5.', '-0', '+.5e-2'])],
    ['["0x1F", "0b101", "0o17", "0X1f", "-0x10", "0x", "1_000", "12px", "Infinity", "-Infinity", "infinity", "1e400"].map(Number)',
        fn () => array_map(Js::toNumber(...), ['0x1F', '0b101', '0o17', '0X1f', '-0x10', '0x', '1_000', '12px', 'Infinity', '-Infinity', 'infinity', '1e400'])],
    ['[null, true, false, [], [7], [1, 2]].map(Number)', fn () => array_map(Js::toNumber(...), [null, true, false, [], [7], [1, 2]])],
    ['["08", "0x1F", "  -42px", "1e3", "", "-0", "9007199254740993", "123456789012345678901234567890", "+-1"].map(s => parseInt(s))',
        fn () => array_map(fn ($s) => Js::parseInt($s), ['08', '0x1F', '  -42px', '1e3', '', '-0', '9007199254740993', '123456789012345678901234567890', '+-1'])],
    ['["9007199254740993", "-9007199254740993", "9007199254740992", "0x20000000000001", "0o400000000000000001", "0b100000000000000000000000000000000000000000000000000001"].map(Number).map((n) => n - 1)',
        fn () => array_map(fn ($s) => Js::n(Js::toNumber($s) - 1), ['9007199254740993', '-9007199254740993', '9007199254740992', '0x20000000000001', '0o400000000000000001', '0b100000000000000000000000000000000000000000000000000001'])],
    ['(() => { const v = JSON.parse(\'{"n":9007199254740993,"l":[-9007199254740995,3]}\'); return [v.n - 1, v.l[0] + 1, v.l[1] + 1]; })()',
        function () { $v = Js::jsonParse('{"n":9007199254740993,"l":[-9007199254740995,3]}'); return [Js::n($v['n'] - 1), Js::n($v['l'][0] + 1), Js::n($v['l'][1] + 1)]; }],
    ['[2 ** 60, 2 ** 53 + 1, (-2) ** 3, 10 ** -2, 2 ** 0.5, 1 ** Infinity, (-1) ** -Infinity, 2 ** Infinity, 1 ** NaN]',
        fn () => [Js::pow(2, 60), Js::n(Js::pow(2, 53) + 1), Js::pow(-2, 3), Js::pow(10, -2), Js::pow(2, 0.5), Js::pow(1, INF), Js::pow(-1, -INF), Js::pow(2, INF), Js::pow(1, NAN)]],
    ['[parseInt("ff", 16), parseInt("0xff", 16), parseInt("0xff", 10), parseInt("102", 2), parseInt("z", 36), parseInt("1", 37), parseInt("10", 0), parseInt("10", 4.9), parseInt("10", -1)]',
        fn () => [Js::parseInt('ff', 16), Js::parseInt('0xff', 16), Js::parseInt('0xff', 10), Js::parseInt('102', 2), Js::parseInt('z', 36), Js::parseInt('1', 37), Js::parseInt('10', 0), Js::parseInt('10', 4.9), Js::parseInt('10', -1)]],
    ['["3.14abc", ".5", "-.5e-3x", "Infinityx", "-Infinity", "e5", "  1e400", "-0", "1.e2", "0x10"].map(parseFloat)',
        fn () => array_map(Js::parseFloat(...), ['3.14abc', '.5', '-.5e-3x', 'Infinityx', '-Infinity', 'e5', '  1e400', '-0', '1.e2', '0x10'])],

    // ---- truthy / typeof / equality / Number.*
    ['[null, 0, -0, NaN, "", "0", [], {}, 0.1].map(Boolean)', fn () => array_map(Js::truthy(...), [null, 0, -0.0, NAN, '', '0', [], ['a' => 1], 0.1])],
    ['[typeof null, typeof [], typeof 1.5, typeof "", typeof true, typeof (() => 1)]',
        fn () => [Js::typeOf(null), Js::typeOf([]), Js::typeOf(1.5), Js::typeOf(''), Js::typeOf(true), Js::typeOf(fn () => 1)]],
    ['[1 === 1.0, NaN === NaN, 0 === -0, "1" === 1]', fn () => [Js::strictEq(1, 1.0), Js::strictEq(NAN, NAN), Js::strictEq(0, -0.0), Js::strictEq('1', 1)]],
    ['[Number.isInteger(5.0), Number.isInteger(5.5), Number.isInteger("5"), Number.isFinite(Infinity), Number.isFinite(1e308)]',
        fn () => [Js::isInteger(5.0), Js::isInteger(5.5), Js::isInteger('5'), Js::isFinite(INF), Js::isFinite(1e308)]],

    // ---- toFixed
    ['[1.005.toFixed(2), 2.5.toFixed(0), (-1.5).toFixed(0), (-2.5).toFixed(0), 1.45.toFixed(1), 0.5.toFixed(0), 1.5.toFixed(0)]',
        fn () => [Js::toFixed(1.005, 2), Js::toFixed(2.5), Js::toFixed(-1.5), Js::toFixed(-2.5), Js::toFixed(1.45, 1), Js::toFixed(0.5), Js::toFixed(1.5)]],
    ['[(-0.0001).toFixed(2), (-0).toFixed(2), (42).toFixed(3), 1e21.toFixed(2), 123.456.toFixed(10), 5e-324.toFixed(3), 0.1.toFixed(20), 999.995.toFixed(2)]',
        fn () => [Js::toFixed(-0.0001, 2), Js::toFixed(-0.0, 2), Js::toFixed(42, 3), Js::toFixed(1e21, 2), Js::toFixed(123.456, 10), Js::toFixed(5e-324, 3), Js::toFixed(0.1, 20), Js::toFixed(999.995, 2)]],
    ['(1).toFixed(101)', fn () => Js::toFixed(1, 101)],

    // ---- slice / substring / charAt / at / indexOf
    ['["héllo".slice(1, -1), "héllo".slice(-3), "héllo".slice(2.9), "héllo".slice(-1.5), "héllo".slice(4, 2), "héllo".slice(NaN, 2)]',
        fn () => [Js::slice('héllo', 1, -1), Js::slice('héllo', -3), Js::slice('héllo', 2.9), Js::slice('héllo', -1.5), Js::slice('héllo', 4, 2), Js::slice('héllo', NAN, 2)]],
    ['((s) => [s.slice(-2), s.slice(5), s.slice(0, s.length - 2), s.slice(s.indexOf("🙂")), s.substring(-3, 2), s.substring(7, 1.7), s.substring(4), s.substring(2, Infinity)])("héllo🙂")',
        fn () => [Js::slice('héllo🙂', -2), Js::slice('héllo🙂', 5), Js::slice('héllo🙂', 0, Js::length('héllo🙂') - 2), Js::slice('héllo🙂', Js::indexOf('héllo🙂', '🙂')), Js::substring('héllo🙂', -3, 2), Js::substring('héllo🙂', 7, 1.7), Js::substring('héllo🙂', 4), Js::substring('héllo🙂', 2, INF)]],
    ['((s) => [s.charAt(0), s.charAt(-1), s.charAt(3), s.charAt(4), s.at(-1), s.at(-4), s.at(-5), s[3]])("a🙂b")',
        fn () => [Js::charAt('a🙂b', 0), Js::charAt('a🙂b', -1), Js::charAt('a🙂b', 3), Js::charAt('a🙂b', 4), Js::strAt('a🙂b', -1), Js::strAt('a🙂b', -4), Js::strAt('a🙂b', -5), Js::strAt('a🙂b', 3)]],
    ['((s) => [s.indexOf("aé"), s.indexOf("aé", 3), s.indexOf("🙂", 1), s.indexOf("", 99), s.indexOf("a", -5), s.lastIndexOf("aé"), s.lastIndexOf("aé", 5), s.lastIndexOf("🙂", -3), s.lastIndexOf("x"), s.lastIndexOf(""), s.lastIndexOf("", NaN)])("🙂aé🙂aé")',
        fn () => [Js::indexOf('🙂aé🙂aé', 'aé'), Js::indexOf('🙂aé🙂aé', 'aé', 3), Js::indexOf('🙂aé🙂aé', '🙂', 1), Js::indexOf('🙂aé🙂aé', '', 99), Js::indexOf('🙂aé🙂aé', 'a', -5), Js::lastIndexOf('🙂aé🙂aé', 'aé'), Js::lastIndexOf('🙂aé🙂aé', 'aé', 5), Js::lastIndexOf('🙂aé🙂aé', '🙂', -3), Js::lastIndexOf('🙂aé🙂aé', 'x'), Js::lastIndexOf('🙂aé🙂aé', ''), Js::lastIndexOf('🙂aé🙂aé', '', NAN)]],
    // An explicit null position is ToNumber(null) = 0, not an omitted argument (compiled
    // String.prototype.lastIndexOf gets `undefined` as omitted, decided at build time).
    ['["ab".lastIndexOf("b", null), "ab".lastIndexOf("b"), [1, 2].lastIndexOf(2, null), [1, 2].includes(1, null), "ab".at(null), [1, 2].at(null), "ab".indexOf("b", null)]',
        fn () => [Js::lastIndexOf('ab', 'b', null), Js::lastIndexOf('ab', 'b'), Js::lastIndexOf([1, 2], 2, null), Js::includes([1, 2], 1, null), Js::strAt('ab', null), Js::arrAt([1, 2], null), Js::indexOf('ab', 'b', null)]],
    // Whole characters round-trip through unit indexes.
    ['["a🙂b".slice(1, 3), "a🙂".charAt(0), "🙂x".slice(2), "a".padEnd(3, "🙂"), "🙂".at(-3) ?? null]',
        fn () => [Js::slice('a🙂b', 1, 3), Js::charAt('a🙂', 0), Js::slice('🙂x', 2), Js::padEnd('a', 3, '🙂'), Js::strAt('🙂', -3)]],

    // ---- split
    ['["a,b,,c".split(",", 2), "abc".split(""), "".split(""), "".split(","), "a,b".split(",", 0), "ab".split("", -1), "a,b".split(",", 2.7)]',
        fn () => [Js::split('a,b,,c', ',', 2), Js::split('abc', ''), Js::split('', ''), Js::split('', ','), Js::split('a,b', ',', 0), Js::split('ab', '', -1), Js::split('a,b', ',', 2.7)]],
    ['["a1b2c3".split(/\d/), "a1b2c3".split(/(\d)/, 4), "abc".split(/(?:)/), "".split(/x/), "".split(/(?:)/), "a, b ,c".split(/\s*,\s*/), "ab".split(/(x)?/)]',
        fn () => [Js::split('a1b2c3', $re('\d', '')), Js::split('a1b2c3', $re('(\d)', ''), 4), Js::split('abc', $re('(?:)', '')), Js::split('', $re('x', '')), Js::split('', $re('(?:)', '')), Js::split('a, b ,c', $re('\s*,\s*', '')), Js::split('ab', $re('(x)?', ''))]],

    // ---- pad / trim / repeat
    ['["5".padStart(3, "0"), "abc".padStart(10, "123"), "abc".padStart(2), "abc".padEnd(6.9, "xy"), "x".padStart(3, ""), "é".padEnd(3, "ü"), "🙂".padStart(4, "x"), "🙂".padStart(2, "x"), "a".padEnd(5, "🙂")]',
        fn () => [Js::padStart('5', 3, '0'), Js::padStart('abc', 10, '123'), Js::padStart('abc', 2), Js::padEnd('abc', 6.9, 'xy'), Js::padStart('x', 3, ''), Js::padEnd('é', 3, 'ü'), Js::padStart('🙂', 4, 'x'), Js::padStart('🙂', 2, 'x'), Js::padEnd('a', 5, '🙂')]],
    ['[" ﻿ x  \t".trim(), " x ".trimStart(), " x ".trimEnd(), "​x".trim()]',
        fn () => [Js::trim("\u{a0}\u{feff} x \u{2028}\t"), Js::trimStart(' x '), Js::trimEnd(' x '), Js::trim("\u{200b}x")]],
    ['["ab".repeat(2.9), "x".repeat(0)]', fn () => [Js::repeat('ab', 2.9), Js::repeat('x', 0)]],
    ['"x".repeat(-1)', fn () => Js::repeat('x', -1)],

    // ---- replace / replaceAll
    ['["aaa".replace("a", "b"), "abc".replace("b", "[$&|$`|$\'|$$|$1]"), "abc".replace("x", "y"), "abc".replace("", "_")]',
        fn () => [Js::replace('aaa', 'a', 'b'), Js::replace('abc', 'b', '[$&|$`|$\'|$$|$1]'), Js::replace('abc', 'x', 'y'), Js::replace('abc', '', '_')]],
    ['"2020-01-02".replace(/(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)/, "$<d>.$<m>.$<y> $<nope>|$2")',
        fn () => Js::replace('2020-01-02', $re('(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)', ''), '$<d>.$<m>.$<y> $<nope>|$2')],
    ['["abc".replace(/(b)/g, "$1$1$2$<x>"), "abc".replace(/(b)/, "$10"), "abcabc".replace(/b/, "X"), "abcabc".replace(/B/gi, "X"), "aaa".replace(/a*?/g, "-")]',
        fn () => [Js::replace('abc', $re('(b)', 'g'), '$1$1$2$<x>'), Js::replace('abc', $re('(b)', ''), '$10'), Js::replace('abcabc', $re('b', ''), 'X'), Js::replace('abcabc', $re('B', 'gi'), 'X'), Js::replace('aaa', $re('a*?', 'g'), '-')]],
    ['["a1b22".replace(/\d+/g, (m, off) => `[${m}@${off}]`), "x=1,y=2".replace(/(\w)=(\d)/g, (m, k, v) => v + k), "🙂1é2".replace(/\d/g, (m, o, s) => o + s.length), "ab".replace(/(x)?b/, (m, g) => g ?? "unset")]',
        fn () => [Js::replace('a1b22', $re('\d+', 'g'), fn ($m, $off) => "[$m@$off]"), Js::replace('x=1,y=2', $re('(\w)=(\d)', 'g'), fn ($m, $k, $v) => $v . $k), Js::replace('🙂1é2', $re('\d', 'g'), fn ($m, $o, $s) => $o + Js::length($s)), Js::replace('ab', $re('(x)?b', ''), fn ($m, $g) => $g ?? 'unset')]],
    ['["a.b.c".replaceAll(".", "-"), "aaa".replaceAll("", "-"), "aXbX".replaceAll(/x/gi, (m) => m.toLowerCase())]',
        fn () => [Js::replaceAll('a.b.c', '.', '-'), Js::replaceAll('aaa', '', '-'), Js::replaceAll('aXbX', $re('x', 'gi'), fn ($m) => strtolower($m))]],
    ['"a".replaceAll(/a/, "b")', fn () => Js::replaceAll('a', $re('a', ''), 'b')],

    // ---- RegExp translation
    ['[/HELLO/i.test("hello"), /a.b/s.test("a\nb"), /a.b/.test("a\nb"), /a.b/.test("a b"), /^.$/u.test("🙂"), /^\d$/.test("٣"), /^\w$/.test("é"), /^\s$/.test(" ")]',
        fn () => [$re('HELLO', 'i')->test('hello'), $re('a.b', 's')->test("a\nb"), $re('a.b', '')->test("a\nb"), $re('a.b', '')->test("a\u{2028}b"), $re('^.$', 'u')->test('🙂'), $re('^\d$', '')->test('٣'), $re('^\w$', '')->test('é'), $re('^\s$', '')->test("\u{a0}")]],
    ['["a\nb".replace(/^/gm, "> "), "a\n".replace(/$/, "!"), "a\nb\n".replace(/$/gm, ";"), "café x".replace(/\b/g, "|")]',
        fn () => [Js::replace("a\nb", $re('^', 'gm'), '> '), Js::replace("a\n", $re('$', ''), '!'), Js::replace("a\nb\n", $re('$', 'gm'), ';'), Js::replace('café x', $re('\b', 'g'), '|')]],
    ['["$12 €34 $5".match(/(?<=\$)\d+/g), "ax cx bx".match(/(?<=ab|c)x/g), "price: 42".match(/(?<!\d)\d(?<num>\d)/), "b".match(/(a)?b/), "xyz".match(/q/g)]',
        fn () => [Js::strMatch('$12 €34 $5', $re('(?<=\$)\d+', 'g')), Js::strMatch('ax cx bx', $re('(?<=ab|c)x', 'g')), Js::strMatch('price: 42', $re('(?<!\d)\d(?<num>\d)', '')), Js::strMatch('b', $re('(a)?b', '')), Js::strMatch('xyz', $re('q', 'g'))]],
    ['[/(a)?b\1/.test("b"), /^(?<q>["\x27]).*\k<q>$/.test("\x27hi\x27"), /[^]/.test("\n"), /[]/.test("a"), /[\d\-x]/.test("-"), /^[\w\s]+$/.test("a b_1"), /^[^\W\d]+$/.test("ab"), /^[\D]$/.test("5")]',
        fn () => [$re('(a)?b\1', '')->test('b'), $re('^(?<q>["\x27]).*\k<q>$', '')->test("'hi'"), $re('[^]', '')->test("\n"), $re('[]', '')->test('a'), $re('[\d\-x]', '')->test('-'), $re('^[\w\s]+$', '')->test('a b_1'), $re('^[^\W\d]+$', '')->test('ab'), $re('^[\D]$', '')->test('5')]],
    ['[/é/.test("é"), /\u{1F642}/u.test("🙂"), /🙂/.test("🙂"), /a\/b/.test("a/b"), /\x41\t/.test("A\t"), /^\p{Lu}+$/u.test("ÀB"), /É/i.test("é"), /[a-z]/i.test("K")]',
        fn () => [$re('é', '')->test('é'), $re('\u{1F642}', 'u')->test('🙂'), $re('🙂', '')->test('🙂'), $re('a\/b', '')->test('a/b'), $re('\x41\t', '')->test("A\t"), $re('^\p{Lu}+$', 'u')->test('ÀB'), $re('É', 'i')->test('é'), $re('[a-z]', 'i')->test('K')]],
    ['[/x/gimsu.flags, /x/.source, new RegExp("").source, /a/g.global]', fn () => [$re('x', 'usmig')->flags, $re('x', '')->source, $re('', '')->source, $re('a', 'g')->global]],
    ['new RegExp("(", "")', fn () => $re('(', '')],

    // ---- sort / arrays
    ['[10, 9, 1].sort()', function () { $a = [10, 9, 1]; Js::sort($a); return $a; }],
    ['["b", "a", 10, 9, true, null, "B", "｡", "🙂"].sort()', function () { $a = ['b', 'a', 10, 9, true, null, 'B', "\u{ff61}", '🙂']; Js::sort($a); return $a; }],
    ['[[3, 1, 2].sort((a, b) => b - a), [0.3, 0.1, 0.2].sort((a, b) => a - b), [{k: 1, i: 0}, {k: 0, i: 1}, {k: 1, i: 2}, {k: 0, i: 3}].sort((a, b) => a.k - b.k).map(o => o.i)]',
        fn () => [Js::sorted([3, 1, 2], fn ($a, $b) => $b - $a), Js::sorted([0.3, 0.1, 0.2], fn ($a, $b) => $a - $b), array_column(Js::sorted([['k' => 1, 'i' => 0], ['k' => 0, 'i' => 1], ['k' => 1, 'i' => 2], ['k' => 0, 'i' => 3]], fn ($a, $b) => $a['k'] - $b['k']), 'i')]],
    ['(() => { const a = [1, 2, 3, 4, 5]; const r = a.splice(-2, 1, "x", "y"); return [a, r, a.slice(-2), a.slice(1, -10), a.at(-1), a.at(9)]; })()',
        function () { $a = [1, 2, 3, 4, 5]; $r = Js::splice($a, -2, 1, 'x', 'y'); return [$a, $r, Js::arrSlice($a, -2), Js::arrSlice($a, 1, -10), Js::arrAt($a, -1), Js::arrAt($a, 9)]; }],
    ['(() => { const a = [1, 2, 3]; a.splice(1); const b = [1, 2, 3, 4]; b.fill(0, -3, -1); const c = [1, 2]; c.reverse(); return [a, b, c]; })()',
        function () { $a = [1, 2, 3]; Js::splice($a, 1); $b = [1, 2, 3, 4]; Js::fill($b, 0, -3, -1); $c = [1, 2]; Js::reverse($c); return [$a, $b, $c]; }],
    ['[[NaN].includes(NaN), [NaN].indexOf(NaN), [1, 2, 1].lastIndexOf(1), [0].includes(-0), [1, "1"].indexOf("1"), [1, 2, 3].indexOf(1, -2)]',
        fn () => [Js::includes([NAN], NAN), Js::indexOf([NAN], NAN), Js::lastIndexOf([1, 2, 1], 1), Js::includes([0], -0.0), Js::indexOf([1, '1'], '1'), Js::indexOf([1, 2, 3], 1, -2)]],
    ['[[1, [2, [3, [4]]]].flat(), [1, [2, [3, [4]]]].flat(Infinity), [1, 2].flatMap(x => [x, [x * 10]]), [null, 1, "a"].join("-"), [[1, 2], [3]].join(";")]',
        fn () => [Js::flat([1, [2, [3, [4]]]]), Js::flat([1, [2, [3, [4]]]], INF), Js::flatMap([1, 2], fn ($x) => [$x, [$x * 10]]), Js::join([null, 1, 'a'], '-'), Js::join([[1, 2], [3]], ';')]],
    ['[[1, 2, 3].reduce((a, b) => a + b), [].reduce((a, b) => a + b, "init"), [5, 6].map((x, i) => x * i), [0, 1, "", "x"].filter(x => x), [1, 2, 3].findLast(x => x < 3), [1, 2].findIndex(x => x > 5), [].every(x => false), [1].some(x => x)]',
        fn () => [Js::reduce([1, 2, 3], fn ($a, $b) => $a + $b), Js::reduce([], fn ($a, $b) => $a + $b, 'init'), Js::map([5, 6], fn ($x, $i) => $x * $i), Js::filter([0, 1, '', 'x'], fn ($x) => $x), Js::findLast([1, 2, 3], fn ($x) => $x < 3), Js::findIndex([1, 2], fn ($x) => $x > 5), Js::every([], fn ($x) => false), Js::some([1], fn ($x) => $x)]],
    ['[].reduce((a, b) => a + b)', fn () => Js::reduce([], fn ($a, $b) => $a + $b)],
    ['[Math.max(), Math.min(), Math.max(1, NaN, 3), Math.max(-0, 0), Math.min(0, -0), Math.max(2, 7.5, 3)]',
        fn () => [Js::max(), Js::min(), Js::max(1, NAN, 3), Js::max(-0.0, 0), Js::min(0, -0.0), Js::max(2, 7.5, 3)]],
    ['Array.from({length: 3}, (_, i) => i * i)', fn () => Js::range(3, fn ($i) => $i * $i)],

    // ---- objects
    ['(() => { const o = {b: 1, 2: "two", a: [1], 1: "one"}; return [Object.keys(o), Object.values(o), Object.entries(o)]; })()',
        function () { $o = ['b' => 1, 2 => 'two', 'a' => [1], 1 => 'one']; return [Js::keys($o), Js::values($o), Js::entries($o)]; }],
    ['(() => { const {a, ...rest} = {a: 1, b: 2, c: 3}; return [rest, Object.fromEntries([["x", 1], ["y", [2]]]), Object.hasOwn({k: null}, "k")]; })()',
        fn () => [Js::omit(['a' => 1, 'b' => 2, 'c' => 3], ['a']), Js::fromEntries([['x', 1], ['y', [2]]]), Js::hasOwn(['k' => null], 'k')]],

    // ---- JSON
    ['JSON.stringify({a: [1, {b: 2}], c: "x/é \"", d: 1.0, e: NaN, f: -0, g: [], h: 1e21, i: () => 1, j: [() => 1, Infinity]}, null, 2)',
        fn () => Js::jsonStringify(['a' => [1, ['b' => 2]], 'c' => "x/é\u{2028}\"", 'd' => 1.0, 'e' => NAN, 'f' => -0.0, 'g' => [], 'h' => 1e21, 'i' => fn () => 1, 'j' => [fn () => 1, INF]], 2)],
    ['[JSON.stringify([1, [2]], null, "\t"), JSON.stringify({a: 1}, null, 20), JSON.stringify({a: 1}, null, "abcd🙂🙂🙂🙂"), JSON.stringify({b: 1, 2: 1, 1: 1}), JSON.stringify(() => 1), JSON.stringify("\u0007"), JSON.stringify([1], null, 0), JSON.stringify(0.1 + 0.2)]',
        fn () => [Js::jsonStringify([1, [2]], "\t"), Js::jsonStringify(['a' => 1], 20), Js::jsonStringify(['a' => 1], 'abcd🙂🙂🙂🙂'), Js::jsonStringify(['b' => 1, 2 => 1, 1 => 1]), Js::jsonStringify(fn () => 1), Js::jsonStringify("\u{7}"), Js::jsonStringify([1], 0), Js::jsonStringify(0.1 + 0.2)]],
    ['JSON.parse("{\"a\": [1, 2.5, null, \"x\"], \"b\": {\"c\": true}}")', fn () => Js::jsonParse('{"a": [1, 2.5, null, "x"], "b": {"c": true}}')],
    // {} stays an object through parse and stringify, also beside a key PHP objects can't hold ("\u0000k").
    // sameJson: structural equality that tells {} from [] (two decoded {} are equal; {} is not []).
    ['[JSON.stringify({a:{}}) === JSON.stringify({a:{}}), JSON.stringify({a:{}}) === JSON.stringify({a:[]}), JSON.stringify([1,{}]) === JSON.stringify([1,{}])]',
        fn () => [Js::sameJson(Js::decodeJson('{"a":{}}'), Js::decodeJson('{"a":{}}')), Js::sameJson(Js::decodeJson('{"a":{}}'), Js::decodeJson('{"a":[]}')), Js::sameJson(Js::decodeJson('[1,{}]'), Js::decodeJson('[1,{}]'))]],
    ['JSON.stringify(JSON.parse(JSON.stringify({ a: {}, b: [], [String.fromCharCode(0) + "k"]: { e: {} } })))', fn () => Js::jsonStringify(Js::jsonParse('{"a":{},"b":[],"\\u0000k":{"e":{}}}'))],
    ['JSON.parse("{bad")', fn () => Js::jsonParse('{bad')],

    // ---- dates
    ['["2020-01-01", "2020-01-01T10:00", "2020-01-01 10:00", "2020-02", "2021-02-30", "2020-13-01", "2020-01-01T24:00:00Z", "2020-01-01T24:00:01Z", "2020-01-01T24:00:00.0000Z", "2020-01-01T24:00:00.0001Z", "+002020-01-01", "-000001-01-01T00:00:00Z", "2020-01-01T10:00:00.123456Z", "2020-01-01T10:00:00+05:30", "2020-01-01T10Z", "nope"].map(s => new Date(s).getTime())',
        fn () => array_map(Js::date(...), ['2020-01-01', '2020-01-01T10:00', '2020-01-01 10:00', '2020-02', '2021-02-30', '2020-13-01', '2020-01-01T24:00:00Z', '2020-01-01T24:00:01Z', '2020-01-01T24:00:00.0000Z', '2020-01-01T24:00:00.0001Z', '+002020-01-01', '-000001-01-01T00:00:00Z', '2020-01-01T10:00:00.123456Z', '2020-01-01T10:00:00+05:30', '2020-01-01T10Z', 'nope'])],
    ['[new Date(1.9).getTime(), new Date(8.64e15 + 1).getTime(), new Date(null).getTime()]', fn () => [Js::date(1.9), Js::date(8.64e15 + 1), Js::date(null)]],
    ['[0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000].map(ms => new Date(ms).toISOString())',
        fn () => array_map(Js::iso(...), [0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000])],
    ['new Date(NaN).toISOString()', fn () => Js::iso(NAN)],
];

// ---------------------------------------------------------------- run node once

$node = getenv('NODE') ?: 'node';
$prelude = <<<'JS'
const T = (v) => {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $: 'NaN' };
    if (!Number.isFinite(v)) return { $: v > 0 ? 'Infinity' : '-Infinity' };
    return Object.is(v, -0) ? { $: '-0' } : v;
  }
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'boolean') return v ?? null;
  if (Array.isArray(v)) return Array.from(v, T);
  return { o: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, T(x)])) };
};
const out = [];
const run = (f) => { try { out.push(T(f())); } catch (e) { out.push({ $err: e.name }); } };
JS;
$js = $prelude . "\n" . implode("\n", array_map(fn ($c) => "run(() => ({$c[0]}));", $cases)) . "\nprocess.stdout.write(JSON.stringify(out));\n";
$file = tempnam(sys_get_temp_dir(), 'zero-parity-') . '.js';
file_put_contents($file, $js);
$raw = shell_exec('TZ=UTC ' . escapeshellarg($node) . ' ' . escapeshellarg($file) . ' 2>&1');
unlink($file);
$expected = json_decode((string) $raw, true);
if (!is_array($expected) || count($expected) !== count($cases)) {
    fwrite(STDERR, "node did not produce one result per case:\n$raw\n");
    exit(2);
}

// ---------------------------------------------------------------- compare

/** Typed comparison of a PHP value against a tagged JS value. Returns null when equal, else a reason. */
function mismatch(mixed $actual, mixed $exp, string $path = ''): ?string
{
    $show = fn ($v) => is_float($v) ? sprintf('%.17g', $v) : var_export($v, true);
    if (is_array($exp) && isset($exp['$'])) {
        $special = ['NaN' => NAN, 'Infinity' => INF, '-Infinity' => -INF, '-0' => -0.0][$exp['$']];
        $ok = is_float($actual) && (is_nan($special) ? is_nan($actual) : ($actual === $special && (fdiv(1, $actual) < 0) === (fdiv(1, $special) < 0)));

        return $ok ? null : "$path: expected {$exp['$']}, got " . $show($actual);
    }
    if (is_int($exp) || is_float($exp)) {
        $ok = (is_int($actual) || is_float($actual)) && (float) $actual === (float) $exp
            && !(is_float($actual) && $actual === 0.0 && fdiv(1, $actual) < 0);

        return $ok ? null : "$path: expected " . $show($exp) . ', got ' . $show($actual);
    }
    if (is_array($exp) && isset($exp['o']) && count($exp) === 1 && is_array($exp['o'])) {
        if (!is_array($actual) || ($actual !== [] && array_is_list($actual) && $exp['o'] !== [])) {
            return "$path: expected object, got " . json_encode($actual);
        }
        if (array_map('strval', array_keys($actual)) !== array_map('strval', array_keys($exp['o']))) {
            return "$path: keys differ: " . json_encode(array_keys($actual)) . ' vs ' . json_encode(array_keys($exp['o']));
        }
        foreach ($exp['o'] as $k => $v) {
            if (($r = mismatch($actual[$k], $v, "$path.$k")) !== null) {
                return $r;
            }
        }

        return null;
    }
    if (is_array($exp) && array_is_list($exp)) {
        if (!is_array($actual) || !array_is_list($actual) || count($actual) !== count($exp)) {
            return "$path: expected " . json_encode($exp, JSON_UNESCAPED_UNICODE) . ', got ' . json_encode($actual, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        }
        foreach ($exp as $i => $v) {
            if (($r = mismatch($actual[$i], $v, "{$path}[$i]")) !== null) {
                return $r;
            }
        }

        return null;
    }

    return $actual === $exp ? null : "$path: expected " . $show($exp) . ', got ' . $show($actual);
}

// Documented deviations from JS (contract-defined), asserted directly against PHP.
$deviations = [
    ['String(undefined): undefined is null in the value model', fn () => Js::str(null), 'null'],
    ['RegExp y flag is rejected', fn () => $re('a', 'y'), ['$err' => 'SyntaxError']],
    ['non-ISO date strings are NaN (no legacy parser fallback)', fn () => is_nan(Js::date('2020-1-1')), true],
    ['localeCompare is byte order', fn () => [Js::localeCompare('a', 'B'), Js::localeCompare('é', 'f')], [1, 1]],
    // A lone surrogate can't live in a UTF-8 string; any stand-in would merge distinct JS values.
    ['charAt splitting a pair throws', fn () => Js::charAt('a🙂', 1), ['$err' => 'RangeError']],
    ['slice splitting a pair throws', fn () => Js::slice('🙂', 0, 1), ['$err' => 'RangeError']],
    ['split("") on a pair throws', fn () => Js::split('a🙂b', ''), ['$err' => 'RangeError']],
    ['split("", limit) stops before a pair past the limit', fn () => Js::split('a🙂b', '', 1), ['a']],
    ['split("", limit) splitting a pair within the limit throws', fn () => Js::split('a🙂b', '', 2), ['$err' => 'RangeError']],
    ['padEnd cutting a pair throws', fn () => Js::padEnd('a', 2, '🙂'), ['$err' => 'RangeError']],
];

$passed = 0;
$failed = 0;
foreach ($deviations as [$label, $php, $want]) {
    try {
        $got = $php();
    } catch (JsError $e) {
        $got = ['$err' => $e->jsName];
    }
    if ($got === $want) {
        $passed++;
    } else {
        $failed++;
        echo "FAIL  deviation: $label\n      got " . json_encode($got) . "\n";
    }
}
foreach ($cases as $i => [$jsExpr, $php]) {
    try {
        $actual = $php();
    } catch (JsError $e) {
        $actual = ['$err' => $e->jsName];
    }
    $exp = $expected[$i];
    $reason = is_array($exp) && isset($exp['$err'])
        ? ($actual === $exp ? null : "expected throw {$exp['$err']}, got " . json_encode($actual, JSON_PARTIAL_OUTPUT_ON_ERROR))
        : (is_array($actual) && isset($actual['$err']) && count($actual) === 1 ? "threw {$actual['$err']}" : mismatch($actual, $exp));
    if ($reason === null) {
        $passed++;
    } else {
        $failed++;
        echo "FAIL  $jsExpr\n      $reason\n";
    }
}
echo "js_parity: $passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
