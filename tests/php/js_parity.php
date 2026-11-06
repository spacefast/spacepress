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
use Zero\JsArray;
use Zero\JsObject;

function jsValue(mixed $value): mixed { return \Zero\Seam::toJs($value, ['type' => 'json']); }

// Other WordPress plugins may change this setting; Zero strings remain UTF-8.
mb_internal_encoding('ISO-8859-1');

$re = Js::re(...);

$cases = [
    // Imported JS values use checked dynamic operations, with undefined distinct from null.
    ['(() => { const v = {present: null}; return [v.present === null, typeof v.missing, Boolean(v.missing), String(v.missing), Number.isNaN(Number(v.missing)), JSON.stringify({a: undefined, b: null, c: [undefined]})]; })()',
        function () { $v = new JsObject(['present' => null]); $missing = Js::dynamicGet($v, 'missing'); return [Js::dynamicGet($v, 'present') === null, Js::typeOf($missing), Js::truthy($missing), Js::str($missing), is_nan(Js::toNumber($missing)), Js::jsonStringify(new JsObject(['a' => $missing, 'b' => null, 'c' => new JsArray([$missing])]))]; }],
    ['(() => { const a = [1, 2]; a.extra = null; a[1] = 4; const o = {10: 1, 2: 1, z: 1, a: 1}; return [Object.keys(a), a.length, a[1], a.extra, Object.keys(o), Object.keys("🙂"), Object.keys(3)]; })()',
        function () { $a = new JsArray([1, 2]); Js::dynamicSet($a, 'extra', null); Js::dynamicSet($a, '1', 4); return [Js::dynamicKeys($a), Js::dynamicGet($a, 'length'), Js::dynamicGet($a, '1'), Js::dynamicGet($a, 'extra'), Js::dynamicKeys(new JsObject(['10' => 1, '2' => 1, 'z' => 1, 'a' => 1])), Js::dynamicKeys('🙂'), Js::dynamicKeys(3)]; }],
    ['(function () { "use strict"; const a = arguments; a.length = 1; a[5] = null; return [Array.isArray(a), a.length, Object.keys(a), JSON.stringify(a), a.caller === undefined, Object.hasOwn(a,"length"), Object.hasOwn(a,"callee")]; })(3, 4)',
        function () { $a = Js::arguments([3, 4]); Js::dynamicSet($a, 'length', 1); Js::dynamicSet($a, '5', null); return [$a instanceof JsArray, Js::dynamicGet($a, 'length'), Js::dynamicKeys($a), Js::jsonStringify($a), Js::dynamicGet($a, 'caller') === Js::undefined(), Js::dynamicStaticCall('Object', 'hasOwn', new JsArray([$a, 'length'])), Js::dynamicStaticCall('Object', 'hasOwn', new JsArray([$a, 'callee']))]; }],
    ['[[] == 0, false == "0", null == undefined, NaN == NaN, "" == 0, [1] == true, {} == "[object Object]", {} == {}]',
        fn () => [Js::looseEq(new JsArray(), 0), Js::looseEq(false, '0'), Js::looseEq(null, Js::undefined()), Js::looseEq(NAN, NAN), Js::looseEq('', 0), Js::looseEq(new JsArray([1]), true), Js::looseEq(new JsObject(), '[object Object]'), Js::looseEq(new JsObject(), new JsObject())]],
    ['["ab".slice(0, null), "ab".slice(0, undefined), "ab".charCodeAt(5), "éCOLE".toLowerCase(), "Straße".toUpperCase()]',
        fn () => [Js::dynamicCallMethod('ab', 'slice', new JsArray([0, null])), Js::dynamicCallMethod('ab', 'slice', new JsArray([0, Js::undefined()])), Js::dynamicCallMethod('ab', 'charCodeAt', new JsArray([5])), Js::dynamicCallMethod('éCOLE', 'toLowerCase', new JsArray()), Js::dynamicCallMethod('Straße', 'toUpperCase', new JsArray())]],
    ['(() => { const r = /(a)?b/g; const m = r.exec("🙂b ab"); const n = r.exec("🙂b ab"); const end = r.exec("🙂b ab"); return [m.index, m[1] === undefined, n.index, n[1], end, r.lastIndex]; })()',
        function () { $r = new \Zero\RegExp('(a)?b', 'g'); $m = Js::dynamicRegExpExec($r, '🙂b ab'); $n = Js::dynamicRegExpExec($r, '🙂b ab'); $end = Js::dynamicRegExpExec($r, '🙂b ab'); return [Js::dynamicGet($m, 'index'), Js::dynamicGet($m, '1') === Js::undefined(), Js::dynamicGet($n, 'index'), Js::dynamicGet($n, '1'), $end, $r->lastIndex]; }],
    ['(() => { const s = new Set([1, 1, NaN, NaN]); const m = new Map([["a", 1], ["a", 2], [null, 3]]); return [[...s], [...m], s.size, m.get(null), m.has("x"), Object.prototype.toString.call(s), Object.prototype.toString.call(m), new Date(0).toISOString()]; })()',
        function () { $s = Js::dynamicConstruct('Set', new JsArray([new JsArray([1, 1, NAN, NAN])])); $m = Js::dynamicConstruct('Map', new JsArray([new JsArray([new JsArray(['a', 1]), new JsArray(['a', 2]), new JsArray([null, 3])])])); return [Js::dynamicIterable($s), Js::dynamicIterable($m), Js::dynamicGet($s, 'size'), Js::dynamicCallMethod($m, 'get', new JsArray([null])), Js::dynamicCallMethod($m, 'has', new JsArray(['x'])), Js::dynamicObjectTag($s), Js::dynamicObjectTag($m), Js::dynamicCallMethod(Js::dynamicConstruct('Date', new JsArray([0])), 'toISOString', new JsArray())]; }],
    ['[Array.from({0:"a", 1:null, length:2}, (v,i) => String(v)+i), Math.round(-0.2), Math.min(), Number.isFinite("3"), JSON.stringify(undefined)]',
        fn () => [Js::dynamicStaticCall('Array', 'from', new JsArray([new JsObject(['0' => 'a', '1' => null, 'length' => 2]), static fn ($v, $i) => Js::str($v) . $i])), Js::dynamicStaticCall('Math', 'round', new JsArray([-0.2])), Js::dynamicStaticCall('Math', 'min', new JsArray()), Js::dynamicStaticCall('Number', 'isFinite', new JsArray(['3'])), Js::dynamicStaticCall('JSON', 'stringify', new JsArray([Js::undefined()])) === Js::undefined() ? null : false]],
    ['[...["at","pop","shift","find","findLast","forEach"].map(n => [][n](() => false) === undefined), [null].find(() => true) === null, Object.fromEntries([["x"]]).x === undefined, Object.hasOwn([], "length")]',
        function () { $values = array_map(static fn ($name) => Js::dynamicCallMethod(new JsArray(), $name, new JsArray([static fn () => false])) === Js::undefined(), ['at', 'pop', 'shift', 'find', 'findLast', 'forEach']); return [...$values, Js::dynamicCallMethod(new JsArray([null]), 'find', new JsArray([static fn () => true])) === null, Js::dynamicGet(Js::dynamicStaticCall('Object', 'fromEntries', new JsArray([new JsArray([new JsArray(['x'])])])), 'x') === Js::undefined(), Js::dynamicStaticCall('Object', 'hasOwn', new JsArray([new JsArray(), 'length']))]; }],
    ['[(() => {const a=[1,2]; return Array.from(a,(v,i)=>{if(i===0)a[1]=9;return v})})(), (() => {const a={0:1,1:2,length:2}; return Array.from(a,(v,i)=>{if(i===0)a[1]=9;return v})})()]',
        function () { return array_map(static function ($a) { return Js::dynamicStaticCall('Array', 'from', new JsArray([$a, static function ($value, $i) use ($a) { if ($i === 0) { Js::dynamicSet($a, '1', 9); } return $value; }])); }, [new JsArray([1, 2]), new JsObject(['0' => 1, '1' => 2, 'length' => 2])]); }],
    ['(() => { const r=/(x)?b/; const m="ab".match(r); const g=/a/g; g.lastIndex=1; const all="aa".match(g); g.lastIndex=1; const text="aa".replace(g,"x"); return [m[1]===undefined,m.index,m.input,"ab".split(/(x)?/)[1]===undefined,"b".replace(/(a)?b/,(m,g)=>typeof g),all,text,g.lastIndex]; })()',
        function () { $m = Js::dynamicCallMethod('ab', 'match', new JsArray([new \Zero\RegExp('(x)?b')])); $g = new \Zero\RegExp('a', 'g'); $g->lastIndex = 1; $all = Js::dynamicCallMethod('aa', 'match', new JsArray([$g])); $afterMatch = $g->lastIndex; $g->lastIndex = 1; $text = Js::dynamicCallMethod('aa', 'replace', new JsArray([$g, 'x'])); return [Js::dynamicGet($m, '1') === Js::undefined(), Js::dynamicGet($m, 'index'), Js::dynamicGet($m, 'input'), Js::dynamicCallMethod('ab', 'split', new JsArray([new \Zero\RegExp('(x)?')]))->a[1] === Js::undefined(), Js::dynamicCallMethod('b', 'replace', new JsArray([new \Zero\RegExp('(a)?b'), static fn ($m, $capture) => Js::typeOf($capture)])), $all, $text, $g->lastIndex + $afterMatch]; }],
    ['(() => {const a=[1,2]; const f=a.join; a.join=()=>"own"; const o={m:()=>1}; const n=o.m(o.m=()=>2); return [typeof f, f.call(a,"-"), a.join(), n, Math.min.apply(Math,[3,1]), Object.prototype.toString.call(Math), Object.keys(Math), JSON.stringify(Math)];})()',
        function () { $a = new JsArray([1, 2]); $f = Js::dynamicGet($a, 'join'); Js::dynamicSet($a, 'join', static fn () => 'own'); $o = new JsObject(['m' => static fn () => 1]); $method = Js::dynamicMethod($o, 'm'); $n = $method(Js::dynamicSet($o, 'm', static fn () => 2)); $math = Js::dynamicNamespace('Math'); return [Js::typeOf($f), Js::dynamicCallMethod($f, 'call', new JsArray([$a, '-'])), Js::dynamicCallMethod($a, 'join', new JsArray()), $n, Js::dynamicCallMethod(Js::dynamicGet($math, 'min'), 'apply', new JsArray([$math, new JsArray([3, 1])])), Js::dynamicObjectTag($math), Js::dynamicKeys($math), Js::jsonStringify($math)]; }],
    ['[Math.round(0.49999999999999994), Math.round(4503599627370497), "abc".endsWith("ab",-1), "abc".split(undefined,0)]',
        fn () => [Js::dynamicStaticCall('Math', 'round', new JsArray([0.49999999999999994])), Js::dynamicStaticCall('Math', 'round', new JsArray([4503599627370497])), Js::dynamicCallMethod('abc', 'endsWith', new JsArray(['ab', -1])), Js::dynamicCallMethod('abc', 'split', new JsArray([Js::undefined(), 0]))]],
    ['"foo".includes(/foo/)', fn () => Js::dynamicCallMethod('foo', 'includes', new JsArray([new \Zero\RegExp('foo')]))],
    ['(() => { const e = Error("bad input"); return [e.name,e.message,String(e),JSON.stringify(e),Object.keys(e),Object.prototype.toString.call(e),Error(undefined).message,Error(null).message]; })()',
        function () { $e = Js::dynamicConstruct('Error', new JsArray(['bad input'])); return [Js::dynamicGet($e, 'name'), Js::dynamicGet($e, 'message'), Js::str($e), Js::jsonStringify($e), Js::dynamicKeys($e), Js::dynamicObjectTag($e), Js::dynamicConstruct('Error', new JsArray([Js::undefined()]))->getMessage(), Js::dynamicConstruct('Error', new JsArray([null]))->getMessage()]; }],
    ['(() => {const o={valueOf:()=>7};return [Number(o),o+2]})()',
        function () { $o = new JsObject(['valueOf' => static fn () => 7]); return [Js::toNumber($o), Js::dynamicBinary('+', $o, 2)]; }],
    ['null.x', fn () => Js::dynamicGet(null, 'x')],
    ['"x".missing()', fn () => Js::dynamicCallMethod('x', 'missing', new JsArray())],
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
    ['String([1, [2, null], "a", true])', fn () => Js::str(jsValue([1, [2, null], 'a', true]))],
    ['String({a: 1}) + String(null)', fn () => Js::str(jsValue(['a' => 1])) . Js::str(null)],
    ['String(/a\/b/gi)', fn () => Js::str($re('a\/b', 'ig'))],

    // ---- toNumber / parseInt / parseFloat
    ['["", "  12  ", " \n 4.5e1  ", ".5", "5.", "-0", "+.5e-2"].map(Number)',
        fn () => array_map(Js::toNumber(...), ['', '  12  ', "\u{a0}\n 4.5e1 \u{2028}", '.5', '5.', '-0', '+.5e-2'])],
    ['["0x1F", "0b101", "0o17", "0X1f", "-0x10", "0x", "1_000", "12px", "Infinity", "-Infinity", "infinity", "1e400"].map(Number)',
        fn () => array_map(Js::toNumber(...), ['0x1F', '0b101', '0o17', '0X1f', '-0x10', '0x', '1_000', '12px', 'Infinity', '-Infinity', 'infinity', '1e400'])],
    ['[null, true, false, [], [7], [1, 2]].map(Number)', fn () => array_map(fn ($v) => Js::toNumber(jsValue($v)), [null, true, false, [], [7], [1, 2]])],
    ['["08", "0x1F", "  -42px", "1e3", "", "-0", "9007199254740993", "123456789012345678901234567890", "+-1"].map(s => parseInt(s))',
        fn () => array_map(fn ($s) => Js::parseInt($s), ['08', '0x1F', '  -42px', '1e3', '', '-0', '9007199254740993', '123456789012345678901234567890', '+-1'])],
    ['["9007199254740993", "-9007199254740993", "9007199254740992", "0x20000000000001", "0o400000000000000001", "0b100000000000000000000000000000000000000000000000000001"].map(Number).map((n) => n - 1)',
        fn () => array_map(fn ($s) => Js::n(Js::toNumber($s) - 1), ['9007199254740993', '-9007199254740993', '9007199254740992', '0x20000000000001', '0o400000000000000001', '0b100000000000000000000000000000000000000000000000000001'])],
    ['(() => { const v = JSON.parse(\'{"n":9007199254740993,"l":[-9007199254740995,3]}\'); return [v.n - 1, v.l[0] + 1, v.l[1] + 1]; })()',
        function () { $v = Js::jsonParse('{"n":9007199254740993,"l":[-9007199254740995,3]}'); return [Js::n($v->p['n'] - 1), Js::n($v->p['l']->a[0] + 1), Js::n($v->p['l']->a[1] + 1)]; }],
    ['[2 ** 60, 2 ** 53 + 1, (-2) ** 3, 2 ** -2, 2 ** 0.5, 1 ** Infinity, (-1) ** -Infinity, 2 ** Infinity, 1 ** NaN]',
        fn () => [Js::pow(2, 60), Js::n(Js::pow(2, 53) + 1), Js::pow(-2, 3), Js::pow(2, -2), Js::pow(2, 0.5), Js::pow(1, INF), Js::pow(-1, -INF), Js::pow(2, INF), Js::pow(1, NAN)]],
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
    ['((s) => [s.charAt(0), s.charAt(-1), s.charAt(3), s.charAt(4), s.at(-1), s.at(-4), s.at(-5), s[3], s[-1], s[3.5], s[NaN], s[-0]])("a🙂b")',
        fn () => [Js::charAt('a🙂b', 0), Js::charAt('a🙂b', -1), Js::charAt('a🙂b', 3), Js::charAt('a🙂b', 4), Js::strAt('a🙂b', -1), Js::strAt('a🙂b', -4), Js::strAt('a🙂b', -5), Js::strIndex('a🙂b', 3), Js::strIndex('a🙂b', -1), Js::strIndex('a🙂b', 3.5), Js::strIndex('a🙂b', NAN), Js::strIndex('a🙂b', -0.0)]],
    ['((s) => [s.indexOf("aé"), s.indexOf("aé", 3), s.indexOf("🙂", 1), s.indexOf("", 99), s.indexOf("a", -5), s.lastIndexOf("aé"), s.lastIndexOf("aé", 5), s.lastIndexOf("🙂", -3), s.lastIndexOf("x"), s.lastIndexOf(""), s.lastIndexOf("", NaN), "愀a愀".lastIndexOf("a"), "愀愀".lastIndexOf("a")])("🙂aé🙂aé")',
        fn () => [Js::indexOf('🙂aé🙂aé', 'aé'), Js::indexOf('🙂aé🙂aé', 'aé', 3), Js::indexOf('🙂aé🙂aé', '🙂', 1), Js::indexOf('🙂aé🙂aé', '', 99), Js::indexOf('🙂aé🙂aé', 'a', -5), Js::lastIndexOf('🙂aé🙂aé', 'aé'), Js::lastIndexOf('🙂aé🙂aé', 'aé', 5), Js::lastIndexOf('🙂aé🙂aé', '🙂', -3), Js::lastIndexOf('🙂aé🙂aé', 'x'), Js::lastIndexOf('🙂aé🙂aé', ''), Js::lastIndexOf('🙂aé🙂aé', '', NAN), Js::lastIndexOf('愀a愀', 'a'), Js::lastIndexOf('愀愀', 'a')]],
    // An explicit null position is ToNumber(null) = 0, not an omitted argument (compiled
    // String.prototype.lastIndexOf gets `undefined` as omitted, decided at build time).
    ['["ab".lastIndexOf("b", null), "ab".lastIndexOf("b"), [1, 2].lastIndexOf(2, null), [1, 2].includes(1, null), "ab".at(null), [1, 2].at(null), "ab".indexOf("b", null)]',
        fn () => [Js::lastIndexOf('ab', 'b', null), Js::lastIndexOf('ab', 'b'), Js::lastIndexOf(new JsArray([1, 2]), 2, null), Js::includes(new JsArray([1, 2]), 1, null), Js::strAt('ab', null), Js::arrAt(new JsArray([1, 2]), null), Js::indexOf('ab', 'b', null)]],
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
    ['((seen) => ["🙂a".replaceAll("", (m, i) => { seen.push(i); return ""; }), "🙂🙂".replace(/(?:)/g, (m, i) => { seen.push(i); return ""; }), "🙂a🙂".match(/x*/g), seen])([])',
        function () use ($re) { $seen = []; $f = function (string $m, int $i) use (&$seen) { $seen[] = $i; return ''; };
            return [Js::replaceAll('🙂a', '', $f), Js::replace('🙂🙂', $re('(?:)', 'g'), $f), Js::strMatch('🙂a🙂', $re('x*', 'g')), $seen]; }],
    ['["🙂".replaceAll("", "$&"), "🙂".replace(/()/g, (m, g) => g ?? "x"), "🙂".match(/^/g), "🙂".match(/\\b/g), "🙂".match(/\\B/g), "a🙂a".match(/\\B/g), "🙂a".match(/(?=a)/gu)]',
        fn () => [Js::replaceAll('🙂', '', '$&'), Js::replace('🙂', $re('()', 'g'), fn ($m, $g) => $g ?? 'x'), Js::strMatch('🙂', $re('^', 'g')), Js::strMatch('🙂', $re('\b', 'g')), Js::strMatch('🙂', $re('\B', 'g')), Js::strMatch('a🙂a', $re('\B', 'g')), Js::strMatch('🙂a', $re('(?=a)', 'gu'))]],
    ['"2020-01-02".replace(/(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)/, "$<d>.$<m>.$<y> $<nope>|$2")',
        fn () => Js::replace('2020-01-02', $re('(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)', ''), '$<d>.$<m>.$<y> $<nope>|$2')],
    ['["abc".replace(/(b)/g, "$1$1$2$<x>"), "abc".replace(/(b)/, "$10"), "abcabc".replace(/b/, "X"), "abcabc".replace(/B/gi, "X"), "aaa".replace(/a*?/g, "-")]',
        fn () => [Js::replace('abc', $re('(b)', 'g'), '$1$1$2$<x>'), Js::replace('abc', $re('(b)', ''), '$10'), Js::replace('abcabc', $re('b', ''), 'X'), Js::replace('abcabc', $re('B', 'gi'), 'X'), Js::replace('aaa', $re('a*?', 'g'), '-')]],
    ['["a1b22".replace(/\d+/g, (m, off) => `[${m}@${off}]`), "x=1,y=2".replace(/(\w)=(\d)/g, (m, k, v) => v + k), "🙂1é2".replace(/\d/g, (m, o, s) => o + s.length), "a🙂b".replace(/.?./gu, (m, at) => String(at)), "ab".replace(/(x)?b/, (m, g) => g ?? "unset")]',
        fn () => [Js::replace('a1b22', $re('\d+', 'g'), fn ($m, $off) => "[$m@$off]"), Js::replace('x=1,y=2', $re('(\w)=(\d)', 'g'), fn ($m, $k, $v) => $v . $k), Js::replace('🙂1é2', $re('\d', 'g'), fn ($m, $o, $s) => $o + Js::length($s)), Js::replace('a🙂b', $re('.?.', 'gu'), fn ($m, $at) => (string) $at), Js::replace('ab', $re('(x)?b', ''), fn ($m, $g) => Js::isNullish($g) ? 'unset' : $g)]],
    ['["a.b.c".replaceAll(".", "-"), "aaa".replaceAll("", "-"), "aXbX".replaceAll(/x/gi, (m) => m.toLowerCase())]',
        fn () => [Js::replaceAll('a.b.c', '.', '-'), Js::replaceAll('aaa', '', '-'), Js::replaceAll('aXbX', $re('x', 'gi'), fn ($m) => strtolower($m))]],
    ['"a".replaceAll(/a/, "b")', fn () => Js::replaceAll('a', $re('a', ''), 'b')],

    ['(() => { const g = /a/g, y = /a/y, empty = /a*/g; return [g.test("a"), g.lastIndex, g.test("a"), g.lastIndex, g.test("a"), y.test("ba"), y.lastIndex, y.test("a"), y.lastIndex, y.exec("a"), y.lastIndex, empty.test("b"), empty.lastIndex, empty.exec("b").index, empty.lastIndex]; })()',
        function () { $g = new \Zero\RegExp('a', 'g'); $y = new \Zero\RegExp('a', 'y'); $e = new \Zero\RegExp('a*', 'g'); return [$g->test('a'), $g->lastIndex, $g->test('a'), $g->lastIndex, $g->test('a'), $y->test('ba'), $y->lastIndex, $y->test('a'), $y->lastIndex, Js::dynamicRegExpExec($y, 'a'), $y->lastIndex, $e->test('b'), $e->lastIndex, Js::dynamicGet(Js::dynamicRegExpExec($e, 'b'), 'index'), $e->lastIndex]; }],
    // ---- RegExp translation
    ['[/HELLO/i.test("hello"), /a.b/s.test("a\nb"), /a.b/.test("a\nb"), /a.b/.test("a b"), /^.$/u.test("🙂"), /^\d$/.test("٣"), /^\w$/.test("é"), /^\s$/.test(" ")]',
        fn () => [$re('HELLO', 'i')->test('hello'), $re('a.b', 's')->test("a\nb"), $re('a.b', '')->test("a\nb"), $re('a.b', '')->test("a\u{2028}b"), $re('^.$', 'u')->test('🙂'), $re('^\d$', '')->test('٣'), $re('^\w$', '')->test('é'), $re('^\s$', '')->test("\u{a0}")]],
    ['["a\nb".replace(/^/gm, "> "), "a\n".replace(/$/, "!"), "a\nb\n".replace(/$/gm, ";"), "café x".replace(/\b/g, "|")]',
        fn () => [Js::replace("a\nb", $re('^', 'gm'), '> '), Js::replace("a\n", $re('$', ''), '!'), Js::replace("a\nb\n", $re('$', 'gm'), ';'), Js::replace('café x', $re('\b', 'g'), '|')]],
    ['["$12 €34 $5".match(/(?<=\$)\d+/g), "ax cx bx".match(/(?<=ab|c)x/g), "price: 42".match(/(?<!\d)\d(?<num>\d)/), "b".match(/(a)?b/), "xyz".match(/q/g)]',
        fn () => [Js::strMatch('$12 €34 $5', $re('(?<=\$)\d+', 'g')), Js::strMatch('ax cx bx', $re('(?<=ab|c)x', 'g')), Js::strMatch('price: 42', $re('(?<!\d)\d(?<num>\d)', '')), Js::strMatch('b', $re('(a)?b', '')), Js::strMatch('xyz', $re('q', 'g'))]],
    ['[/(a)?b\1/.test("b"), /^(?<q>["\x27]).*\k<q>$/.test("\x27hi\x27"), /[^]/.test("\n"), /[]/.test("a"), /[\d\-x]/.test("-"), /^[\w\s]+$/.test("a b_1"), /^[^\W\d]+$/.test("ab"), /^[\D]$/.test("5")]',
        fn () => [$re('(a)?b\1', '')->test('b'), $re('^(?<q>["\x27]).*\k<q>$', '')->test("'hi'"), $re('[^]', '')->test("\n"), $re('[]', '')->test('a'), $re('[\d\-x]', '')->test('-'), $re('^[\w\s]+$', '')->test('a b_1'), $re('^[^\W\d]+$', '')->test('ab'), $re('^[\D]$', '')->test('5')]],
    ['[/é/.test("é"), /\u{1F642}/u.test("🙂"), /🙂/u.test("🙂"), /a\/b/.test("a/b"), /\x41\t/.test("A\t"), /[a-z]/i.test("K")]',
        fn () => [$re('é', '')->test('é'), $re('\u{1F642}', 'u')->test('🙂'), $re('🙂', 'u')->test('🙂'), $re('a\/b', '')->test('a/b'), $re('\x41\t', '')->test("A\t"), $re('[a-z]', 'i')->test('K')]],
    ['[/x/gimsu.flags, /x/.source, new RegExp("").source, /a/g.global]', fn () => [$re('x', 'usmig')->flags, $re('x', '')->source, $re('', '')->source, $re('a', 'g')->global]],
    ['new RegExp("(", "")', fn () => $re('(', '')],

    ['[new RegExp("\\u2028").source, new RegExp("\\u2029").source]', fn () => [$re("\u{2028}", '')->source, $re("\u{2029}", '')->source]],

    // ---- sort / arrays
    ['[10, 9, 1].sort()', function () { $a = jsValue([10, 9, 1]); Js::sort($a); return $a; }],
    ['["b", "a", 10, 9, true, null, "B", "｡", "🙂"].sort()', function () { $a = jsValue(['b', 'a', 10, 9, true, null, 'B', "\u{ff61}", '🙂']); Js::sort($a); return $a; }],
    ['[[3, 1, 2].sort((a, b) => b - a), [0.3, 0.1, 0.2].sort((a, b) => a - b), [{k: 1, i: 0}, {k: 0, i: 1}, {k: 1, i: 2}, {k: 0, i: 3}].sort((a, b) => a.k - b.k).map(o => o.i)]',
        fn () => [Js::sorted(jsValue([3, 1, 2]), Js::sortComparator(fn ($a, $b) => $b - $a, [], true)), Js::sorted(jsValue([0.3, 0.1, 0.2]), Js::sortComparator(fn ($a, $b) => $a - $b, [], false)), Js::map(Js::sorted(jsValue([['k' => 1, 'i' => 0], ['k' => 0, 'i' => 1], ['k' => 1, 'i' => 2], ['k' => 0, 'i' => 3]]), Js::sortComparator(fn ($a, $b) => $a->p['k'] - $b->p['k'], ['k'], false)), fn ($row) => $row->p['i'])]],
    ['(() => { const a = [1, 2, 3, 4, 5]; const r = a.splice(-2, 1, "x", "y"); return [a, r, a.slice(-2), a.slice(1, -10), a.at(-1), a.at(9)]; })()',
        function () { $a = jsValue([1, 2, 3, 4, 5]); $r = Js::splice($a, -2, 1, 'x', 'y'); return [$a, $r, Js::arrSlice($a, -2), Js::arrSlice($a, 1, -10), Js::arrAt($a, -1), Js::arrAt($a, 9)]; }],
    ['(() => { const a = [1, 2, 3]; a.splice(1); const b = [1, 2, 3, 4]; b.fill(0, -3, -1); const c = [1, 2]; c.reverse(); return [a, b, c]; })()',
        function () { $a = jsValue([1, 2, 3]); Js::splice($a, 1); $b = jsValue([1, 2, 3, 4]); Js::fill($b, 0, -3, -1); $c = jsValue([1, 2]); Js::reverse($c); return [$a, $b, $c]; }],
    ['[[NaN].includes(NaN), [NaN].indexOf(NaN), [1, 2, 1].lastIndexOf(1), [0].includes(-0), [1, "1"].indexOf("1"), [1, 2, 3].indexOf(1, -2)]',
        fn () => [Js::includes(jsValue([NAN]), NAN), Js::indexOf(jsValue([NAN]), NAN), Js::lastIndexOf(jsValue([1, 2, 1]), 1), Js::includes(jsValue([0]), -0.0), Js::indexOf(jsValue([1, '1']), '1'), Js::indexOf(jsValue([1, 2, 3]), 1, -2)]],
    ['[[1, [2, [3, [4]]]].flat(), [1, [2, [3, [4]]]].flat(Infinity), [1, 2].flatMap(x => [x, [x * 10]]), [null, 1, "a"].join("-"), [[1, 2], [3]].join(";")]',
        fn () => [Js::flat(jsValue([1, [2, [3, [4]]]])), Js::flat(jsValue([1, [2, [3, [4]]]]), INF), Js::flatMap(jsValue([1, 2]), fn ($x) => jsValue([$x, [$x * 10]])), Js::join(jsValue([null, 1, 'a']), '-'), Js::join(jsValue([[1, 2], [3]]), ';')]],
    ['[[1, 2, 3].reduce((a, b) => a + b), [].reduce((a, b) => a + b, "init"), [5, 6].map((x, i) => x * i), [0, 1, "", "x"].filter(x => x), [1, 2, 3].findLast(x => x < 3), [1, 2].findIndex(x => x > 5), [].every(x => false), [1].some(x => x)]',
        fn () => [Js::reduce(jsValue([1, 2, 3]), fn ($a, $b) => $a + $b), Js::reduce(jsValue([]), fn ($a, $b) => $a + $b, 'init'), Js::map(jsValue([5, 6]), fn ($x, $i) => $x * $i), Js::filter(jsValue([0, 1, '', 'x']), fn ($x) => $x), Js::findLast(jsValue([1, 2, 3]), fn ($x) => $x < 3), Js::findIndex(jsValue([1, 2]), fn ($x) => $x > 5), Js::every(jsValue([]), fn ($x) => false), Js::some(jsValue([1]), fn ($x) => $x)]],
    ['[].reduce((a, b) => a + b)', fn () => Js::reduce(jsValue([]), fn ($a, $b) => $a + $b)],
    ['[Math.max(), Math.min(), Math.max(1, NaN, 3), Math.max(-0, 0), Math.min(0, -0), Math.max(2, 7.5, 3)]',
        fn () => [Js::max(), Js::min(), Js::max(1, NAN, 3), Js::max(-0.0, 0), Js::min(0, -0.0), Js::max(2, 7.5, 3)]],
    ['Array.from({length: 3}, (_, i) => i * i)', fn () => Js::range(3, fn ($_, $i) => $i * $i)],

    // ---- objects
    ['(() => { const o = {b: 1, 2: "two", a: [1], 1: "one"}; return [Object.keys(o), Object.values(o), Object.entries(o)]; })()',
        function () { $o = jsValue(['b' => 1, 2 => 'two', 'a' => [1], 1 => 'one']); return [Js::keys($o), Js::values($o), Js::entries($o)]; }],
    ['(() => { const {a, ...rest} = {a: 1, b: 2, c: 3}; return [rest, Object.fromEntries([["x", 1], ["y", [2]]]), Object.hasOwn({k: null}, "k"), Object.hasOwn([1], "length"), Object.hasOwn([1], "0"), Object.hasOwn([1], "1")]; })()',
        fn () => [Js::omit(jsValue(['a' => 1, 'b' => 2, 'c' => 3]), ['a']), Js::fromEntries(jsValue([['x', 1], ['y', [2]]])), Js::hasOwn(jsValue(['k' => null]), 'k'), Js::hasOwn(new JsArray([1]), 'length'), Js::hasOwn(new JsArray([1]), '0'), Js::hasOwn(new JsArray([1]), '1')]],

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
    ['["2020-01-01", "2020-01-01T10:00", "2020-02", "2021-02-30", "2020-13-01", "2020-01-01T24:00:00Z", "2020-01-01T24:00:01Z", "2020-01-01T24:00:00.0000Z", "2020-01-01T24:00:00.0001Z", "+002020-01-01", "-000001-01-01T00:00:00Z", "2020-01-01T10:00:00.123456Z", "2020-01-01T10:00:00+05:30"].map(s => new Date(s).getTime())',
        fn () => array_map(Js::date(...), ['2020-01-01', '2020-01-01T10:00', '2020-02', '2021-02-30', '2020-13-01', '2020-01-01T24:00:00Z', '2020-01-01T24:00:01Z', '2020-01-01T24:00:00.0000Z', '2020-01-01T24:00:00.0001Z', '+002020-01-01', '-000001-01-01T00:00:00Z', '2020-01-01T10:00:00.123456Z', '2020-01-01T10:00:00+05:30'])],
    ['[new Date(1.9).getTime(), new Date(8.64e15 + 1).getTime(), new Date(null).getTime()]', fn () => [Js::date(1.9), Js::date(8.64e15 + 1), Js::date(null)]],
    ['[0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000].map(ms => new Date(ms).toISOString())',
        fn () => array_map(Js::iso(...), [0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000])],
    ['new Date(NaN).toISOString()', fn () => Js::iso(NAN)],
];

