<?php

declare(strict_types=1);

/*
 * Parity harness for SpacePress\Js: every case is a JS expression plus the PHP call the
 * compiler would emit for it. All JS runs in one `node` process (TZ=UTC); results
 * are compared with a typed comparison (NaN, ±Infinity and -0 are explicit).
 *
 * Strings: the runtime indexes by UTF-16 code unit, like JS, so astral cases are
 * plain native JS. A lone surrogate can't exist in PHP's UTF-8 strings (it becomes
 * U+FFFD); the one case that produces them maps the JS result through TextEncoder.
 */

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';

use SpacePress\Js;
use SpacePress\JsError;
use SpacePress\JsArray;
use SpacePress\JsObject;

function jsValue( mixed $value ): mixed {
	return \SpacePress\Seam::toJs( $value, array( 'type' => 'json' ) ); }

// Other WordPress plugins may change this setting; SpacePress strings remain UTF-8.
mb_internal_encoding( 'ISO-8859-1' );

$re = Js::re( ... );

$cases = array(
	array(
		'[undefined, null, false, 0, -0, NaN, "", "0", 3].map(v => v ?? "fallback")',
		fn () => array_map( static fn ( $v ) => Js::coalesce( $v, 'fallback' ), array( Js::undefined(), null, false, 0, -0.0, NAN, '', '0', 3 ) ),
	),
	array(
		'[undefined, null, {x: null}, {}, {x: false}, {x: "0"}].map(v => [typeof v?.x, v?.x ?? 7])',
		fn () => array_map( static fn ( $v ) => array( Js::typeOf( Js::optionalDataGet( $v, 'x' ) ), Js::coalesce( Js::optionalDataGet( $v, 'x' ), 7 ) ), array( Js::undefined(), null, new JsObject( array( 'x' => null ) ), new JsObject(), new JsObject( array( 'x' => false ) ), new JsObject( array( 'x' => '0' ) ) ) ),
	),
	array(
		'[(255).toString(16), (-255).toString(2), (0).toString(36), (35).toString(36), (9007199254740991).toString(36), (10).toString(10)]',
		fn () => array_map( static fn ( $pair ) => Js::dynamicCallMethod( $pair[0], 'toString', new JsArray( array( $pair[1] ) ) ), array( array( 255, 16 ), array( -255, 2 ), array( 0, 36 ), array( 35, 36 ), array( 9007199254740991, 36 ), array( 10, 10 ) ) ),
	),
	array(
		'(() => { try { (1).toString(1); return "no"; } catch (e) { return e.name; } })()',
		function () {
			try {
				Js::dynamicCallMethod( 1, 'toString', new JsArray( array( 1 ) ) );
				return 'no';
			} catch ( JsError $e ) {
				return $e->jsName; } },
	),
	// for-in over a subclass visits inherited static fields after its own; Object.keys doesn't.
	array(
		'(() => { class A { static x = 1; static z = 0; } class B extends A { static y = 2; static x = 3; } const k = []; for (const n in B) k.push(n); return [k, Object.keys(B)]; })()',
		function () {
			$a = new \SpacePress\JsClass(
				null,
				null,
				static function () {},
				array(),
				array(),
				new JsObject(
					array(
						'x' => 1,
						'z' => 0,
					)
				)
			);
			$b = new \SpacePress\JsClass(
				$a,
				null,
				static function () {},
				array(),
				array(),
				new JsObject(
					array(
						'y' => 2,
						'x' => 3,
					)
				)
			);
			return array( new JsArray( iterator_to_array( Js::dynamicForIn( $b ), false ) ), Js::dynamicKeys( $b ) ); },
	),
	// Object rest over a class collects its static fields; methods are non-enumerable.
	array(
		'(() => { class C { static theme = "dark"; static size = 3; static describe() { return 1; } } const { ...rest } = C; return [Object.keys(C), rest]; })()',
		function () {
			$c = new \SpacePress\JsClass(
				null,
				null,
				static function () {},
				array(),
				array( 'describe' => static fn () => 1 ),
				new JsObject(
					array(
						'theme' => 'dark',
						'size'  => 3,
					)
				)
			);
			return array( Js::dynamicKeys( $c ), Js::dynamicRest( $c, array() ) ); },
	),
	array(
		'(() => { const groups = /(?<x>a)/.exec("a").groups; groups.__proto__ = "own"; return [typeof groups.toString, typeof structuredClone(groups).toString, JSON.stringify(groups)]; })()',
		function () {
			$groups = Js::dynamicGet( Js::dynamicRegExpExec( new \SpacePress\RegExp( '(?<x>a)' ), 'a' ), 'groups' );
			Js::dynamicSet( $groups, '__proto__', 'own' );
			$snapshot = Js::detach( $groups );
			return array( Js::typeOf( Js::dynamicGet( $snapshot, 'toString' ) ), Js::typeOf( Js::dynamicGet( Js::clone( $groups ), 'toString' ) ), Js::jsonStringify( $snapshot ) ); },
	),
	// Imported JS values use checked dynamic operations, with undefined distinct from null.
	array(
		'(() => { const v = {present: null}; return [v.present === null, typeof v.missing, Boolean(v.missing), String(v.missing), Number.isNaN(Number(v.missing)), JSON.stringify({a: undefined, b: null, c: [undefined]})]; })()',
		function () {
			$v = new JsObject( array( 'present' => null ) );
			$missing = Js::dynamicGet( $v, 'missing' );
			return array(
				Js::dynamicGet( $v, 'present' ) === null,
				Js::typeOf( $missing ),
				Js::truthy( $missing ),
				Js::str( $missing ),
				is_nan( Js::toNumber( $missing ) ),
				Js::jsonStringify(
					new JsObject(
						array(
							'a' => $missing,
							'b' => null,
							'c' => new JsArray( array( $missing ) ),
						)
					)
				),
			); },
	),
	array(
		'(() => { const a = [1, 2]; a.extra = null; a[1] = 4; const o = {10: 1, 2: 1, z: 1, a: 1}; return [Object.keys(a), a.length, a[1], a.extra, Object.keys(o), Object.keys("🙂"), Object.keys(3)]; })()',
		function () {
			$a = new JsArray( array( 1, 2 ) );
			Js::dynamicSet( $a, 'extra', null );
			Js::dynamicSet( $a, '1', 4 );
			return array(
				Js::dynamicKeys( $a ),
				Js::dynamicGet( $a, 'length' ),
				Js::dynamicGet( $a, '1' ),
				Js::dynamicGet( $a, 'extra' ),
				Js::dynamicKeys(
					new JsObject(
						array(
							'10' => 1,
							'2'  => 1,
							'z'  => 1,
							'a'  => 1,
						)
					)
				),
				Js::dynamicKeys( '🙂' ),
				Js::dynamicKeys( 3 ),
			); },
	),
	array(
		'(function () { "use strict"; const a = arguments; a.length = 1; a[5] = null; return [Array.isArray(a), a.length, Object.keys(a), JSON.stringify(a), a.caller === undefined, Object.hasOwn(a,"length"), Object.hasOwn(a,"callee")]; })(3, 4)',
		function () {
			$a = Js::arguments( array( 3, 4 ) );
			Js::dynamicSet( $a, 'length', 1 );
			Js::dynamicSet( $a, '5', null );
			return array( $a instanceof JsArray, Js::dynamicGet( $a, 'length' ), Js::dynamicKeys( $a ), Js::jsonStringify( $a ), Js::dynamicGet( $a, 'caller' ) === Js::undefined(), Js::dynamicStaticCall( 'Object', 'hasOwn', new JsArray( array( $a, 'length' ) ) ), Js::dynamicStaticCall( 'Object', 'hasOwn', new JsArray( array( $a, 'callee' ) ) ) ); },
	),
	// An arguments object is an object, so it can be an entry record for Object.fromEntries and Map.
	array(
		'(function () { return [Object.fromEntries([arguments]), [...new Map([arguments])]]; })("k", "v")',
		function () {
			$a = Js::arguments( array( 'k', 'v' ) );
			return array( Js::dynamicStaticCall( 'Object', 'fromEntries', new JsArray( array( new JsArray( array( $a ) ) ) ) ), Js::dynamicIterable( Js::dynamicConstruct( 'Map', new JsArray( array( new JsArray( array( $a ) ) ) ) ) ) ); },
	),
	array(
		'[[] == 0, false == "0", null == undefined, NaN == NaN, "" == 0, [1] == true, {} == "[object Object]", {} == {}]',
		fn () => array( Js::looseEq( new JsArray(), 0 ), Js::looseEq( false, '0' ), Js::looseEq( null, Js::undefined() ), Js::looseEq( NAN, NAN ), Js::looseEq( '', 0 ), Js::looseEq( new JsArray( array( 1 ) ), true ), Js::looseEq( new JsObject(), '[object Object]' ), Js::looseEq( new JsObject(), new JsObject() ) ),
	),
	array(
		'["ab".slice(0, null), "ab".slice(0, undefined), "ab".charCodeAt(5), "éCOLE".toLowerCase(), "Straße".toUpperCase()]',
		fn () => array( Js::dynamicCallMethod( 'ab', 'slice', new JsArray( array( 0, null ) ) ), Js::dynamicCallMethod( 'ab', 'slice', new JsArray( array( 0, Js::undefined() ) ) ), Js::dynamicCallMethod( 'ab', 'charCodeAt', new JsArray( array( 5 ) ) ), Js::dynamicCallMethod( 'éCOLE', 'toLowerCase', new JsArray() ), Js::dynamicCallMethod( 'Straße', 'toUpperCase', new JsArray() ) ),
	),
	array(
		'(() => { const r = /(a)?b/g; const m = r.exec("🙂b ab"); const n = r.exec("🙂b ab"); const end = r.exec("🙂b ab"); return [m.index, m[1] === undefined, n.index, n[1], end, r.lastIndex]; })()',
		function () {
			$r = new \SpacePress\RegExp( '(a)?b', 'g' );
			$m = Js::dynamicRegExpExec( $r, '🙂b ab' );
			$n = Js::dynamicRegExpExec( $r, '🙂b ab' );
			$end = Js::dynamicRegExpExec( $r, '🙂b ab' );
			return array( Js::dynamicGet( $m, 'index' ), Js::dynamicGet( $m, '1' ) === Js::undefined(), Js::dynamicGet( $n, 'index' ), Js::dynamicGet( $n, '1' ), $end, $r->lastIndex ); },
	),
	array(
		'(() => { const s = new Set([1, 1, NaN, NaN]); const m = new Map([["a", 1], ["a", 2], [null, 3]]); return [[...s], [...m], s.size, m.get(null), m.has("x"), Object.prototype.toString.call(s), Object.prototype.toString.call(m), new Date(0).toISOString()]; })()',
		function () {
			$s = Js::dynamicConstruct( 'Set', new JsArray( array( new JsArray( array( 1, 1, NAN, NAN ) ) ) ) );
			$m = Js::dynamicConstruct( 'Map', new JsArray( array( new JsArray( array( new JsArray( array( 'a', 1 ) ), new JsArray( array( 'a', 2 ) ), new JsArray( array( null, 3 ) ) ) ) ) ) );
			return array( Js::dynamicIterable( $s ), Js::dynamicIterable( $m ), Js::dynamicGet( $s, 'size' ), Js::dynamicCallMethod( $m, 'get', new JsArray( array( null ) ) ), Js::dynamicCallMethod( $m, 'has', new JsArray( array( 'x' ) ) ), Js::dynamicObjectTag( $s ), Js::dynamicObjectTag( $m ), Js::dynamicCallMethod( Js::dynamicConstruct( 'Date', new JsArray( array( 0 ) ) ), 'toISOString', new JsArray() ) ); },
	),
	// Live Map/Set iteration, delete/clear/forEach and iterator objects (docs/decisions/2026-11-07-stdlib-objects.md).
	array(
		'(() => { const m = new Map([["b", 1], ["a", 2]]); const seen = []; for (const [k, v] of m) { seen.push(k + v); if (k === "b") { m.set("c", 3); m.delete("a"); } } const it = m.keys(); const first = it.next(); const s = new Set([1, 2, 3]); const fe = []; s.forEach((v, k) => fe.push(v + k)); s.delete(2); const wasCleared = [s.size]; s.clear(); return [seen, first.value, first.done, [...it], m.size, fe, wasCleared, s.size, [...s.entries()], Object.prototype.toString.call(m.entries()), [...["x", "y"].entries()], [...["x"].keys()], Array.from(new Map([[1, 2]]).values())]; })()',
		function () {
			$call = static fn ( $r, $n, ...$a ) => Js::dynamicCallMethod( $r, $n, new JsArray( $a ) );
			$m    = Js::dynamicConstruct( 'Map', new JsArray( array( new JsArray( array( new JsArray( array( 'b', 1 ) ), new JsArray( array( 'a', 2 ) ) ) ) ) ) );
			$seen = array();
			foreach ( Js::dynamicIterator( $m ) as $entry ) {
				[$k, $v] = $entry->a;
				$seen[] = $k . $v;
				if ( 'b' === $k ) {
					$call( $m, 'set', 'c', 3 );
					$call( $m, 'delete', 'a' ); }
			}
			$it = $call( $m, 'keys' );
			$first = $call( $it, 'next' );
			$s  = Js::dynamicConstruct( 'Set', new JsArray( array( new JsArray( array( 1, 2, 3 ) ) ) ) );
			$fe = array();
			$call(
				$s,
				'forEach',
				static function ( $v, $k ) use ( &$fe ) {
					$fe[] = $v + $k;
				}
			);
			$call( $s, 'delete', 2 );
			$was_cleared = array( Js::dynamicGet( $s, 'size' ) );
			$call( $s, 'clear' );
			return array( new JsArray( $seen ), Js::dynamicGet( $first, 'value' ), Js::dynamicGet( $first, 'done' ), Js::dynamicIterable( $it ), Js::dynamicGet( $m, 'size' ), new JsArray( $fe ), new JsArray( $was_cleared ), Js::dynamicGet( $s, 'size' ), Js::dynamicIterable( $call( $s, 'entries' ) ), Js::dynamicObjectTag( $call( $m, 'entries' ) ), Js::dynamicIterable( $call( new JsArray( array( 'x', 'y' ) ), 'entries' ) ), Js::dynamicIterable( $call( new JsArray( array( 'x' ) ), 'keys' ) ), Js::dynamicStaticCall( 'Array', 'from', new JsArray( array( $call( Js::dynamicConstruct( 'Map', new JsArray( array( new JsArray( array( new JsArray( array( 1, 2 ) ) ) ) ) ) ), 'values' ) ) ) ) );
		},
	),
	array(
		'[Array.from({0:"a", 1:null, length:2}, (v,i) => String(v)+i), Math.round(-0.2), Math.min(), Number.isFinite("3"), JSON.stringify(undefined)]',
		fn () => array(
			Js::dynamicStaticCall(
				'Array',
				'from',
				new JsArray(
					array(
						new JsObject(
							array(
								'0'      => 'a',
								'1'      => null,
								'length' => 2,
							)
						),
						static fn ( $v, $i ) => Js::str( $v ) . $i,
					)
				)
			),
			Js::dynamicStaticCall( 'Math', 'round', new JsArray( array( -0.2 ) ) ),
			Js::dynamicStaticCall( 'Math', 'min', new JsArray() ),
			Js::dynamicStaticCall( 'Number', 'isFinite', new JsArray( array( '3' ) ) ),
			Js::dynamicStaticCall( 'JSON', 'stringify', new JsArray( array( Js::undefined() ) ) ) === Js::undefined() ? null : false,
		),
	),
	array(
		'[...["at","pop","shift","find","findLast","forEach"].map(n => [][n](() => false) === undefined), [null].find(() => true) === null, Object.fromEntries([["x"]]).x === undefined, Object.hasOwn([], "length")]',
		function () {
			$values = array_map( static fn ( $name ) => Js::dynamicCallMethod( new JsArray(), $name, new JsArray( array( static fn () => false ) ) ) === Js::undefined(), array( 'at', 'pop', 'shift', 'find', 'findLast', 'forEach' ) );
			return array( ...$values, Js::dynamicCallMethod( new JsArray( array( null ) ), 'find', new JsArray( array( static fn () => true ) ) ) === null, Js::dynamicGet( Js::dynamicStaticCall( 'Object', 'fromEntries', new JsArray( array( new JsArray( array( new JsArray( array( 'x' ) ) ) ) ) ) ), 'x' ) === Js::undefined(), Js::dynamicStaticCall( 'Object', 'hasOwn', new JsArray( array( new JsArray(), 'length' ) ) ) ); },
	),
	array(
		'[(() => {const a=[1,2]; return Array.from(a,(v,i)=>{if(i===0)a[1]=9;return v})})(), (() => {const a={0:1,1:2,length:2}; return Array.from(a,(v,i)=>{if(i===0)a[1]=9;return v})})()]',
		function () {
			return array_map(
				static function ( $a ) {
					return Js::dynamicStaticCall(
						'Array',
						'from',
						new JsArray(
							array(
								$a,
								static function ( $value, $i ) use ( $a ) {
									if ( 0 === $i ) {
										Js::dynamicSet( $a, '1', 9 );
									} return $value;
								},
							)
						)
					);
				},
				array(
					new JsArray( array( 1, 2 ) ),
					new JsObject(
						array(
							'0'      => 1,
							'1'      => 2,
							'length' => 2,
						)
					),
				)
			); },
	),
	array(
		'(() => { const r=/(x)?b/; const m="ab".match(r); const g=/a/g; g.lastIndex=1; const all="aa".match(g); g.lastIndex=1; const text="aa".replace(g,"x"); return [m[1]===undefined,m.index,m.input,"ab".split(/(x)?/)[1]===undefined,"b".replace(/(a)?b/,(m,g)=>typeof g),all,text,g.lastIndex]; })()',
		function () {
			$m = Js::dynamicCallMethod( 'ab', 'match', new JsArray( array( new \SpacePress\RegExp( '(x)?b' ) ) ) );
			$g = new \SpacePress\RegExp( 'a', 'g' );
			$g->lastIndex = 1;
			$all = Js::dynamicCallMethod( 'aa', 'match', new JsArray( array( $g ) ) );
			$after_match = $g->lastIndex;
			$g->lastIndex = 1;
			$text = Js::dynamicCallMethod( 'aa', 'replace', new JsArray( array( $g, 'x' ) ) );
			return array( Js::dynamicGet( $m, '1' ) === Js::undefined(), Js::dynamicGet( $m, 'index' ), Js::dynamicGet( $m, 'input' ), Js::dynamicCallMethod( 'ab', 'split', new JsArray( array( new \SpacePress\RegExp( '(x)?' ) ) ) )->a[1] === Js::undefined(), Js::dynamicCallMethod( 'b', 'replace', new JsArray( array( new \SpacePress\RegExp( '(a)?b' ), static fn ( $m, $capture ) => Js::typeOf( $capture ) ) ) ), $all, $text, $g->lastIndex + $after_match ); },
	),
	array(
		'(() => {const a=[1,2]; const f=a.join; a.join=()=>"own"; const o={m:()=>1}; const n=o.m(o.m=()=>2); return [typeof f, f.call(a,"-"), a.join(), n, Math.min.apply(Math,[3,1]), Object.prototype.toString.call(Math), Object.keys(Math), JSON.stringify(Math)];})()',
		function () {
			$a = new JsArray( array( 1, 2 ) );
			$f = Js::dynamicGet( $a, 'join' );
			Js::dynamicSet( $a, 'join', static fn () => 'own' );
			$o = new JsObject( array( 'm' => static fn () => 1 ) );
			$method = Js::dynamicMethod( $o, 'm' );
			$n = $method( Js::dynamicSet( $o, 'm', static fn () => 2 ) );
			$math = Js::dynamicNamespace( 'Math' );
			return array( Js::typeOf( $f ), Js::dynamicCallMethod( $f, 'call', new JsArray( array( $a, '-' ) ) ), Js::dynamicCallMethod( $a, 'join', new JsArray() ), $n, Js::dynamicCallMethod( Js::dynamicGet( $math, 'min' ), 'apply', new JsArray( array( $math, new JsArray( array( 3, 1 ) ) ) ) ), Js::dynamicObjectTag( $math ), Js::dynamicKeys( $math ), Js::jsonStringify( $math ) ); },
	),
	array(
		'[Math.round(0.49999999999999994), Math.round(4503599627370497), "abc".endsWith("ab",-1), "abc".split(undefined,0)]',
		fn () => array( Js::dynamicStaticCall( 'Math', 'round', new JsArray( array( 0.49999999999999994 ) ) ), Js::dynamicStaticCall( 'Math', 'round', new JsArray( array( 4503599627370497 ) ) ), Js::dynamicCallMethod( 'abc', 'endsWith', new JsArray( array( 'ab', -1 ) ) ), Js::dynamicCallMethod( 'abc', 'split', new JsArray( array( Js::undefined(), 0 ) ) ) ),
	),
	array( '"foo".includes(/foo/)', fn () => Js::dynamicCallMethod( 'foo', 'includes', new JsArray( array( new \SpacePress\RegExp( 'foo' ) ) ) ) ),
	array(
		'(() => { const e = Error("bad input"); return [e.name,e.message,String(e),JSON.stringify(e),Object.keys(e),Object.prototype.toString.call(e),Error(undefined).message,Error(null).message]; })()',
		function () {
			$e = Js::dynamicConstruct( 'Error', new JsArray( array( 'bad input' ) ) );
			return array( Js::dynamicGet( $e, 'name' ), Js::dynamicGet( $e, 'message' ), Js::str( $e ), Js::jsonStringify( $e ), Js::dynamicKeys( $e ), Js::dynamicObjectTag( $e ), Js::dynamicConstruct( 'Error', new JsArray( array( Js::undefined() ) ) )->getMessage(), Js::dynamicConstruct( 'Error', new JsArray( array( null ) ) )->getMessage() ); },
	),
	array(
		'(() => {const o={valueOf:()=>7};return [Number(o),o+2]})()',
		function () {
			$o = new JsObject( array( 'valueOf' => static fn () => 7 ) );
			return array( Js::toNumber( $o ), Js::dynamicBinary( '+', $o, 2 ) ); },
	),
	array( 'null.x', fn () => Js::dynamicGet( null, 'x' ) ),
	array( '"x".missing()', fn () => Js::dynamicCallMethod( 'x', 'missing', new JsArray() ) ),
	// ---- numStr / str
	array( 'String(0.1 + 0.2)', fn () => Js::numStr( 0.1 + 0.2 ) ),
	array( 'String(1e21)', fn () => Js::numStr( 1e21 ) ),
	array( 'String(1e21 - 65536)', fn () => Js::numStr( 1e21 - 65536 ) ),
	array( 'String(1e-7)', fn () => Js::numStr( 1e-7 ) ),
	array( 'String(0.000001)', fn () => Js::numStr( 0.000001 ) ),
	array( 'String(-1.5e-7)', fn () => Js::numStr( -1.5e-7 ) ),
	array( 'String(-0)', fn () => Js::numStr( -0.0 ) ),
	array( 'String(123456789012345680000)', fn () => Js::numStr( 123456789012345680000 ) ),
	array( 'String(5e-324)', fn () => Js::numStr( 5e-324 ) ),
	array( 'String(1.7976931348623157e308)', fn () => Js::numStr( 1.7976931348623157e308 ) ),
	array( 'String(2 ** 53 + 2)', fn () => Js::numStr( 2 ** 53 + 2 ) ),
	// n(): an integer result past ±2^53 rounds to a double; postStep() steps through it.
	array( '[2 ** 53 + 1, -(2 ** 53) - 1, 2 ** 53 * 3 + 1, 2 ** 53 - 1, 1 + 2]', fn () => array( Js::n( 2 ** 53 + 1 ), Js::n( -( 2 ** 53 ) - 1 ), Js::n( 2 ** 53 * 3 + 1 ), Js::n( 2 ** 53 - 1 ), Js::n( 1 + 2 ) ) ),
	// add/sub/mul/neg/pow: an exact int operand past ±2^53 (stored, or from input) is the double JS holds.
	array(
		'(() => { const n = 9007199254740993, m = -9007199254740995; let k = n; const old = k++; return [old - 1, n + 1, n - 1, n * 1, -n, m + 2, n - m, n ** 1, k]; })()',
		function () {
			$n = 9007199254740993;
			$m = -9007199254740995;
			$k = $n;
			$old = Js::postStep( $k, 1 );
			return array( $old - 1, Js::add( $n, 1 ), Js::sub( $n, 1 ), Js::mul( $n, 1 ), Js::neg( $n ), Js::add( $m, 2 ), Js::sub( $n, $m ), Js::pow( $n, 1 ), $k ); },
	),
	array(
		'(() => { let i = 2 ** 53; const old = i++; const pre = ++i; return [old, pre, i, i + 1 === i]; })()',
		function () {
				$i = 2 ** 53;
				$old = Js::postStep( $i, 1 );
				$pre = Js::preStep( $i, 1 );
				return array( $old, $pre, $i, Js::n( $i + 1 ) === $i ); },
	),
	array( 'String(100 / 3)', fn () => Js::numStr( 100 / 3 ) ),
	array( 'String(NaN) + String(-Infinity)', fn () => Js::numStr( NAN ) . Js::numStr( -INF ) ),
	array( 'String([1, [2, null], "a", true])', fn () => Js::str( jsValue( array( 1, array( 2, null ), 'a', true ) ) ) ),
	array( 'String({a: 1}) + String(null)', fn () => Js::str( jsValue( array( 'a' => 1 ) ) ) . Js::str( null ) ),
	array( 'String(/a\/b/gi)', fn () => Js::str( $re( 'a\/b', 'ig' ) ) ),

	// ---- toNumber / parseInt / parseFloat
	array(
		'["", "  12  ", " \n 4.5e1  ", ".5", "5.", "-0", "+.5e-2"].map(Number)',
		fn () => array_map( Js::toNumber( ... ), array( '', '  12  ', "\u{a0}\n 4.5e1 \u{2028}", '.5', '5.', '-0', '+.5e-2' ) ),
	),
	array(
		'["0x1F", "0b101", "0o17", "0X1f", "-0x10", "0x", "1_000", "12px", "Infinity", "-Infinity", "infinity", "1e400"].map(Number)',
		fn () => array_map( Js::toNumber( ... ), array( '0x1F', '0b101', '0o17', '0X1f', '-0x10', '0x', '1_000', '12px', 'Infinity', '-Infinity', 'infinity', '1e400' ) ),
	),
	array( '[null, true, false, [], [7], [1, 2]].map(Number)', fn () => array_map( fn ( $v ) => Js::toNumber( jsValue( $v ) ), array( null, true, false, array(), array( 7 ), array( 1, 2 ) ) ) ),
	array(
		'["08", "0x1F", "  -42px", "1e3", "", "-0", "9007199254740993", "123456789012345678901234567890", "+-1"].map(s => parseInt(s))',
		fn () => array_map( fn ( $s ) => Js::parseInt( $s ), array( '08', '0x1F', '  -42px', '1e3', '', '-0', '9007199254740993', '123456789012345678901234567890', '+-1' ) ),
	),
	array(
		'["9007199254740993", "-9007199254740993", "9007199254740992", "0x20000000000001", "0o400000000000000001", "0b100000000000000000000000000000000000000000000000000001"].map(Number).map((n) => n - 1)',
		fn () => array_map( fn ( $s ) => Js::n( Js::toNumber( $s ) - 1 ), array( '9007199254740993', '-9007199254740993', '9007199254740992', '0x20000000000001', '0o400000000000000001', '0b100000000000000000000000000000000000000000000000000001' ) ),
	),
	array(
		'(() => { const v = JSON.parse(\'{"n":9007199254740993,"l":[-9007199254740995,3]}\'); return [v.n - 1, v.l[0] + 1, v.l[1] + 1]; })()',
		function () {
			$v = Js::jsonParse( '{"n":9007199254740993,"l":[-9007199254740995,3]}' );
			return array( Js::n( $v->p['n'] - 1 ), Js::n( $v->p['l']->a[0] + 1 ), Js::n( $v->p['l']->a[1] + 1 ) ); },
	),
	array(
		'[2 ** 60, 2 ** 53 + 1, (-2) ** 3, 2 ** -2, 2 ** 0.5, 1 ** Infinity, (-1) ** -Infinity, 2 ** Infinity, 1 ** NaN]',
		fn () => array( Js::pow( 2, 60 ), Js::n( Js::pow( 2, 53 ) + 1 ), Js::pow( -2, 3 ), Js::pow( 2, -2 ), Js::pow( 2, 0.5 ), Js::pow( 1, INF ), Js::pow( -1, -INF ), Js::pow( 2, INF ), Js::pow( 1, NAN ) ),
	),
	array(
		'[parseInt("ff", 16), parseInt("0xff", 16), parseInt("0xff", 10), parseInt("102", 2), parseInt("z", 36), parseInt("1", 37), parseInt("10", 0), parseInt("10", 4.9), parseInt("10", -1)]',
		fn () => array( Js::parseInt( 'ff', 16 ), Js::parseInt( '0xff', 16 ), Js::parseInt( '0xff', 10 ), Js::parseInt( '102', 2 ), Js::parseInt( 'z', 36 ), Js::parseInt( '1', 37 ), Js::parseInt( '10', 0 ), Js::parseInt( '10', 4.9 ), Js::parseInt( '10', -1 ) ),
	),
	array(
		'["3.14abc", ".5", "-.5e-3x", "Infinityx", "-Infinity", "e5", "  1e400", "-0", "1.e2", "0x10"].map(parseFloat)',
		fn () => array_map( Js::parseFloat( ... ), array( '3.14abc', '.5', '-.5e-3x', 'Infinityx', '-Infinity', 'e5', '  1e400', '-0', '1.e2', '0x10' ) ),
	),

	// ---- truthy / typeof / equality / Number.*
	array( '[null, 0, -0, NaN, "", "0", [], {}, 0.1].map(Boolean)', fn () => array_map( Js::truthy( ... ), array( null, 0, -0.0, NAN, '', '0', array(), array( 'a' => 1 ), 0.1 ) ) ),
	array(
		'[typeof null, typeof [], typeof 1.5, typeof "", typeof true, typeof (() => 1)]',
		fn () => array( Js::typeOf( null ), Js::typeOf( array() ), Js::typeOf( 1.5 ), Js::typeOf( '' ), Js::typeOf( true ), Js::typeOf( fn () => 1 ) ),
	),
	array( '[1 === 1.0, NaN === NaN, 0 === -0, "1" === 1]', fn () => array( Js::strictEq( 1, 1.0 ), Js::strictEq( NAN, NAN ), Js::strictEq( 0, -0.0 ), Js::strictEq( '1', 1 ) ) ),
	array(
		'[Number.isInteger(5.0), Number.isInteger(5.5), Number.isInteger("5"), Number.isFinite(Infinity), Number.isFinite(1e308)]',
		fn () => array( Js::isInteger( 5.0 ), Js::isInteger( 5.5 ), Js::isInteger( '5' ), Js::isFinite( INF ), Js::isFinite( 1e308 ) ),
	),

	// ---- toFixed
	array(
		'[1.005.toFixed(2), 2.5.toFixed(0), (-1.5).toFixed(0), (-2.5).toFixed(0), 1.45.toFixed(1), 0.5.toFixed(0), 1.5.toFixed(0)]',
		fn () => array( Js::toFixed( 1.005, 2 ), Js::toFixed( 2.5 ), Js::toFixed( -1.5 ), Js::toFixed( -2.5 ), Js::toFixed( 1.45, 1 ), Js::toFixed( 0.5 ), Js::toFixed( 1.5 ) ),
	),
	array(
		'[(-0.0001).toFixed(2), (-0).toFixed(2), (42).toFixed(3), 1e21.toFixed(2), 123.456.toFixed(10), 5e-324.toFixed(3), 0.1.toFixed(20), 999.995.toFixed(2)]',
		fn () => array( Js::toFixed( -0.0001, 2 ), Js::toFixed( -0.0, 2 ), Js::toFixed( 42, 3 ), Js::toFixed( 1e21, 2 ), Js::toFixed( 123.456, 10 ), Js::toFixed( 5e-324, 3 ), Js::toFixed( 0.1, 20 ), Js::toFixed( 999.995, 2 ) ),
	),
	array( '(1).toFixed(101)', fn () => Js::toFixed( 1, 101 ) ),

	// ---- slice / substring / charAt / at / indexOf
	array(
		'["héllo".slice(1, -1), "héllo".slice(-3), "héllo".slice(2.9), "héllo".slice(-1.5), "héllo".slice(4, 2), "héllo".slice(NaN, 2)]',
		fn () => array( Js::slice( 'héllo', 1, -1 ), Js::slice( 'héllo', -3 ), Js::slice( 'héllo', 2.9 ), Js::slice( 'héllo', -1.5 ), Js::slice( 'héllo', 4, 2 ), Js::slice( 'héllo', NAN, 2 ) ),
	),
	array(
		'((s) => [s.slice(-2), s.slice(5), s.slice(0, s.length - 2), s.slice(s.indexOf("🙂")), s.substring(-3, 2), s.substring(7, 1.7), s.substring(4), s.substring(2, Infinity)])("héllo🙂")',
		fn () => array( Js::slice( 'héllo🙂', -2 ), Js::slice( 'héllo🙂', 5 ), Js::slice( 'héllo🙂', 0, Js::length( 'héllo🙂' ) - 2 ), Js::slice( 'héllo🙂', Js::indexOf( 'héllo🙂', '🙂' ) ), Js::substring( 'héllo🙂', -3, 2 ), Js::substring( 'héllo🙂', 7, 1.7 ), Js::substring( 'héllo🙂', 4 ), Js::substring( 'héllo🙂', 2, INF ) ),
	),
	array(
		'((s) => [s.charAt(0), s.charAt(-1), s.charAt(3), s.charAt(4), s.at(-1), s.at(-4), s.at(-5), s[3], s[-1], s[3.5], s[NaN], s[-0]])("a🙂b")',
		fn () => array( Js::charAt( 'a🙂b', 0 ), Js::charAt( 'a🙂b', -1 ), Js::charAt( 'a🙂b', 3 ), Js::charAt( 'a🙂b', 4 ), Js::strAt( 'a🙂b', -1 ), Js::strAt( 'a🙂b', -4 ), Js::strAt( 'a🙂b', -5 ), Js::strIndex( 'a🙂b', 3 ), Js::strIndex( 'a🙂b', -1 ), Js::strIndex( 'a🙂b', 3.5 ), Js::strIndex( 'a🙂b', NAN ), Js::strIndex( 'a🙂b', -0.0 ) ),
	),
	array(
		'((s) => [s.indexOf("aé"), s.indexOf("aé", 3), s.indexOf("🙂", 1), s.indexOf("", 99), s.indexOf("a", -5), s.lastIndexOf("aé"), s.lastIndexOf("aé", 5), s.lastIndexOf("🙂", -3), s.lastIndexOf("x"), s.lastIndexOf(""), s.lastIndexOf("", NaN), "愀a愀".lastIndexOf("a"), "愀愀".lastIndexOf("a")])("🙂aé🙂aé")',
		fn () => array( Js::indexOf( '🙂aé🙂aé', 'aé' ), Js::indexOf( '🙂aé🙂aé', 'aé', 3 ), Js::indexOf( '🙂aé🙂aé', '🙂', 1 ), Js::indexOf( '🙂aé🙂aé', '', 99 ), Js::indexOf( '🙂aé🙂aé', 'a', -5 ), Js::lastIndexOf( '🙂aé🙂aé', 'aé' ), Js::lastIndexOf( '🙂aé🙂aé', 'aé', 5 ), Js::lastIndexOf( '🙂aé🙂aé', '🙂', -3 ), Js::lastIndexOf( '🙂aé🙂aé', 'x' ), Js::lastIndexOf( '🙂aé🙂aé', '' ), Js::lastIndexOf( '🙂aé🙂aé', '', NAN ), Js::lastIndexOf( '愀a愀', 'a' ), Js::lastIndexOf( '愀愀', 'a' ) ),
	),
	// An explicit null position is ToNumber(null) = 0, not an omitted argument (compiled
	// String.prototype.lastIndexOf gets `undefined` as omitted, decided at build time).
	array(
		'["ab".lastIndexOf("b", null), "ab".lastIndexOf("b"), [1, 2].lastIndexOf(2, null), [1, 2].includes(1, null), "ab".at(null), [1, 2].at(null), "ab".indexOf("b", null)]',
		fn () => array( Js::lastIndexOf( 'ab', 'b', null ), Js::lastIndexOf( 'ab', 'b' ), Js::lastIndexOf( new JsArray( array( 1, 2 ) ), 2, null ), Js::includes( new JsArray( array( 1, 2 ) ), 1, null ), Js::strAt( 'ab', null ), Js::arrAt( new JsArray( array( 1, 2 ) ), null ), Js::indexOf( 'ab', 'b', null ) ),
	),
	// Whole characters round-trip through unit indexes.
	array(
		'["a🙂b".slice(1, 3), "a🙂".charAt(0), "🙂x".slice(2), "a".padEnd(3, "🙂"), "🙂".at(-3) ?? null]',
		fn () => array( Js::slice( 'a🙂b', 1, 3 ), Js::charAt( 'a🙂', 0 ), Js::slice( '🙂x', 2 ), Js::padEnd( 'a', 3, '🙂' ), Js::strAt( '🙂', -3 ) ),
	),

	// ---- split
	array(
		'["a,b,,c".split(",", 2), "abc".split(""), "".split(""), "".split(","), "a,b".split(",", 0), "ab".split("", -1), "a,b".split(",", 2.7)]',
		fn () => array( Js::split( 'a,b,,c', ',', 2 ), Js::split( 'abc', '' ), Js::split( '', '' ), Js::split( '', ',' ), Js::split( 'a,b', ',', 0 ), Js::split( 'ab', '', -1 ), Js::split( 'a,b', ',', 2.7 ) ),
	),
	array(
		'["a1b2c3".split(/\d/), "a1b2c3".split(/(\d)/, 4), "abc".split(/(?:)/), "".split(/x/), "".split(/(?:)/), "a, b ,c".split(/\s*,\s*/), "ab".split(/(x)?/)]',
		fn () => array( Js::split( 'a1b2c3', $re( '\d', '' ) ), Js::split( 'a1b2c3', $re( '(\d)', '' ), 4 ), Js::split( 'abc', $re( '(?:)', '' ) ), Js::split( '', $re( 'x', '' ) ), Js::split( '', $re( '(?:)', '' ) ), Js::split( 'a, b ,c', $re( '\s*,\s*', '' ) ), Js::split( 'ab', $re( '(x)?', '' ) ) ),
	),

	// ---- pad / trim / repeat
	array(
		'["5".padStart(3, "0"), "abc".padStart(10, "123"), "abc".padStart(2), "abc".padEnd(6.9, "xy"), "x".padStart(3, ""), "é".padEnd(3, "ü"), "🙂".padStart(4, "x"), "🙂".padStart(2, "x"), "a".padEnd(5, "🙂")]',
		fn () => array( Js::padStart( '5', 3, '0' ), Js::padStart( 'abc', 10, '123' ), Js::padStart( 'abc', 2 ), Js::padEnd( 'abc', 6.9, 'xy' ), Js::padStart( 'x', 3, '' ), Js::padEnd( 'é', 3, 'ü' ), Js::padStart( '🙂', 4, 'x' ), Js::padStart( '🙂', 2, 'x' ), Js::padEnd( 'a', 5, '🙂' ) ),
	),
	array(
		'[" ﻿ x  \t".trim(), " x ".trimStart(), " x ".trimEnd(), "​x".trim()]',
		fn () => array( Js::trim( "\u{a0}\u{feff} x \u{2028}\t" ), Js::trimStart( ' x ' ), Js::trimEnd( ' x ' ), Js::trim( "\u{200b}x" ) ),
	),
	array( '["ab".repeat(2.9), "x".repeat(0)]', fn () => array( Js::repeat( 'ab', 2.9 ), Js::repeat( 'x', 0 ) ) ),
	array( '"x".repeat(-1)', fn () => Js::repeat( 'x', -1 ) ),

	// ---- replace / replaceAll
	array(
		'["aaa".replace("a", "b"), "abc".replace("b", "[$&|$`|$\'|$$|$1]"), "abc".replace("x", "y"), "abc".replace("", "_")]',
		fn () => array( Js::replace( 'aaa', 'a', 'b' ), Js::replace( 'abc', 'b', '[$&|$`|$\'|$$|$1]' ), Js::replace( 'abc', 'x', 'y' ), Js::replace( 'abc', '', '_' ) ),
	),
	array(
		'((seen) => ["🙂a".replaceAll("", (m, i) => { seen.push(i); return ""; }), "🙂🙂".replace(/(?:)/g, (m, i) => { seen.push(i); return ""; }), "🙂a🙂".match(/x*/g), seen])([])',
		function () use ( $re ) {
			$seen = array();
			$f = function ( string $m, int $i ) use ( &$seen ) {
				$seen[] = $i;
				return '';
			};
			return array( Js::replaceAll( '🙂a', '', $f ), Js::replace( '🙂🙂', $re( '(?:)', 'g' ), $f ), Js::strMatch( '🙂a🙂', $re( 'x*', 'g' ) ), $seen ); },
	),
	array(
		'["🙂".replaceAll("", "$&"), "🙂".replace(/()/g, (m, g) => g ?? "x"), "🙂".match(/^/g), "🙂".match(/\\b/g), "🙂".match(/\\B/g), "a🙂a".match(/\\B/g), "🙂a".match(/(?=a)/gu)]',
		fn () => array( Js::replaceAll( '🙂', '', '$&' ), Js::replace( '🙂', $re( '()', 'g' ), fn ( $m, $g ) => $g ?? 'x' ), Js::strMatch( '🙂', $re( '^', 'g' ) ), Js::strMatch( '🙂', $re( '\b', 'g' ) ), Js::strMatch( '🙂', $re( '\B', 'g' ) ), Js::strMatch( 'a🙂a', $re( '\B', 'g' ) ), Js::strMatch( '🙂a', $re( '(?=a)', 'gu' ) ) ),
	),
	array(
		'"2020-01-02".replace(/(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)/, "$<d>.$<m>.$<y> $<nope>|$2")',
		fn () => Js::replace( '2020-01-02', $re( '(?<y>\d{4})-(?<m>\d\d)-(?<d>\d\d)', '' ), '$<d>.$<m>.$<y> $<nope>|$2' ),
	),
	array(
		'["abc".replace(/(b)/g, "$1$1$2$<x>"), "abc".replace(/(b)/, "$10"), "abcabc".replace(/b/, "X"), "abcabc".replace(/B/gi, "X"), "aaa".replace(/a*?/g, "-")]',
		fn () => array( Js::replace( 'abc', $re( '(b)', 'g' ), '$1$1$2$<x>' ), Js::replace( 'abc', $re( '(b)', '' ), '$10' ), Js::replace( 'abcabc', $re( 'b', '' ), 'X' ), Js::replace( 'abcabc', $re( 'B', 'gi' ), 'X' ), Js::replace( 'aaa', $re( 'a*?', 'g' ), '-' ) ),
	),
	array(
		'["a1b22".replace(/\d+/g, (m, off) => `[${m}@${off}]`), "x=1,y=2".replace(/(\w)=(\d)/g, (m, k, v) => v + k), "🙂1é2".replace(/\d/g, (m, o, s) => o + s.length), "a🙂b".replace(/.?./gu, (m, at) => String(at)), "ab".replace(/(x)?b/, (m, g) => g ?? "unset")]',
		fn () => array( Js::replace( 'a1b22', $re( '\d+', 'g' ), fn ( $m, $off ) => "[$m@$off]" ), Js::replace( 'x=1,y=2', $re( '(\w)=(\d)', 'g' ), fn ( $m, $k, $v ) => $v . $k ), Js::replace( '🙂1é2', $re( '\d', 'g' ), fn ( $m, $o, $s ) => $o + Js::length( $s ) ), Js::replace( 'a🙂b', $re( '.?.', 'gu' ), fn ( $m, $at ) => (string) $at ), Js::replace( 'ab', $re( '(x)?b', '' ), fn ( $m, $g ) => Js::isNullish( $g ) ? 'unset' : $g ) ),
	),
	array(
		'["a.b.c".replaceAll(".", "-"), "aaa".replaceAll("", "-"), "aXbX".replaceAll(/x/gi, (m) => m.toLowerCase())]',
		fn () => array( Js::replaceAll( 'a.b.c', '.', '-' ), Js::replaceAll( 'aaa', '', '-' ), Js::replaceAll( 'aXbX', $re( 'x', 'gi' ), fn ( $m ) => strtolower( $m ) ) ),
	),
	array( '"a".replaceAll(/a/, "b")', fn () => Js::replaceAll( 'a', $re( 'a', '' ), 'b' ) ),

	array(
		'(() => { const g = /a/g, y = /a/y, empty = /a*/g; return [g.test("a"), g.lastIndex, g.test("a"), g.lastIndex, g.test("a"), y.test("ba"), y.lastIndex, y.test("a"), y.lastIndex, y.exec("a"), y.lastIndex, empty.test("b"), empty.lastIndex, empty.exec("b").index, empty.lastIndex]; })()',
		function () {
			$g = new \SpacePress\RegExp( 'a', 'g' );
			$y = new \SpacePress\RegExp( 'a', 'y' );
			$e = new \SpacePress\RegExp( 'a*', 'g' );
			return array( $g->test( 'a' ), $g->lastIndex, $g->test( 'a' ), $g->lastIndex, $g->test( 'a' ), $y->test( 'ba' ), $y->lastIndex, $y->test( 'a' ), $y->lastIndex, Js::dynamicRegExpExec( $y, 'a' ), $y->lastIndex, $e->test( 'b' ), $e->lastIndex, Js::dynamicGet( Js::dynamicRegExpExec( $e, 'b' ), 'index' ), $e->lastIndex ); },
	),
	// ---- RegExp translation
	array(
		'[/HELLO/i.test("hello"), /a.b/s.test("a\nb"), /a.b/.test("a\nb"), /a.b/.test("a b"), /^.$/u.test("🙂"), /^\d$/.test("٣"), /^\w$/.test("é"), /^\s$/.test(" ")]',
		fn () => array( $re( 'HELLO', 'i' )->test( 'hello' ), $re( 'a.b', 's' )->test( "a\nb" ), $re( 'a.b', '' )->test( "a\nb" ), $re( 'a.b', '' )->test( "a\u{2028}b" ), $re( '^.$', 'u' )->test( '🙂' ), $re( '^\d$', '' )->test( '٣' ), $re( '^\w$', '' )->test( 'é' ), $re( '^\s$', '' )->test( "\u{a0}" ) ),
	),
	array(
		'["a\nb".replace(/^/gm, "> "), "a\n".replace(/$/, "!"), "a\nb\n".replace(/$/gm, ";"), "café x".replace(/\b/g, "|")]',
		fn () => array( Js::replace( "a\nb", $re( '^', 'gm' ), '> ' ), Js::replace( "a\n", $re( '$', '' ), '!' ), Js::replace( "a\nb\n", $re( '$', 'gm' ), ';' ), Js::replace( 'café x', $re( '\b', 'g' ), '|' ) ),
	),
	array(
		'["$12 €34 $5".match(/(?<=\$)\d+/g), "ax cx bx".match(/(?<=ab|c)x/g), "price: 42".match(/(?<!\d)\d(?<num>\d)/), "b".match(/(a)?b/), "xyz".match(/q/g)]',
		fn () => array( Js::strMatch( '$12 €34 $5', $re( '(?<=\$)\d+', 'g' ) ), Js::strMatch( 'ax cx bx', $re( '(?<=ab|c)x', 'g' ) ), Js::strMatch( 'price: 42', $re( '(?<!\d)\d(?<num>\d)', '' ) ), Js::strMatch( 'b', $re( '(a)?b', '' ) ), Js::strMatch( 'xyz', $re( 'q', 'g' ) ) ),
	),
	array(
		'[/(a)?b\1/.test("b"), /^(?<q>["\x27]).*\k<q>$/.test("\x27hi\x27"), /[^]/.test("\n"), /[]/.test("a"), /[\d\-x]/.test("-"), /^[\w\s]+$/.test("a b_1"), /^[^\W\d]+$/.test("ab"), /^[\D]$/.test("5")]',
		fn () => array( $re( '(a)?b\1', '' )->test( 'b' ), $re( '^(?<q>["\x27]).*\k<q>$', '' )->test( "'hi'" ), $re( '[^]', '' )->test( "\n" ), $re( '[]', '' )->test( 'a' ), $re( '[\d\-x]', '' )->test( '-' ), $re( '^[\w\s]+$', '' )->test( 'a b_1' ), $re( '^[^\W\d]+$', '' )->test( 'ab' ), $re( '^[\D]$', '' )->test( '5' ) ),
	),
	array(
		'[/é/.test("é"), /\u{1F642}/u.test("🙂"), /🙂/u.test("🙂"), /a\/b/.test("a/b"), /\x41\t/.test("A\t"), /[a-z]/i.test("K")]',
		fn () => array( $re( 'é', '' )->test( 'é' ), $re( '\u{1F642}', 'u' )->test( '🙂' ), $re( '🙂', 'u' )->test( '🙂' ), $re( 'a\/b', '' )->test( 'a/b' ), $re( '\x41\t', '' )->test( "A\t" ), $re( '[a-z]', 'i' )->test( 'K' ) ),
	),
	array( '[/x/gimsu.flags, /x/.source, new RegExp("").source, /a/g.global]', fn () => array( $re( 'x', 'usmig' )->flags, $re( 'x', '' )->source, $re( '', '' )->source, $re( 'a', 'g' )->global ) ),
	array( 'new RegExp("(", "")', fn () => $re( '(', '' ) ),

	array( '[new RegExp("\\u2028").source, new RegExp("\\u2029").source]', fn () => array( $re( "\u{2028}", '' )->source, $re( "\u{2029}", '' )->source ) ),

	// ---- sort / arrays
	array(
		'[10, 9, 1].sort()',
		function () {
				$a = jsValue( array( 10, 9, 1 ) );
				Js::sort( $a );
				return $a; },
	),
	array(
		'["b", "a", 10, 9, true, null, "B", "｡", "🙂"].sort()',
		function () {
					$a = jsValue( array( 'b', 'a', 10, 9, true, null, 'B', "\u{ff61}", '🙂' ) );
					Js::sort( $a );
					return $a; },
	),
	array(
		'[[3, 1, 2].sort((a, b) => b - a), [0.3, 0.1, 0.2].sort((a, b) => a - b), [{k: 1, i: 0}, {k: 0, i: 1}, {k: 1, i: 2}, {k: 0, i: 3}].sort((a, b) => a.k - b.k).map(o => o.i)]',
		fn () => array(
			Js::sorted( jsValue( array( 3, 1, 2 ) ), Js::sortComparator( fn ( $a, $b ) => $b - $a, array(), true ) ),
			Js::sorted( jsValue( array( 0.3, 0.1, 0.2 ) ), Js::sortComparator( fn ( $a, $b ) => $a - $b, array(), false ) ),
			Js::map(
				Js::sorted(
					jsValue(
						array(
							array(
								'k' => 1,
								'i' => 0,
							),
							array(
								'k' => 0,
								'i' => 1,
							),
							array(
								'k' => 1,
								'i' => 2,
							),
							array(
								'k' => 0,
								'i' => 3,
							),
						)
					),
					Js::sortComparator( fn ( $a, $b ) => $a->p['k'] - $b->p['k'], array( 'k' ), false )
				),
				fn ( $row ) => $row->p['i']
			),
		),
	),
	array(
		'(() => { const a = [1, 2, 3, 4, 5]; const r = a.splice(-2, 1, "x", "y"); return [a, r, a.slice(-2), a.slice(1, -10), a.at(-1), a.at(9)]; })()',
		function () {
			$a = jsValue( array( 1, 2, 3, 4, 5 ) );
			$r = Js::splice( $a, -2, 1, 'x', 'y' );
			return array( $a, $r, Js::arrSlice( $a, -2 ), Js::arrSlice( $a, 1, -10 ), Js::arrAt( $a, -1 ), Js::arrAt( $a, 9 ) ); },
	),
	array(
		'(() => { const a = [1, 2, 3]; a.splice(1); const b = [1, 2, 3, 4]; b.fill(0, -3, -1); const c = [1, 2]; c.reverse(); return [a, b, c]; })()',
		function () {
			$a = jsValue( array( 1, 2, 3 ) );
			Js::splice( $a, 1 );
			$b = jsValue( array( 1, 2, 3, 4 ) );
			Js::fill( $b, 0, -3, -1 );
			$c = jsValue( array( 1, 2 ) );
			Js::reverse( $c );
			return array( $a, $b, $c ); },
	),
	array(
		'[[NaN].includes(NaN), [NaN].indexOf(NaN), [1, 2, 1].lastIndexOf(1), [0].includes(-0), [1, "1"].indexOf("1"), [1, 2, 3].indexOf(1, -2)]',
		fn () => array( Js::includes( jsValue( array( NAN ) ), NAN ), Js::indexOf( jsValue( array( NAN ) ), NAN ), Js::lastIndexOf( jsValue( array( 1, 2, 1 ) ), 1 ), Js::includes( jsValue( array( 0 ) ), -0.0 ), Js::indexOf( jsValue( array( 1, '1' ) ), '1' ), Js::indexOf( jsValue( array( 1, 2, 3 ) ), 1, -2 ) ),
	),
	array(
		'[[1, [2, [3, [4]]]].flat(), [1, [2, [3, [4]]]].flat(Infinity), [1, 2].flatMap(x => [x, [x * 10]]), [null, 1, "a"].join("-"), [[1, 2], [3]].join(";")]',
		fn () => array( Js::flat( jsValue( array( 1, array( 2, array( 3, array( 4 ) ) ) ) ) ), Js::flat( jsValue( array( 1, array( 2, array( 3, array( 4 ) ) ) ) ), INF ), Js::flatMap( jsValue( array( 1, 2 ) ), fn ( $x ) => jsValue( array( $x, array( $x * 10 ) ) ) ), Js::join( jsValue( array( null, 1, 'a' ) ), '-' ), Js::join( jsValue( array( array( 1, 2 ), array( 3 ) ) ), ';' ) ),
	),
	array(
		'[[1, 2, 3].reduce((a, b) => a + b), [].reduce((a, b) => a + b, "init"), [5, 6].map((x, i) => x * i), [0, 1, "", "x"].filter(x => x), [1, 2, 3].findLast(x => x < 3), [1, 2].findIndex(x => x > 5), [].every(x => false), [1].some(x => x)]',
		fn () => array( Js::reduce( jsValue( array( 1, 2, 3 ) ), fn ( $a, $b ) => $a + $b ), Js::reduce( jsValue( array() ), fn ( $a, $b ) => $a + $b, 'init' ), Js::map( jsValue( array( 5, 6 ) ), fn ( $x, $i ) => $x * $i ), Js::filter( jsValue( array( 0, 1, '', 'x' ) ), fn ( $x ) => $x ), Js::findLast( jsValue( array( 1, 2, 3 ) ), fn ( $x ) => $x < 3 ), Js::findIndex( jsValue( array( 1, 2 ) ), fn ( $x ) => $x > 5 ), Js::every( jsValue( array() ), fn ( $x ) => false ), Js::some( jsValue( array( 1 ) ), fn ( $x ) => $x ) ),
	),
	array( '[].reduce((a, b) => a + b)', fn () => Js::reduce( jsValue( array() ), fn ( $a, $b ) => $a + $b ) ),
	array(
		'[Math.max(), Math.min(), Math.max(1, NaN, 3), Math.max(-0, 0), Math.min(0, -0), Math.max(2, 7.5, 3)]',
		fn () => array( Js::max(), Js::min(), Js::max( 1, NAN, 3 ), Js::max( -0.0, 0 ), Js::min( 0, -0.0 ), Js::max( 2, 7.5, 3 ) ),
	),
	array( 'Array.from({length: 3}, (_, i) => i * i)', fn () => Js::range( 3, fn ( $_, $i ) => $i * $i ) ),

	// ---- objects
	array(
		'(() => { const o = {b: 1, 2: "two", a: [1], 1: "one"}; return [Object.keys(o), Object.values(o), Object.entries(o)]; })()',
		function () {
			$o = jsValue(
				array(
					'b' => 1,
					2   => 'two',
					'a' => array( 1 ),
					1   => 'one',
				)
			);
			return array( Js::keys( $o ), Js::values( $o ), Js::entries( $o ) ); },
	),
	array(
		'(() => { const {a, ...rest} = {a: 1, b: 2, c: 3}; return [rest, Object.fromEntries([["x", 1], ["y", [2]]]), Object.hasOwn({k: null}, "k"), Object.hasOwn([1], "length"), Object.hasOwn([1], "0"), Object.hasOwn([1], "1")]; })()',
		fn () => array(
			Js::omit(
				jsValue(
					array(
						'a' => 1,
						'b' => 2,
						'c' => 3,
					)
				),
				array( 'a' )
			),
			Js::fromEntries( jsValue( array( array( 'x', 1 ), array( 'y', array( 2 ) ) ) ) ),
			Js::hasOwn( jsValue( array( 'k' => null ) ), 'k' ),
			Js::hasOwn( new JsArray( array( 1 ) ), 'length' ),
			Js::hasOwn( new JsArray( array( 1 ) ), '0' ),
			Js::hasOwn( new JsArray( array( 1 ) ), '1' ),
		),
	),

	// ---- JSON
	array(
		'JSON.stringify({a: [1, {b: 2}], c: "x/é \"", d: 1.0, e: NaN, f: -0, g: [], h: 1e21, i: () => 1, j: [() => 1, Infinity]}, null, 2)',
		fn () => Js::jsonStringify(
			array(
				'a' => array( 1, array( 'b' => 2 ) ),
				'c' => "x/é\u{2028}\"",
				'd' => 1.0,
				'e' => NAN,
				'f' => -0.0,
				'g' => array(),
				'h' => 1e21,
				'i' => fn () => 1,
				'j' => array( fn () => 1, INF ),
			),
			2
		),
	),
	array(
		'[JSON.stringify([1, [2]], null, "\t"), JSON.stringify({a: 1}, null, 20), JSON.stringify({a: 1}, null, "abcd🙂🙂🙂🙂"), JSON.stringify({b: 1, 2: 1, 1: 1}), JSON.stringify(() => 1), JSON.stringify("\u0007"), JSON.stringify([1], null, 0), JSON.stringify(0.1 + 0.2)]',
		fn () => array(
			Js::jsonStringify( array( 1, array( 2 ) ), "\t" ),
			Js::jsonStringify( array( 'a' => 1 ), 20 ),
			Js::jsonStringify( array( 'a' => 1 ), 'abcd🙂🙂🙂🙂' ),
			Js::jsonStringify(
				array(
					'b' => 1,
					2   => 1,
					1   => 1,
				)
			),
			Js::jsonStringify( fn () => 1 ),
			Js::jsonStringify( "\u{7}" ),
			Js::jsonStringify( array( 1 ), 0 ),
			Js::jsonStringify( 0.1 + 0.2 ),
		),
	),
	array( 'JSON.parse("{\"a\": [1, 2.5, null, \"x\"], \"b\": {\"c\": true}}")', fn () => Js::jsonParse( '{"a": [1, 2.5, null, "x"], "b": {"c": true}}' ) ),
	// {} stays an object through parse and stringify, also beside a key PHP objects can't hold ("\u0000k").
	// sameJson: structural equality that tells {} from [] (two decoded {} are equal; {} is not []).
	array(
		'[JSON.stringify({a:{}}) === JSON.stringify({a:{}}), JSON.stringify({a:{}}) === JSON.stringify({a:[]}), JSON.stringify([1,{}]) === JSON.stringify([1,{}])]',
		fn () => array( Js::sameJson( Js::decodeJson( '{"a":{}}' ), Js::decodeJson( '{"a":{}}' ) ), Js::sameJson( Js::decodeJson( '{"a":{}}' ), Js::decodeJson( '{"a":[]}' ) ), Js::sameJson( Js::decodeJson( '[1,{}]' ), Js::decodeJson( '[1,{}]' ) ) ),
	),
	array( 'JSON.stringify(JSON.parse(JSON.stringify({ a: {}, b: [], [String.fromCharCode(0) + "k"]: { e: {} } })))', fn () => Js::jsonStringify( Js::jsonParse( '{"a":{},"b":[],"\\u0000k":{"e":{}}}' ) ) ),
	array( 'JSON.parse("{bad")', fn () => Js::jsonParse( '{bad' ) ),
	// A long string literal next to -0: the sign survives, and the text is not limited by a regex.
	array(
		'(() => { const v = JSON.parse(JSON.stringify(["a\\"b".repeat(400000)]).slice(0, -1) + ", -0, \"-0\"]"); return [v[0].length, Object.is(v[1], -0), v[2]]; })()',
		function () {
			$v = Js::jsonParse( substr( json_encode( array( str_repeat( 'a"b', 400000 ) ) ), 0, -1 ) . ', -0, "-0"]' );
			return array( mb_strlen( Js::dynamicGet( $v, '0' ) ), ( static fn ( $z ) => is_float( $z ) && 0.0 === $z && fdiv( 1.0, $z ) < 0 )( Js::dynamicGet( $v, '1' ) ), Js::dynamicGet( $v, '2' ) ); },
	),

	// ---- dates
	array(
		'["2020-01-01", "2020-01-01T10:00", "2020-02", "2021-02-30", "2020-13-01", "2020-01-01T24:00:00Z", "2020-01-01T24:00:01Z", "2020-01-01T24:00:00.0000Z", "2020-01-01T24:00:00.0001Z", "+002020-01-01", "-000001-01-01T00:00:00Z", "2020-01-01T10:00:00.123456Z", "2020-01-01T10:00:00+05:30"].map(s => new Date(s).getTime())',
		fn () => array_map( Js::date( ... ), array( '2020-01-01', '2020-01-01T10:00', '2020-02', '2021-02-30', '2020-13-01', '2020-01-01T24:00:00Z', '2020-01-01T24:00:01Z', '2020-01-01T24:00:00.0000Z', '2020-01-01T24:00:00.0001Z', '+002020-01-01', '-000001-01-01T00:00:00Z', '2020-01-01T10:00:00.123456Z', '2020-01-01T10:00:00+05:30' ) ),
	),
	array( '[new Date(1.9).getTime(), new Date(8.64e15 + 1).getTime(), new Date(null).getTime()]', fn () => array( Js::date( 1.9 ), Js::date( 8.64e15 + 1 ), Js::date( null ) ) ),
	array(
		'[0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000].map(ms => new Date(ms).toISOString())',
		fn () => array_map( Js::iso( ... ), array( 0, -1, 1e12, 8.64e15, -8.64e15, -62198755200000, 253402300800000 ) ),
	),
	array( 'new Date(NaN).toISOString()', fn () => Js::iso( NAN ) ),
);