$deviations = [
    ['dynamic JSON replacer fails explicitly', fn () => Js::dynamicStaticCall('JSON', 'stringify', new JsArray([new JsObject(['public' => 1, 'private' => 2]), new JsArray(['public'])])), ['$err' => 'TypeError']],
    ['dynamic JSON reviver fails explicitly', fn () => Js::dynamicStaticCall('JSON', 'parse', new JsArray(['{}', static fn ($k, $v) => $v])), ['$err' => 'TypeError']],
    ['dynamic Date component overload fails explicitly', fn () => Js::dynamicConstruct('Date', new JsArray([2020, 0])), ['$err' => 'TypeError']],
    ['dynamic Date string coercion fails explicitly through array join', fn () => Js::dynamicCallMethod(new JsArray([new \Zero\JsDate(0)]), 'join', new JsArray()), ['$err' => 'TypeError']],
    ['dynamic nondecimal number formatting fails explicitly', fn () => Js::dynamicCallMethod(255, 'toString', new JsArray([16])), ['$err' => 'TypeError']],
    ['dynamic Error cause fails explicitly', fn () => Js::dynamicConstruct('Error', new JsArray(['message', new JsObject(['cause' => Js::undefined()])])), ['$err' => 'TypeError']],
    ['an undefined operation result retains its success envelope', fn () => \Zero\Response::json(Js::undefined())->http()[2], '{"data":null}'],
    ['negative zero Date year is refused', fn () => Js::date('-000000-01-01'), ['$err' => 'RangeError']],
    ['array Error cause is refused', function () { $a = new JsArray(); $a->p['cause'] = 42; return Js::dynamicConstruct('Error', new JsArray(['x', $a])); }, ['$err' => 'TypeError']],
    ['default object sort requires a comparator', fn () => Js::sort(new JsArray([new JsObject(), new JsObject()])), ['$err' => 'TypeError']],
    ['unsupported legacy control escapes are refused', fn () => Js::re('\\c0', ''), ['$err' => 'SyntaxError']],
    ['error stack access is refused', fn () => Js::dynamicGet(new JsError('x'), 'stack'), ['$err' => 'TypeError']],
    ['non-ISO Date strings are refused', fn () => Js::date('2020-1-1'), ['$err' => 'RangeError']],
];

// Each fixed-length helper owns a separate shrink/growth row because its walk can fail independently.
$walks = ['map', 'filter', 'forEach', 'some', 'every', 'reduce', 'flatMap', 'find', 'findIndex', 'findLast', 'findLastIndex'];
foreach ($walks as $method) {
    $invoke = static fn (JsArray $a, callable $visit) => $method === 'reduce'
        ? Js::reduce($a, static fn ($acc, $v, $i, $source) => $visit($v, $i, $source), 0)
        : Js::$method($a, $visit);
    $deviations[] = ["$method rejects a reached missing index", static function () use ($invoke, $method) {
        $a = new JsArray([1, 2, 3]);
        $first = true;
        $invoke($a, static function ($v) use ($a, &$first, $method) {
            if ($first) { Js::pop($a); Js::pop($a); $first = false; }
            return $method === 'every';
        });
    }, ['$err' => 'RangeError']];
    $jsCallback = $method === 'reduce' ? '(acc, v, i, source)' : '(v, i, source)';
    $truth = $method === 'every' ? 'true' : 'false';
    $extra = $method === 'reduce' ? ', 0' : '';
    $cases[] = ["(() => { const a = [1,2,3]; const seen = []; const result = a.$method($jsCallback => { a.push(9); seen.push([v,i,source === a]); return $truth; }$extra); return [result ?? null, seen, a]; })()", static function () use ($method, $invoke) {
        $a = new JsArray([1, 2, 3]); $seen = [];
        $result = $invoke($a, static function ($v, $i, $source) use ($a, &$seen, $method) {
            Js::push($a, 9); $seen[] = [$v, $i, $source === $a];
            return $method === 'every';
        });
        return [$result, $seen, $a];
    }];
}
$deviations[] = ['past-end writes reject sparse arrays', fn () => Js::setAt(new JsArray([1]), 2, 9), ['$err' => 'RangeError']];
$deviations[] = ['compound index write rejects a sparse result', static function () {
    $a = new JsArray(['a']); $old = Js::get($a, 2); return Js::setAt($a, 2, Js::str($old) . 'x');
}, ['$err' => 'RangeError']];
$deviations[] = ['index increment rejects a sparse result', static function () {
    $a = new JsArray([1]); $old = Js::get($a, 5) ?? NAN; return Js::setAt($a, 5, Js::add($old, 1));
}, ['$err' => 'RangeError']];
$deviations[] = ['fractional writes reject named array properties', fn () => Js::setAt(new JsArray([1]), 0.5, 9), ['$err' => 'RangeError']];
$cases[] = ['(() => { const a = [1,2]; return [a.map((v,i) => { if (i === 1) a.pop(); return v; }), a]; })()', static function () {
    $a = new JsArray([1, 2]); $result = Js::map($a, static function ($v, $i) use ($a) { if ($i === 1) { Js::pop($a); } return $v; }); return [$result, $a];
}];
$cases[] = ['(() => { const a = [1,2,3]; return a.some(v => { a.pop(); a.pop(); return true; }); })()', static function () {
    $a = new JsArray([1, 2, 3]); return Js::some($a, static function () use ($a) { Js::pop($a); Js::pop($a); return true; });
}];
$cases[] = ['(() => { const a = [1,2,3]; return a.findLast(v => { a.pop(); return false; }) ?? null; })()', static function () {
    $a = new JsArray([1, 2, 3]); return Js::findLast($a, static function () use ($a) { Js::pop($a); return false; });
}];
$deviations[] = ['effectful comparators are refused', static function () {
    $calls = 0;
    try { Js::sort(new JsArray([3, 2, 1]), static function ($x, $y) use (&$calls) { $calls++; return $x - $y; }); }
    catch (JsError $e) { return [$e->jsName, $calls]; }
    return ['accepted', $calls];
}, ['TypeError', 0]];
$deviations[] = ['nonfinite comparator keys are refused', fn () => Js::sort(new JsArray([1, NAN, 0]), Js::sortComparator(static fn ($x, $y) => $x - $y, [], false)), ['$err' => 'RangeError']];
$deviations[] = ['borrowed methods cannot change families', fn () => Js::dynamicCallMethod(Js::dynamicGet(new JsArray(), 'includes'), 'call', new JsArray(['abc', 'ab'])), ['$err' => 'TypeError']];
$cases[] = ['[Array.from("a🙂b"), [1,2].with(-1, 9), [1,2].toReversed()]', fn () => [Js::from('a🙂b'), Js::with(new JsArray([1, 2]), -1, 9), Js::toReversed(new JsArray([1, 2]))]];
$cases[] = ['(() => { const a = [1]; const n = a.push(2); const x = a.pop(); const m = a.unshift(0); const y = a.shift(); return [n,x,m,y,a]; })()', static function () {
    $a = new JsArray([1]); $n = Js::push($a, 2); $x = Js::pop($a); $m = Js::unshift($a, 0); $y = Js::shift($a); return [$n, $x, $m, $y, $a];
}];