$deviations = array(
	array(
		'new Boolean through a stored reference throws the wrapper-object message',
		function () {
			try {
				Js::dynamicConstruct( Js::booleanFunction(), new JsArray( array( false ) ) );
				return 'no throw'; } catch ( JsError $e ) {
				return array( $e->jsName, str_contains( $e->getMessage(), 'creates a wrapper object' ) ); }
		},
		array( 'TypeError', true ),
	),
	array(
		'dynamic JSON replacer fails explicitly',
		fn () => Js::dynamicStaticCall(
			'JSON',
			'stringify',
			new JsArray(
				array(
					new JsObject(
						array(
							'public'  => 1,
							'private' => 2,
						)
					),
					new JsArray( array( 'public' ) ),
				)
			)
		),
		array( '$err' => 'TypeError' ),
	),
	array( 'dynamic JSON reviver fails explicitly', fn () => Js::dynamicStaticCall( 'JSON', 'parse', new JsArray( array( '{}', static fn ( $k, $v ) => $v ) ) ), array( '$err' => 'TypeError' ) ),
	array( 'dynamic Date component overload fails explicitly', fn () => Js::dynamicConstruct( 'Date', new JsArray( array( 2020, 0 ) ) ), array( '$err' => 'TypeError' ) ),
	array( 'dynamic Date string coercion fails explicitly through array join', fn () => Js::dynamicCallMethod( new JsArray( array( new \SpacePress\JsDate( 0 ) ) ), 'join', new JsArray() ), array( '$err' => 'TypeError' ) ),
	array( 'dynamic nondecimal fraction formatting fails explicitly', fn () => Js::dynamicCallMethod( 2.5, 'toString', new JsArray( array( 16 ) ) ), array( '$err' => 'TypeError' ) ),
	array( 'dynamic nondecimal formatting of unsafe integers fails explicitly', fn () => Js::dynamicCallMethod( 2 ** 60, 'toString', new JsArray( array( 2 ) ) ), array( '$err' => 'TypeError' ) ),
	array( 'dynamic Error cause fails explicitly', fn () => Js::dynamicConstruct( 'Error', new JsArray( array( 'message', new JsObject( array( 'cause' => Js::undefined() ) ) ) ) ), array( '$err' => 'TypeError' ) ),
	array( 'an undefined operation result retains its success envelope', fn () => \SpacePress\Response::json( Js::undefined() )->http()[2], '{"data":null}' ),
	array( 'negative zero Date year is refused', fn () => Js::date( '-000000-01-01' ), array( '$err' => 'RangeError' ) ),
	array(
		'inherited Error cause is refused',
		function () {
					$base = new \SpacePress\JsClass( null, null, static fn ( $i ) => null, array( 'cause' => static fn ( $i ) => null ), array(), new JsObject() );
					$class = new \SpacePress\JsClass( $base, null, static fn ( $i ) => null, array(), array(), new JsObject() );
					return Js::dynamicConstruct( 'Error', new JsArray( array( 'x', $class->construct() ) ) ); },
		array( '$err' => 'TypeError' ),
	),
	array(
		'array Error cause is refused',
		function () {
					$a = new JsArray();
					$a->p['cause'] = 42;
					return Js::dynamicConstruct( 'Error', new JsArray( array( 'x', $a ) ) ); },
		array( '$err' => 'TypeError' ),
	),
	array( 'unsupported legacy control escapes are refused', fn () => Js::re( '\\c0', '' ), array( '$err' => 'SyntaxError' ) ),
	array( 'error stack is its header line', fn () => Js::dynamicGet( new JsError( 'x', 'TypeError' ), 'stack' ), 'TypeError: x' ),
	array( 'non-ISO Date strings are refused', fn () => Js::date( '2020-1-1' ), array( '$err' => 'RangeError' ) ),
);

// A JavaScript function is always a Closure. A PHP callable string or [class, method] array reaching
// a callback parameter is refused before PHP can call the function it names.
$phpCallables    = array(
	'strrev'                => 'strrev',
	'sprintf'               => 'sprintf',
	'a static method array' => array( Js::class, 'typeOf' ),
);
$callbackHelpers = array(
	'map'                   => fn ( $f ) => Js::map( new JsArray( array( 'a' ) ), $f ),
	'filter'                => fn ( $f ) => Js::filter( new JsArray( array( 'a' ) ), $f ),
	'find'                  => fn ( $f ) => Js::find( new JsArray( array( 'a' ) ), $f ),
	'findIndex'             => fn ( $f ) => Js::findIndex( new JsArray( array( 'a' ) ), $f ),
	'findLast'              => fn ( $f ) => Js::findLast( new JsArray( array( 'a' ) ), $f ),
	'findLastIndex'         => fn ( $f ) => Js::findLastIndex( new JsArray( array( 'a' ) ), $f ),
	'some'                  => fn ( $f ) => Js::some( new JsArray( array( 'a' ) ), $f ),
	'every'                 => fn ( $f ) => Js::every( new JsArray( array( 'a' ) ), $f ),
	'forEach'               => fn ( $f ) => Js::forEach( new JsArray( array( 'a' ) ), $f ),
	'reduce'                => fn ( $f ) => Js::reduce( new JsArray( array( 'a' ) ), $f, '' ),
	'flatMap'               => fn ( $f ) => Js::flatMap( new JsArray( array( 'a' ) ), $f ),
	'from'                  => fn ( $f ) => Js::from( new JsArray( array( 'a' ) ), $f ),
	'range'                 => fn ( $f ) => Js::range( 1, $f ),
	'replace'               => fn ( $f ) => Js::replace( 'a', 'a', $f ),
	'replaceAll'            => fn ( $f ) => Js::replaceAll( 'a', 'a', $f ),
	'replace with a RegExp' => fn ( $f ) => Js::replace( 'a', Js::re( 'a', 'g' ), $f ),
	'Headers forEach'       => fn ( $f ) => ( new \SpacePress\FetchHeaders( array( 'a' => 'b' ) ) )->forEach( $f ),
);
foreach ( $callbackHelpers as $helper => $call ) {
	foreach ( $phpCallables as $label => $callable ) {
		// A string replacement is a template (below), never a function name.
		if ( str_starts_with( $helper, 'replace' ) && is_string( $callable ) ) {
			continue; }
		$deviations[] = array(
			"$helper refuses the PHP callable $label",
			static function () use ( $call, $callable ) {
				// The parameter type refuses it. An ArgumentCountError is a TypeError too, but it means
				// PHP already called the function.
				try {
					$call( $callable );
					return 'called';
				} catch ( \TypeError $e ) {
					return preg_match( '/Argument #\d+ \(\$\w+\) must be of type \??Closure\b/', $e->getMessage() ) === 1 ? 'refused' : $e->getMessage(); }
			},
			'refused',
		);
	}
}
// A replacement string stays a template: '$&' is not a callable, even when it names a function.
$deviations[] = array( 'a replacement naming a PHP function is a template', fn () => array( Js::replace( 'a', 'a', 'strtoupper' ), Js::replaceAll( 'aa', 'a', 'sprintf' ), Js::replace( 'a', Js::re( 'a', 'g' ), 'strrev' ) ), array( 'strtoupper', 'sprintfsprintf', 'strrev' ) );
// The check compiled code wraps around every function value it did not build itself.
foreach ( $phpCallables as $label => $callable ) {
	$deviations[] = array( "Js::callback refuses the PHP callable $label", fn () => Js::callback( $callable ), array( '$err' => 'TypeError' ) );
}
$deviations[] = array( 'Js::callback passes a closure through', fn () => Js::map( new JsArray( array( 'a' ) ), Js::callback( static fn ( $v ) => "$v!" ) )->a, array( 'a!' ) );