$cases[] = ['(() => { const p = {x:1}; const a = [[p]]; const flat = a.flat(); flat[0].x = 2; return [flat, a]; })()', static function () {
    $p = new JsObject(['x' => 1]); $a = new JsArray([new JsArray([$p])]); $flat = Js::flat($a); $flat->a[0]->p['x'] = 2; return [$flat, $a];
}];
$cases[] = ['(() => { const a = [3,1,2]; return [a.toSorted((x,y) => x-y), a.concat([4],5), a]; })()', static function () {
    $a = new JsArray([3, 1, 2]); return [Js::toSorted($a, Js::sortComparator(static fn ($x, $y) => $x - $y, [], false)), Js::concat($a, new JsArray([4]), 5), $a];
}];
$cases[] = ['(() => { const p = {x:1}; const array = [p,p]; array.extra = p; const set = new Set([p]); set.add(set); const map = new Map([[p,set]]); map.set(map,p); const date = new Date(0); const source = {array,set,map,date,again:date}; const copy = structuredClone(source); copy.array[0].x = 2; copy.set.add("new"); copy.map.set("new",3); return [copy.array[0] === copy.array[1], copy.array.extra === copy.array[0], p.x, copy.array, set.size, copy.set.size, map.size, copy.map.size, copy.set.has(copy.set), copy.map.get(copy.array[0]) === copy.set, copy.map.get(copy.map) === copy.array[0], copy.date !== date, copy.date === copy.again, copy.date.getTime()]; })()', static function () {
    $p = new JsObject(['x' => 1]); $array = new JsArray([$p, $p]); $array->p['extra'] = $p;
    $set = new \Zero\JsSet(); $set->add($p)->add($set);
    $map = new \Zero\JsMap(); $map->set($p, $set)->set($map, $p);
    $date = new \Zero\JsDate(0);
    $copy = Js::clone(new JsObject(['array' => $array, 'set' => $set, 'map' => $map, 'date' => $date, 'again' => $date]));
    $items = $copy->p; $items['array']->a[0]->p['x'] = 2; $items['set']->add('new'); $items['map']->set('new', 3);
    return [$items['array']->a[0] === $items['array']->a[1], $items['array']->p['extra'] === $items['array']->a[0], $p->p['x'], $items['array'], count($set->values), count($items['set']->values), count($map->entries), count($items['map']->entries), $items['set']->has($items['set']), $items['map']->get($items['array']->a[0]) === $items['set'], $items['map']->get($items['map']) === $items['array']->a[0], $items['date'] !== $date, $items['date'] === $items['again'], $items['date']->milliseconds];
}];
$cases[] = ['(function () { return structuredClone(arguments); })(1)', fn () => Js::clone(Js::arguments([1]))];
$deviations[] = ['detached collection and arguments graphs retain identity only within the copy', static function () {
    $set = new \Zero\JsSet(); $map = new \Zero\JsMap(); $args = Js::arguments([$set]);
    $set->add($map); $map->set($args, $set); $args->length = new JsObject(['nested' => $set]);
    $copy = Js::detach($args); $copiedSet = $copy->a[0]; $copiedMap = $copiedSet->values[0];
    $copiedSet->add(2);
    return [$copy !== $args, count($set->values), count($copiedSet->values), $copiedMap->get($copy) === $copiedSet, $copy->length !== $args->length, $copy->length->p['nested'] === $copiedSet];
}, [true, 1, 2, true, true, true]];

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
    if ($actual === Js::undefined()) { $actual = null; }
    if ($actual instanceof JsObject || $actual instanceof JsArray) { $actual = \Zero\Seam::container($actual); }
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