// Each fixed-length helper owns a separate shrink/growth row because its walk can fail independently.
$walks = array( 'map', 'filter', 'forEach', 'some', 'every', 'reduce', 'flatMap', 'find', 'findIndex', 'findLast', 'findLastIndex' );
foreach ( $walks as $method ) {
	$invoke       = static fn ( JsArray $a, callable $visit ) => 'reduce' === $method
		? Js::reduce( $a, static fn ( $acc, $v, $i, $source ) => $visit( $v, $i, $source ), 0 )
		: Js::$method( $a, $visit );
	$deviations[] = array(
		"$method rejects a reached missing index",
		static function () use ( $invoke, $method ) {
			$a     = new JsArray( array( 1, 2, 3 ) );
			$first = true;
			$invoke(
				$a,
				static function ( $v ) use ( $a, &$first, $method ) {
					if ( $first ) {
						Js::pop( $a );
						Js::pop( $a );
						$first = false; }
					return 'every' === $method;
				}
			);
		},
		array( '$err' => 'RangeError' ),
	);
	$jsCallback   = 'reduce' === $method ? '(acc, v, i, source)' : '(v, i, source)';
	$truth        = 'every' === $method ? 'true' : 'false';
	$extra        = 'reduce' === $method ? ', 0' : '';
	$cases[]      = array(
		"(() => { const a = [1,2,3]; const seen = []; const result = a.$method($jsCallback => { a.push(9); seen.push([v,i,source === a]); return $truth; }$extra); return [result ?? null, seen, a]; })()",
		static function () use ( $method, $invoke ) {
			$a      = new JsArray( array( 1, 2, 3 ) );
			$seen       = array();
			$result = $invoke(
				$a,
				static function ( $v, $i, $source ) use ( $a, &$seen, $method ) {
					Js::push( $a, 9 );
					$seen[] = array( $v, $i, $source === $a );
					return 'every' === $method;
				}
			);
			return array( $result, $seen, $a );
		},
	);
}
$deviations[] = array( 'past-end writes reject sparse arrays', fn () => Js::setAt( new JsArray( array( 1 ) ), 2, 9 ), array( '$err' => 'RangeError' ) );
$deviations[] = array(
	'compound index write rejects a sparse result',
	static function () {
		$a   = new JsArray( array( 'a' ) );
		$old = Js::get( $a, 2 );
		return Js::setAt( $a, 2, Js::str( $old ) . 'x' );
	},
	array( '$err' => 'RangeError' ),
);
$deviations[] = array(
	'index increment rejects a sparse result',
	static function () {
		$a   = new JsArray( array( 1 ) );
		$old = Js::get( $a, 5 ) ?? NAN;
		return Js::setAt( $a, 5, Js::add( $old, 1 ) );
	},
	array( '$err' => 'RangeError' ),
);
$deviations[] = array( 'fractional writes reject named array properties', fn () => Js::setAt( new JsArray( array( 1 ) ), 0.5, 9 ), array( '$err' => 'RangeError' ) );
$cases[]      = array(
	'(() => { const a = [1,2]; return [a.map((v,i) => { if (i === 1) a.pop(); return v; }), a]; })()',
	static function () {
		$a      = new JsArray( array( 1, 2 ) );
		$result = Js::map(
			$a,
			static function ( $v, $i ) use ( $a ) {
				if ( 1 === $i ) {
					Js::pop( $a );
				} return $v;
			}
		);
		return array( $result, $a );
	},
);
$cases[]      = array(
	'(() => { const a = [1,2,3]; return a.some(v => { a.pop(); a.pop(); return true; }); })()',
	static function () {
		$a = new JsArray( array( 1, 2, 3 ) );
		return Js::some(
			$a,
			static function () use ( $a ) {
				Js::pop( $a );
				Js::pop( $a );
				return true;
			}
		);
	},
);
$cases[]      = array(
	'(() => { const a = [1,2,3]; return a.findLast(v => { a.pop(); return false; }) ?? null; })()',
	static function () {
		$a = new JsArray( array( 1, 2, 3 ) );
		return Js::findLast(
			$a,
			static function () use ( $a ) {
				Js::pop( $a );
				return false;
			}
		);
	},
);
$cases[]      = array(
	'(() => { const calls = []; const a = [3, 2, 1, 5, 4].sort((x, y) => { calls.push(x + ":" + y); return x - y; }); return [a, calls]; })()',
	static function () {
		$calls = new JsArray();
		$a     = Js::sort(
			new JsArray( array( 3, 2, 1, 5, 4 ) ),
			static function ( $x, $y ) use ( $calls ) {
				Js::push( $calls, $x . ':' . $y );
				return $x - $y;
			}
		);
		return array( $a, $calls );
	},
);
$cases[]      = array(
	'(() => { try { ["b", "c", "a"].sort("strcmp"); return "sorted"; } catch (e) { return e.name; } })()',
	static function () {
		try {
			Js::sort( new JsArray( array( 'b', 'c', 'a' ) ), 'strcmp' );
			return 'sorted';
		} catch ( JsError $e ) {
			return $e->jsName; }
	},
);
$cases[]      = array( '[{b: 1}, [2], {a: 0}, [10]].sort()', fn () => Js::sort( jsValue( array( array( 'b' => 1 ), array( 2 ), array( 'a' => 0 ), array( 10 ) ) ) ) );
$cases[]      = array(
	'[[1, NaN, 0, -Infinity].sort((x, y) => x - y), [{k: "b"}, {k: 2}, {k: "a"}].sort((x, y) => x.k - y.k).map(o => o.k)]',
	fn () => array(
		Js::sort( new JsArray( array( 1, NAN, 0, -INF ) ), Js::sortComparator( static fn ( $x, $y ) => $x - $y, array(), false ) ),
		Js::map( Js::sort( jsValue( array( array( 'k' => 'b' ), array( 'k' => 2 ), array( 'k' => 'a' ) ) ), Js::sortComparator( static fn ( $x, $y ) => Js::toNumber( $x->p['k'] ) - Js::toNumber( $y->p['k'] ), array( 'k' ), false ) ), fn ( $row ) => $row->p['k'] ),
	),
);
$deviations[] = array( 'borrowed methods cannot change families', fn () => Js::dynamicCallMethod( Js::dynamicGet( new JsArray(), 'includes' ), 'call', new JsArray( array( 'abc', 'ab' ) ) ), array( '$err' => 'TypeError' ) );
$cases[]      = array( '[Array.from("a🙂b"), [1,2].with(-1, 9), [1,2].toReversed()]', fn () => array( Js::from( 'a🙂b' ), Js::with( new JsArray( array( 1, 2 ) ), -1, 9 ), Js::toReversed( new JsArray( array( 1, 2 ) ) ) ) );
$cases[]      = array(
	'(() => { const a = [1]; const n = a.push(2); const x = a.pop(); const m = a.unshift(0); const y = a.shift(); return [n,x,m,y,a]; })()',
	static function () {
		$a = new JsArray( array( 1 ) );
		$n = Js::push( $a, 2 );
		$x = Js::pop( $a );
		$m = Js::unshift( $a, 0 );
		$y = Js::shift( $a );
		return array( $n, $x, $m, $y, $a );
	},
);


$cases[]      = array(
	'(() => { const p = {x:1}; const a = [[p]]; const flat = a.flat(); flat[0].x = 2; return [flat, a]; })()',
	static function () {
		$p                  = new JsObject( array( 'x' => 1 ) );
		$a                  = new JsArray( array( new JsArray( array( $p ) ) ) );
		$flat               = Js::flat( $a );
		$flat->a[0]->p['x'] = 2;
		return array( $flat, $a );
	},
);
$cases[]      = array(
	'(() => { const a = [3,1,2]; return [a.toSorted((x,y) => x-y), a.concat([4],5), a]; })()',
	static function () {
		$a = new JsArray( array( 3, 1, 2 ) );
		return array( Js::toSorted( $a, Js::sortComparator( static fn ( $x, $y ) => $x - $y, array(), false ) ), Js::concat( $a, new JsArray( array( 4 ) ), 5 ), $a );
	},
);
$cases[]      = array(
	'(() => { const p = {x:1}; const array = [p,p]; array.extra = p; const set = new Set([p]); set.add(set); const map = new Map([[p,set]]); map.set(map,p); const date = new Date(0); const source = {array,set,map,date,again:date}; const copy = structuredClone(source); copy.array[0].x = 2; copy.set.add("new"); copy.map.set("new",3); return [copy.array[0] === copy.array[1], copy.array.extra === copy.array[0], p.x, copy.array, set.size, copy.set.size, map.size, copy.map.size, copy.set.has(copy.set), copy.map.get(copy.array[0]) === copy.set, copy.map.get(copy.map) === copy.array[0], copy.date !== date, copy.date === copy.again, copy.date.getTime()]; })()',
	static function () {
		$p                 = new JsObject( array( 'x' => 1 ) );
		$array             = new JsArray( array( $p, $p ) );
		$array->p['extra'] = $p;
		$set               = new \SpacePress\JsSet();
		$set->add( $p )->add( $set );
		$map = new \SpacePress\JsMap();
		$map->set( $p, $set )->set( $map, $p );
		$date                         = new \SpacePress\JsDate( 0 );
		$copy                         = Js::clone(
			new JsObject(
				array(
					'array' => $array,
					'set'   => $set,
					'map'   => $map,
					'date'  => $date,
					'again' => $date,
				)
			)
		);
		$items                        = $copy->p;
		$items['array']->a[0]->p['x'] = 2;
		$items['set']->add( 'new' );
		$items['map']->set( 'new', 3 );
		return array( $items['array']->a[0] === $items['array']->a[1], $items['array']->p['extra'] === $items['array']->a[0], $p->p['x'], $items['array'], $set->size(), $items['set']->size(), $map->size(), $items['map']->size(), $items['set']->has( $items['set'] ), $items['map']->get( $items['array']->a[0] ) === $items['set'], $items['map']->get( $items['map'] ) === $items['array']->a[0], $items['date'] !== $date, $items['date'] === $items['again'], $items['date']->milliseconds );
	},
);
$cases[]      = array( '(function () { return structuredClone(arguments); })(1)', fn () => Js::clone( Js::arguments( array( 1 ) ) ) );
$deviations[] = array(
	'detached collection and arguments graphs retain identity only within the copy',
	static function () {
		$set  = new \SpacePress\JsSet();
		$map  = new \SpacePress\JsMap();
		$args = Js::arguments( array( $set ) );
		$set->add( $map );
		$map->set( $args, $set );
		$args->length = new JsObject( array( 'nested' => $set ) );
		$copy         = Js::detach( $args );
		$copied_set    = $copy->a[0];
		$copied_map    = $copied_set->values()[0];
		$copied_set->add( 2 );
		return array( $copy !== $args, $set->size(), $copied_set->size(), $copied_map->get( $copy ) === $copied_set, $copy->length !== $args->length, $copy->length->p['nested'] === $copied_set );
	},
	array( true, 1, 2, true, true, true ),
);