// UTF-16 subset restrictions complement the dense-array restrictions above.
$deviations = array_merge($deviations, [
    // A lone surrogate can't live in a UTF-8 string; any stand-in would merge distinct JS values.
    ['inserting inside a surrogate pair throws', fn () => [Js::replaceAll('🙂', '', '-'), Js::replace('🙂', Js::re('(?:)', 'g'), '-')], ['$err' => 'RangeError']],
    ['$` inside a surrogate pair throws', fn () => Js::replaceAll('🙂', '', '$`'), ['$err' => 'RangeError']],
    ['global dots cannot combine code-point matches with UTF-16 offsets', fn () => Js::replace('a🙂b', Js::re('.?.', 'g'), fn ($m, $at) => (string) $at), ['$err' => 'RangeError']],
    ['complemented shorthands need Unicode mode on astral text', fn () => Js::strMatch('a🙂b', Js::re('\\S?\\S', 'g')), ['$err' => 'RangeError']],
    ['lookarounds on astral text need Unicode mode', fn () => Js::strMatch('🙂', Js::re('(?=.)', 'g')), ['$err' => 'RangeError']],
    ['classes cannot fabricate an in-pair empty match', fn () => Js::strMatch('a🙂a', Js::re('\B[^\uFDD0]?', 'g')), ['$err' => 'RangeError']],
    ['surrogate escapes cannot fabricate an in-pair empty match', fn () => Js::strMatch('a🙂a', Js::re('\B\uDE00?', 'g')), ['$err' => 'SyntaxError']],
    ['astral literals need Unicode mode for shared interior probes', fn () => Js::strMatch('🙂🙂', Js::re('.🙂|', 'g')), ['$err' => 'SyntaxError']],
    ['escaped astral literals need Unicode mode for shared interior probes', fn () => Js::strMatch('🙂🙂', Js::re('.\\uD83D\\uDE42|', 'g')), ['$err' => 'SyntaxError']],
    ['charAt splitting a pair throws', fn () => Js::charAt('a🙂', 1), ['$err' => 'RangeError']],
    ['non-Unicode RegExp split on astral text is refused', fn () => Js::split('😀', Js::re('(?:)', '')), ['$err' => 'RangeError']],
    ['non-Unicode Kelvin folding is refused', fn () => Js::re('k', 'i')->test('K'), ['$err' => 'RangeError']],
    ['non-Unicode long s folding is refused', fn () => Js::re('s', 'i')->test('ſ'), ['$err' => 'RangeError']],
    ['non-Unicode source folding is refused', fn () => Js::re('K', 'i')->test('k'), ['$err' => 'SyntaxError']],
    ['non-Unicode escaped source folding is refused', fn () => Js::re('\\u212a', 'i')->test('k'), ['$err' => 'SyntaxError']],
    ['engine-dependent reciprocal powers are refused', fn () => Js::pow(45.29, -1), ['$err' => 'RangeError']],
    ['Unicode malformed regex braces are refused', fn () => Js::re('a{,2}', 'u'), ['$err' => 'SyntaxError']],
    ['Unicode unmatched regex braces are refused', fn () => Js::re('a}', 'u'), ['$err' => 'SyntaxError']],
    ['possessive RegExp quantifiers are refused', fn () => Js::re('a++a', 'g'), ['$err' => 'SyntaxError']],
    ['Unicode class identity escapes are refused', fn () => Js::re('[\\k<a>]', 'u'), ['$err' => 'SyntaxError']],
    ['Unicode ignore-case table differences are refused', fn () => Js::re('\\u1c89', 'iu')->test('ᲊ'), ['$err' => 'SyntaxError']],
    ['Unicode ignore-case non-ASCII input is refused', fn () => Js::re('k', 'iu')->test('K'), ['$err' => 'RangeError']],
    ['Unicode ignore-case literal source is refused', fn () => Js::re('É', 'iu')->test('é'), ['$err' => 'SyntaxError']],
    ['class shorthand beside a range is refused', fn () => Js::re('[\\w-a]', '')->test('-'), ['$err' => 'SyntaxError']],
    ['class range before a shorthand is refused', fn () => Js::re('[a-\\d]', '')->test('`'), ['$err' => 'SyntaxError']],
    ['space-separated Date extension is refused', fn () => Js::date('2000-01-01 24:00:00.0001Z'), ['$err' => 'RangeError']],
    ['compact Date offset extension is refused', fn () => Js::date('2000-01-01T00:00:00+0100'), ['$err' => 'RangeError']],
    ['partial Date with time is refused', fn () => Js::date('2000T00:00:00Z'), ['$err' => 'RangeError']],
    ['nullable repeated noncapturing groups are refused', fn () => Js::replace('b', Js::re('(?:a*|b)*', ''), 'X'), ['$err' => 'SyntaxError']],
    ['nullable optional noncapturing groups are refused', fn () => Js::replace('b', Js::re('(?:a*|b)?', ''), 'X'), ['$err' => 'SyntaxError']],
    ['ownership of unsupported namespace constants is refused', fn () => Js::dynamicStaticCall('Object', 'hasOwn', new JsArray([Js::dynamicNamespace('Math'), 'LN2'])), ['$err' => 'TypeError']],
    ['unsupported namespace constants are refused', fn () => Js::dynamicGet(Js::dynamicNamespace('Math'), 'LN2'), ['$err' => 'TypeError']],
    ['unsupported namespace method values are refused', fn () => Js::dynamicGet(Js::dynamicNamespace('Math'), 'sin'), ['$err' => 'TypeError']],
    ['Error options are checked after message conversion', function () { $options = new JsObject(); $message = new JsObject(['toString' => static function () use ($options) { $options->p['cause'] = 7; return 'x'; }]); return Js::dynamicConstruct('Error', new JsArray([$message, $options])); }, ['$err' => 'TypeError']],
    ['lone surrogate classes are refused', fn () => Js::re('[\\uD800]', '')->test('?'), ['$err' => 'SyntaxError']],
    ['negated lone surrogate classes are refused', fn () => Js::re('[^\\uD800]', 'u')->test('?'), ['$err' => 'SyntaxError']],
    ['non-Unicode escaped astral quantifiers are refused on ASCII input', fn () => Js::re('\\uD83D\\uDE42?', '')->test('a'), ['$err' => 'SyntaxError']],
    ['non-Unicode astral quantifiers are refused on ASCII input', fn () => Js::re('🙂?', '')->test('a'), ['$err' => 'SyntaxError']],
    ['non-Unicode surrogate class ranges are refused on BMP input', fn () => Js::re('[a-\\uD83D\\uDE42]', '')->test(''), ['$err' => 'SyntaxError']],
    ['Unicode category version differences are refused', fn () => Js::re('\\p{Lu}', 'u')->test('Ᲊ'), ['$err' => 'SyntaxError']],
    ['Unicode class properties are refused', fn () => Js::re('[\\P{Ll}]', 'u'), ['$err' => 'SyntaxError']],
    ['case-insensitive positive Unicode properties are refused', fn () => Js::re('\\p{Lu}', 'iu'), ['$err' => 'SyntaxError']],
    ['Unicode trailing escapes are refused', fn () => Js::re('\\', 'u'), ['$err' => 'SyntaxError']],
    ['legacy trailing escapes are refused', fn () => Js::re('\\', ''), ['$err' => 'SyntaxError']],
    ['invalid Unicode hex escapes are refused', fn () => Js::re('\\x', 'u'), ['$err' => 'SyntaxError']],
    ['invalid Unicode escapes are refused', fn () => Js::re('\\u', 'u'), ['$err' => 'SyntaxError']],
    ['invalid Unicode identity escapes are refused', fn () => Js::re('\\q', 'u'), ['$err' => 'SyntaxError']],
    ['case-insensitive negated Unicode properties are refused', fn () => Js::re('\\P{Ll}', 'iu'), ['$err' => 'SyntaxError']],
    ['case-insensitive negated class properties are refused', fn () => Js::re('[\\P{Ll}]', 'iu'), ['$err' => 'SyntaxError']],
    ['capturing lookbehind is refused', fn () => Js::re('(?<=([ab]{1,2})([bc]{1,2}))$', ''), ['$err' => 'SyntaxError']],
    ['custom toJSON callbacks are refused', fn () => Js::jsonStringify(new JsObject(['toJSON' => static fn () => 42])), ['$err' => 'TypeError']],
    ['array prototype writes are refused', fn () => Js::dynamicSet(new JsArray(), '__proto__', 1), ['$err' => 'TypeError']],
    ['arguments prototype writes are refused', fn () => Js::dynamicSet(Js::arguments([]), '__proto__', 1), ['$err' => 'TypeError']],
    ['prototype writes are refused by the shared setter', fn () => Js::set(new JsObject(), '__proto__', 1), ['$err' => 'TypeError']],
    ['non-ISO invalid Date strings are refused', fn () => Js::date('nope'), ['$err' => 'RangeError']],
    ['empty array Date strings are refused', fn () => Js::date(new JsArray()), ['$err' => 'RangeError']],
    ['multi-element Date arrays are refused', fn () => Js::date(new JsArray(['2020-01-01','2020-01-02'])), ['$err' => 'RangeError']],
    ['plain object Date strings are refused', fn () => Js::date(new JsObject(['x'=>1])), ['$err' => 'RangeError']],
    ['loose function comparison requiring source text is refused', fn () => Js::looseEq(static fn () => 1, '()=>1'), ['$err' => 'TypeError']],
    ['function string conversion is refused', fn () => Js::str(static fn () => 1), ['$err' => 'TypeError']],
    ['function metadata reads are refused', fn () => Js::dynamicGet(static fn () => 1, 'length'), ['$err' => 'TypeError']],
    ['function binding values are refused', fn () => Js::dynamicGet(static fn () => 1, 'bind'), ['$err' => 'TypeError']],
    ['function own properties are refused', fn () => Js::dynamicStaticCall('Object', 'hasOwn', new JsArray([static fn () => 1, 'length'])), ['$err' => 'TypeError']],
    ['repeated captures are refused', fn () => Js::re('(a(b)?)+', ''), ['$err' => 'SyntaxError']],
    ['astral regex quantifiers need Unicode mode', fn () => Js::re('^😀+$', '')->test('😀😀'), ['$err' => 'SyntaxError']],
    ['slice ending inside a pair throws', fn () => Js::slice('a🙂b', 0, 2), ['$err' => 'RangeError']],
    ['slice starting inside a pair throws', fn () => Js::slice('a🙂b', 2), ['$err' => 'RangeError']],
    ['split("") on a pair throws', fn () => Js::split('a🙂b', ''), ['$err' => 'RangeError']],
    ['split("", limit) stops before a pair past the limit', fn () => Js::split('a🙂b', '', 1)->a, ['a']],
    ['split("", limit) splitting a pair within the limit throws', fn () => Js::split('a🙂b', '', 2), ['$err' => 'RangeError']],
    ['padEnd cutting a pair throws', fn () => Js::padEnd('a', 2, '🙂'), ['$err' => 'RangeError']],
    ['an unused JSON gap cut through a pair is fine', fn () => [Js::jsonStringify(1, '123456789🙂'), Js::jsonStringify(new \Zero\JsArray(), '123456789🙂'), Js::jsonStringify(new \Zero\JsObject(), '123456789🙂'), Js::jsonStringify(new \Zero\JsObject(['f' => static fn () => 1]), '123456789🙂'), Js::jsonStringify(static fn () => 1, '123456789🙂')], ['1', '[]', '{}', '{}', null]],
    ['a used JSON gap cut through a pair throws', fn () => Js::jsonStringify(new \Zero\JsArray([1]), '123456789🙂'), ['$err' => 'RangeError']],
]);

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