// ---------------------------------------------------------------- run node once

$node    = getenv( 'NODE' ) ?: 'node';
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
$js      = $prelude . "\n" . implode( "\n", array_map( fn ( $c ) => "run(() => ({$c[0]}));", $cases ) ) . "\nprocess.stdout.write(JSON.stringify(out));\n";
$file    = tempnam( sys_get_temp_dir(), 'spacepress-parity-' ) . '.js';
file_put_contents( $file, $js );
$raw = shell_exec( 'TZ=UTC ' . escapeshellarg( $node ) . ' ' . escapeshellarg( $file ) . ' 2>&1' );
unlink( $file );
$expected = json_decode( (string) $raw, true );
if ( ! is_array( $expected ) || count( $expected ) !== count( $cases ) ) {
	fwrite( STDERR, "node did not produce one result per case:\n$raw\n" );
	exit( 2 );
}

// ---------------------------------------------------------------- compare

/** Typed comparison of a PHP value against a tagged JS value. Returns null when equal, else a reason. */
function mismatch( mixed $actual, mixed $exp, string $path = '' ): ?string {
	if ( $actual === Js::undefined() ) {
		$actual = null; }
	if ( $actual instanceof JsObject || $actual instanceof JsArray ) {
		$actual = \SpacePress\Seam::container( $actual ); }
	$show = fn ( $v ) => is_float( $v ) ? sprintf( '%.17g', $v ) : var_export( $v, true );
	if ( is_array( $exp ) && isset( $exp['$'] ) ) {
		$special = array(
			'NaN'       => NAN,
			'Infinity'  => INF,
			'-Infinity' => -INF,
			'-0'        => -0.0,
		)[ $exp['$'] ];
		$ok      = is_float( $actual ) && ( is_nan( $special ) ? is_nan( $actual ) : ( $actual === $special && ( fdiv( 1, $actual ) < 0 ) === ( fdiv( 1, $special ) < 0 ) ) );

		return $ok ? null : "$path: expected {$exp['$']}, got " . $show( $actual );
	}
	if ( is_int( $exp ) || is_float( $exp ) ) {
		$ok = ( is_int( $actual ) || is_float( $actual ) ) && (float) $actual === (float) $exp
			&& ! ( is_float( $actual ) && 0.0 === $actual && fdiv( 1, $actual ) < 0 );

		return $ok ? null : "$path: expected " . $show( $exp ) . ', got ' . $show( $actual );
	}
	if ( is_array( $exp ) && isset( $exp['o'] ) && count( $exp ) === 1 && is_array( $exp['o'] ) ) {
		if ( ! is_array( $actual ) || ( array() !== $actual && array_is_list( $actual ) && array() !== $exp['o'] ) ) {
			return "$path: expected object, got " . json_encode( $actual );
		}
		if ( array_map( 'strval', array_keys( $actual ) ) !== array_map( 'strval', array_keys( $exp['o'] ) ) ) {
			return "$path: keys differ: " . json_encode( array_keys( $actual ) ) . ' vs ' . json_encode( array_keys( $exp['o'] ) );
		}
		foreach ( $exp['o'] as $k => $v ) {
			if ( ( $r = mismatch( $actual[ $k ], $v, "$path.$k" ) ) !== null ) {
				return $r;
			}
		}

		return null;
	}
	if ( is_array( $exp ) && array_is_list( $exp ) ) {
		if ( ! is_array( $actual ) || ! array_is_list( $actual ) || count( $actual ) !== count( $exp ) ) {
			return "$path: expected " . json_encode( $exp, JSON_UNESCAPED_UNICODE ) . ', got ' . json_encode( $actual, JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR );
		}
		foreach ( $exp as $i => $v ) {
			if ( ( $r = mismatch( $actual[ $i ], $v, "{$path}[$i]" ) ) !== null ) {
				return $r;
			}
		}

		return null;
	}

	return $actual === $exp ? null : "$path: expected " . $show( $exp ) . ', got ' . $show( $actual );
}

// UTF-16 subset restrictions complement the dense-array restrictions above.
$deviations = array_merge(
	$deviations,
	array(
		// A lone surrogate can't live in a UTF-8 string; any stand-in would merge distinct JS values.
		array( 'inserting inside a surrogate pair throws', fn () => array( Js::replaceAll( '🙂', '', '-' ), Js::replace( '🙂', Js::re( '(?:)', 'g' ), '-' ) ), array( '$err' => 'RangeError' ) ),
		array( '$` inside a surrogate pair throws', fn () => Js::replaceAll( '🙂', '', '$`' ), array( '$err' => 'RangeError' ) ),
		array( 'global dots cannot combine code-point matches with UTF-16 offsets', fn () => Js::replace( 'a🙂b', Js::re( '.?.', 'g' ), fn ( $m, $at ) => (string) $at ), array( '$err' => 'RangeError' ) ),
		array( 'complemented shorthands need Unicode mode on astral text', fn () => Js::strMatch( 'a🙂b', Js::re( '\\S?\\S', 'g' ) ), array( '$err' => 'RangeError' ) ),
		array( 'lookarounds on astral text need Unicode mode', fn () => Js::strMatch( '🙂', Js::re( '(?=.)', 'g' ) ), array( '$err' => 'RangeError' ) ),
		array( 'classes cannot fabricate an in-pair empty match', fn () => Js::strMatch( 'a🙂a', Js::re( '\B[^\uFDD0]?', 'g' ) ), array( '$err' => 'RangeError' ) ),
		array( 'surrogate escapes cannot fabricate an in-pair empty match', fn () => Js::strMatch( 'a🙂a', Js::re( '\B\uDE00?', 'g' ) ), array( '$err' => 'SyntaxError' ) ),
		array( 'astral literals need Unicode mode for shared interior probes', fn () => Js::strMatch( '🙂🙂', Js::re( '.🙂|', 'g' ) ), array( '$err' => 'SyntaxError' ) ),
		array( 'escaped astral literals need Unicode mode for shared interior probes', fn () => Js::strMatch( '🙂🙂', Js::re( '.\\uD83D\\uDE42|', 'g' ) ), array( '$err' => 'SyntaxError' ) ),
		array( 'charAt splitting a pair throws', fn () => Js::charAt( 'a🙂', 1 ), array( '$err' => 'RangeError' ) ),
		array( 'non-Unicode RegExp split on astral text is refused', fn () => Js::split( '😀', Js::re( '(?:)', '' ) ), array( '$err' => 'RangeError' ) ),
		array( 'non-Unicode Kelvin folding is refused', fn () => Js::re( 'k', 'i' )->test( 'K' ), array( '$err' => 'RangeError' ) ),
		array( 'non-Unicode long s folding is refused', fn () => Js::re( 's', 'i' )->test( 'ſ' ), array( '$err' => 'RangeError' ) ),
		array( 'non-Unicode source folding is refused', fn () => Js::re( 'K', 'i' )->test( 'k' ), array( '$err' => 'SyntaxError' ) ),
		array( 'non-Unicode escaped source folding is refused', fn () => Js::re( '\\u212a', 'i' )->test( 'k' ), array( '$err' => 'SyntaxError' ) ),
		array( 'engine-dependent reciprocal powers are refused', fn () => Js::pow( 45.29, -1 ), array( '$err' => 'RangeError' ) ),
		array( 'Unicode malformed regex braces are refused', fn () => Js::re( 'a{,2}', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode unmatched regex braces are refused', fn () => Js::re( 'a}', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'possessive RegExp quantifiers are refused', fn () => Js::re( 'a++a', 'g' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode class identity escapes are refused', fn () => Js::re( '[\\k<a>]', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode ignore-case table differences are refused', fn () => Js::re( '\\u1c89', 'iu' )->test( 'ᲊ' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode ignore-case non-ASCII input is refused', fn () => Js::re( 'k', 'iu' )->test( 'K' ), array( '$err' => 'RangeError' ) ),
		array( 'Unicode ignore-case literal source is refused', fn () => Js::re( 'É', 'iu' )->test( 'é' ), array( '$err' => 'SyntaxError' ) ),
		array( 'class shorthand beside a range is refused', fn () => Js::re( '[\\w-a]', '' )->test( '-' ), array( '$err' => 'SyntaxError' ) ),
		array( 'class range before a shorthand is refused', fn () => Js::re( '[a-\\d]', '' )->test( '`' ), array( '$err' => 'SyntaxError' ) ),
		array( 'space-separated Date extension is refused', fn () => Js::date( '2000-01-01 24:00:00.0001Z' ), array( '$err' => 'RangeError' ) ),
		array( 'compact Date offset extension is refused', fn () => Js::date( '2000-01-01T00:00:00+0100' ), array( '$err' => 'RangeError' ) ),
		array( 'partial Date with time is refused', fn () => Js::date( '2000T00:00:00Z' ), array( '$err' => 'RangeError' ) ),
		array( 'nullable repeated noncapturing groups are refused', fn () => Js::replace( 'b', Js::re( '(?:a*|b)*', '' ), 'X' ), array( '$err' => 'SyntaxError' ) ),
		array( 'nullable optional noncapturing groups are refused', fn () => Js::replace( 'b', Js::re( '(?:a*|b)?', '' ), 'X' ), array( '$err' => 'SyntaxError' ) ),
		array( 'ownership of unsupported namespace constants is refused', fn () => Js::dynamicStaticCall( 'Object', 'hasOwn', new JsArray( array( Js::dynamicNamespace( 'Math' ), 'LN2' ) ) ), array( '$err' => 'TypeError' ) ),
		array( 'unsupported namespace constants are refused', fn () => Js::dynamicGet( Js::dynamicNamespace( 'Math' ), 'LN2' ), array( '$err' => 'TypeError' ) ),
		array( 'unsupported namespace method values are refused', fn () => Js::dynamicGet( Js::dynamicNamespace( 'Math' ), 'sin' ), array( '$err' => 'TypeError' ) ),
		array(
			'Error options are checked after message conversion',
			function () {
				$options = new JsObject();
				$message = new JsObject(
					array(
						'toString' => static function () use ( $options ) {
							$options->p['cause'] = 7;
							return 'x';
						},
					)
				);
				return Js::dynamicConstruct( 'Error', new JsArray( array( $message, $options ) ) ); },
			array( '$err' => 'TypeError' ),
		),
		array( 'lone surrogate classes are refused', fn () => Js::re( '[\\uD800]', '' )->test( '?' ), array( '$err' => 'SyntaxError' ) ),
		array( 'negated lone surrogate classes are refused', fn () => Js::re( '[^\\uD800]', 'u' )->test( '?' ), array( '$err' => 'SyntaxError' ) ),
		array( 'non-Unicode escaped astral quantifiers are refused on ASCII input', fn () => Js::re( '\\uD83D\\uDE42?', '' )->test( 'a' ), array( '$err' => 'SyntaxError' ) ),
		array( 'non-Unicode astral quantifiers are refused on ASCII input', fn () => Js::re( '🙂?', '' )->test( 'a' ), array( '$err' => 'SyntaxError' ) ),
		array( 'non-Unicode surrogate class ranges are refused on BMP input', fn () => Js::re( '[a-\\uD83D\\uDE42]', '' )->test( '' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode category version differences are refused', fn () => Js::re( '\\p{Lu}', 'u' )->test( 'Ᲊ' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode class properties are refused', fn () => Js::re( '[\\P{Ll}]', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'case-insensitive positive Unicode properties are refused', fn () => Js::re( '\\p{Lu}', 'iu' ), array( '$err' => 'SyntaxError' ) ),
		array( 'Unicode trailing escapes are refused', fn () => Js::re( '\\', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'legacy trailing escapes are refused', fn () => Js::re( '\\', '' ), array( '$err' => 'SyntaxError' ) ),
		array( 'invalid Unicode hex escapes are refused', fn () => Js::re( '\\x', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'invalid Unicode escapes are refused', fn () => Js::re( '\\u', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'invalid Unicode identity escapes are refused', fn () => Js::re( '\\q', 'u' ), array( '$err' => 'SyntaxError' ) ),
		array( 'case-insensitive negated Unicode properties are refused', fn () => Js::re( '\\P{Ll}', 'iu' ), array( '$err' => 'SyntaxError' ) ),
		array( 'case-insensitive negated class properties are refused', fn () => Js::re( '[\\P{Ll}]', 'iu' ), array( '$err' => 'SyntaxError' ) ),
		array( 'capturing lookbehind is refused', fn () => Js::re( '(?<=([ab]{1,2})([bc]{1,2}))$', '' ), array( '$err' => 'SyntaxError' ) ),
		array( 'custom toJSON callbacks are refused', fn () => Js::jsonStringify( new JsObject( array( 'toJSON' => static fn () => 42 ) ) ), array( '$err' => 'TypeError' ) ),
		array( 'array prototype writes are refused', fn () => Js::dynamicSet( new JsArray(), '__proto__', 1 ), array( '$err' => 'TypeError' ) ),
		array( 'arguments prototype writes are refused', fn () => Js::dynamicSet( Js::arguments( array() ), '__proto__', 1 ), array( '$err' => 'TypeError' ) ),
		array( 'prototype writes are refused by the shared setter', fn () => Js::set( new JsObject(), '__proto__', 1 ), array( '$err' => 'TypeError' ) ),
		array( 'non-ISO invalid Date strings are refused', fn () => Js::date( 'nope' ), array( '$err' => 'RangeError' ) ),
		array( 'empty array Date strings are refused', fn () => Js::date( new JsArray() ), array( '$err' => 'RangeError' ) ),
		array( 'multi-element Date arrays are refused', fn () => Js::date( new JsArray( array( '2020-01-01', '2020-01-02' ) ) ), array( '$err' => 'RangeError' ) ),
		array( 'plain object Date strings are refused', fn () => Js::date( new JsObject( array( 'x' => 1 ) ) ), array( '$err' => 'RangeError' ) ),
		array( 'loose function comparison requiring source text is refused', fn () => Js::looseEq( static fn () => 1, '()=>1' ), array( '$err' => 'TypeError' ) ),
		array( 'function string conversion is refused', fn () => Js::str( static fn () => 1 ), array( '$err' => 'TypeError' ) ),
		array( 'function metadata reads are refused', fn () => Js::dynamicGet( static fn () => 1, 'length' ), array( '$err' => 'TypeError' ) ),
		array( 'function binding values are refused', fn () => Js::dynamicGet( static fn () => 1, 'bind' ), array( '$err' => 'TypeError' ) ),
		array( 'function own properties are refused', fn () => Js::dynamicStaticCall( 'Object', 'hasOwn', new JsArray( array( static fn () => 1, 'length' ) ) ), array( '$err' => 'TypeError' ) ),
		array( 'repeated captures are refused', fn () => Js::re( '(a(b)?)+', '' ), array( '$err' => 'SyntaxError' ) ),
		array( 'astral regex quantifiers need Unicode mode', fn () => Js::re( '^😀+$', '' )->test( '😀😀' ), array( '$err' => 'SyntaxError' ) ),
		array( 'slice ending inside a pair throws', fn () => Js::slice( 'a🙂b', 0, 2 ), array( '$err' => 'RangeError' ) ),
		array( 'slice starting inside a pair throws', fn () => Js::slice( 'a🙂b', 2 ), array( '$err' => 'RangeError' ) ),
		array( 'split("") on a pair throws', fn () => Js::split( 'a🙂b', '' ), array( '$err' => 'RangeError' ) ),
		array( 'split("", limit) stops before a pair past the limit', fn () => Js::split( 'a🙂b', '', 1 )->a, array( 'a' ) ),
		array( 'split("", limit) splitting a pair within the limit throws', fn () => Js::split( 'a🙂b', '', 2 ), array( '$err' => 'RangeError' ) ),
		array( 'padEnd cutting a pair throws', fn () => Js::padEnd( 'a', 2, '🙂' ), array( '$err' => 'RangeError' ) ),
		array( 'an unused JSON gap cut through a pair is fine', fn () => array( Js::jsonStringify( 1, '123456789🙂' ), Js::jsonStringify( new \SpacePress\JsArray(), '123456789🙂' ), Js::jsonStringify( new \SpacePress\JsObject(), '123456789🙂' ), Js::jsonStringify( new \SpacePress\JsObject( array( 'f' => static fn () => 1 ) ), '123456789🙂' ), Js::jsonStringify( static fn () => 1, '123456789🙂' ) ), array( '1', '[]', '{}', '{}', null ) ),
		array( 'a used JSON gap cut through a pair throws', fn () => Js::jsonStringify( new \SpacePress\JsArray( array( 1 ) ), '123456789🙂' ), array( '$err' => 'RangeError' ) ),
	)
);

$passed = 0;
$failed = 0;
foreach ( $deviations as [$label, $php, $want] ) {
	try {
		$got = $php();
	} catch ( JsError $e ) {
		$got = array( '$err' => $e->jsName );
	}
	if ( $got === $want ) {
		++$passed;
	} else {
		++$failed;
		echo "FAIL  deviation: $label\n      got " . json_encode( $got ) . "\n";
	}
}
foreach ( $cases as $i => [$jsExpr, $php] ) {
	try {
		$actual = $php();
	} catch ( JsError $e ) {
		$actual = array( '$err' => $e->jsName );
	}
	$exp    = $expected[ $i ];
	$reason = is_array( $exp ) && isset( $exp['$err'] )
		? ( $actual === $exp ? null : "expected throw {$exp['$err']}, got " . json_encode( $actual, JSON_PARTIAL_OUTPUT_ON_ERROR ) )
		: ( is_array( $actual ) && isset( $actual['$err'] ) && count( $actual ) === 1 ? "threw {$actual['$err']}" : mismatch( $actual, $exp ) );
	if ( null === $reason ) {
		++$passed;
	} else {
		++$failed;
		echo "FAIL  $jsExpr\n      $reason\n";
	}
}
echo "js_parity: $passed passed, $failed failed\n";
exit( 0 === $failed ? 0 : 1 );
