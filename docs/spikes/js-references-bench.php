<?php

declare(strict_types=1);

// Representation microbenchmark for docs/design-js-references.md §6: a handle class holding a PHP
// array versus the plain array the compiler emits today, versus stdClass and ArrayObject, plus
// today's JSON decode walk versus a handle-building walk. Run under each PHP on the box:
//   php8.3 -d memory_limit=-1 docs/spikes/js-references-bench.php
//   php    -d memory_limit=-1 docs/spikes/js-references-bench.php
// Numbers vary by box; compare ratios, not absolutes. This measures representations, not the
// runtime pipeline (Seam traversals, callback boxing, key ordering are not here).

final class JsObject
{
    public function __construct(public array $p = []) {}
}

final class JsArray
{
    public function __construct(public array $a = []) {}
}

final class Marker extends stdClass {}

function objLit(array ...$parts): JsObject
{
    $o = new JsObject();
    foreach ($parts as $p) {
        foreach ($p as $k => $v) {
            $o->p[$k] = $v;
        }
    }

    return $o;
}

function mapH(JsArray $a, callable $f): JsArray
{
    $out = [];
    $len = count($a->a);
    for ($i = 0; $i < $len; $i++) {
        $out[] = $i < count($a->a) ? $f($a->a[$i], $i, $a) : null;
    }

    return new JsArray($out);
}

function filterH(JsArray $a, callable $f): JsArray
{
    $out = [];
    $len = count($a->a);
    for ($i = 0; $i < $len; $i++) {
        if ($i < count($a->a) && $f($a->a[$i], $i, $a)) {
            $out[] = $a->a[$i];
        }
    }

    return new JsArray($out);
}

function mapP(array $a, callable $f): array
{
    $out = [];
    foreach ($a as $i => $v) {
        $out[] = $f($v, $i);
    }

    return $out;
}

function filterP(array $a, callable $f): array
{
    $out = [];
    foreach ($a as $i => $v) {
        if ($f($v, $i)) {
            $out[] = $v;
        }
    }

    return $out;
}

function encodeH(mixed $v): string
{
    if ($v instanceof JsArray) {
        return '[' . implode(',', array_map('encodeH', $v->a)) . ']';
    }
    if ($v instanceof JsObject) {
        $parts = [];
        foreach ($v->p as $k => $x) {
            $parts[] = json_encode((string) $k) . ':' . encodeH($x);
        }

        return '{' . implode(',', $parts) . '}';
    }

    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function encodeP(mixed $v): string
{
    if (is_array($v)) {
        if (array_is_list($v) && $v !== []) {
            return '[' . implode(',', array_map('encodeP', $v)) . ']';
        }
        $parts = [];
        foreach ($v as $k => $x) {
            $parts[] = json_encode((string) $k) . ':' . encodeP($x);
        }

        return '{' . implode(',', $parts) . '}';
    }

    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

/** Today's Js::fromJson: stdClass → assoc array, `{}` → marker. */
function fromJsonToday(mixed $v): mixed
{
    if ($v instanceof stdClass) {
        $vars = get_object_vars($v);
        if ($vars === []) {
            return new Marker();
        }
        foreach ($vars as $k => $x) {
            $vars[$k] = fromJsonToday($x);
        }

        return $vars;
    }
    if (is_array($v)) {
        foreach ($v as $k => $x) {
            if (is_array($x) || $x instanceof stdClass) {
                $v[$k] = fromJsonToday($x);
            }
        }
    }

    return $v;
}

function fromJsonHandle(mixed $v): mixed
{
    if ($v instanceof stdClass) {
        $o = new JsObject();
        foreach (get_object_vars($v) as $k => $x) {
            $o->p[$k] = fromJsonHandle($x);
        }

        return $o;
    }
    if (is_array($v)) {
        $out = [];
        foreach ($v as $x) {
            $out[] = fromJsonHandle($x);
        }

        return new JsArray($out);
    }

    return $v;
}

function setP(JsObject $o, string $k, mixed $v): mixed
{
    return $o->p[$k] = $v;
}

function bench(string $name, int $iters, callable $f): array
{
    $f();
    $t = hrtime(true);
    for ($i = 0; $i < $iters; $i++) {
        $f();
    }

    return [$name, (hrtime(true) - $t) / 1e6 / $iters];
}

$N = 100_000;
$rows = [];
for ($i = 0; $i < $N; $i++) {
    $rows[] = ['id' => $i, 'name' => "row $i", 'tags' => ['a', 'b', 'c'], 'meta' => ['a' => $i, 'b' => true]];
}
$hrows = fromJsonHandle(json_decode(json_encode($rows)));
$json = json_encode($rows);
$small = json_encode(array_slice($rows, 0, 140)); // about 10 KB
$groups = [];

$groups[] = [
    bench('build plain', 5, function () use ($N) { $r = []; for ($i = 0; $i < $N; $i++) { $r[] = ['id' => $i, 'name' => "row $i", 'tags' => ['a', 'b', 'c'], 'meta' => ['a' => $i, 'b' => true]]; } }),
    bench('build handle (constructor)', 5, function () use ($N) { $r = new JsArray(); for ($i = 0; $i < $N; $i++) { $r->a[] = new JsObject(['id' => $i, 'name' => "row $i", 'tags' => new JsArray(['a', 'b', 'c']), 'meta' => new JsObject(['a' => $i, 'b' => true])]); } }),
    bench('build handle (objLit variadic)', 5, function () use ($N) { $r = new JsArray(); for ($i = 0; $i < $N; $i++) { $r->a[] = objLit(['id' => $i, 'name' => "row $i", 'tags' => new JsArray(['a', 'b', 'c']), 'meta' => objLit(['a' => $i, 'b' => true])]); } }),
    bench('build stdClass', 5, function () use ($N) { $r = []; for ($i = 0; $i < $N; $i++) { $r[] = (object) ['id' => $i, 'name' => "row $i", 'tags' => ['a', 'b', 'c'], 'meta' => (object) ['a' => $i, 'b' => true]]; } }),
    bench('build ArrayObject', 5, function () use ($N) { $r = []; for ($i = 0; $i < $N; $i++) { $r[] = new ArrayObject(['id' => $i, 'name' => "row $i", 'tags' => new ArrayObject(['a', 'b', 'c']), 'meta' => new ArrayObject(['a' => $i, 'b' => true])]); } }),
];

$M = 1_000_000;
$po = ['x' => 0, 'y' => 1];
$ho = new JsObject(['x' => 0, 'y' => 1]);
$so = (object) ['x' => 0, 'y' => 1];
$ao = new ArrayObject(['x' => 0, 'y' => 1]);
$groups[] = [
    bench('rw plain $o[x]', 3, function () use (&$po, $M) { for ($i = 0; $i < $M; $i++) { $po['x'] = $po['y'] + $i; } }),
    bench('rw handle $o->p[x]', 3, function () use ($ho, $M) { for ($i = 0; $i < $M; $i++) { $ho->p['x'] = $ho->p['y'] + $i; } }),
    bench('rw stdClass $o->x', 3, function () use ($so, $M) { for ($i = 0; $i < $M; $i++) { $so->x = $so->y + $i; } }),
    bench('rw ArrayObject $o[x]', 3, function () use ($ao, $M) { for ($i = 0; $i < $M; $i++) { $ao['x'] = $ao['y'] + $i; } }),
];

$pn = ['meta' => ['a' => 0]];
$hn = new JsObject(['meta' => new JsObject(['a' => 0])]);
$groups[] = [
    bench('nested write plain', 3, function () use (&$pn, $M) { for ($i = 0; $i < $M; $i++) { $pn['meta']['a'] = $i; } }),
    bench('nested write handle, direct', 3, function () use ($hn, $M) { for ($i = 0; $i < $M; $i++) { $hn->p['meta']->p['a'] = $i; } }),
    bench('nested write handle, receiver temp statement', 3, function () use ($hn, $M) { for ($i = 0; $i < $M; $i++) { $r = $hn->p['meta']; $r->p['a'] = $i; } }),
    bench('nested write handle, Js::set helper (expression)', 3, function () use ($hn, $M) { for ($i = 0; $i < $M; $i++) { setP($hn->p['meta'], 'a', $i); } }),
    bench('nested write handle, [R=.., write][1] form', 3, function () use ($hn, $M) { for ($i = 0; $i < $M; $i++) { [$r = $hn->p['meta'], $r->p['a'] = $i][1]; } }),
];

$ints = range(0, $N - 1);
$hints = new JsArray($ints);
$groups[] = [
    bench('map+filter ints plain', 5, fn () => filterP(mapP($ints, fn ($v) => $v * 2), fn ($v) => $v % 3 === 0)),
    bench('map+filter ints handle (live length)', 5, fn () => filterH(mapH($hints, fn ($v) => $v * 2), fn ($v) => $v % 3 === 0)),
    bench('map rows->name plain', 5, fn () => mapP($rows, fn ($r) => $r['name'])),
    bench('map rows->name handle', 5, fn () => mapH($hrows, fn ($r) => $r->p['name'])),
];

$groups[] = [
    bench('json encode plain (runtime-style encoder)', 3, fn () => encodeP($rows)),
    bench('json encode handle (runtime-style encoder)', 3, fn () => encodeH($hrows)),
    bench('json encode plain (native json_encode)', 3, fn () => json_encode($rows)),
    bench('json decode 100k rows, today (fromJson walk)', 3, fn () => fromJsonToday(json_decode($json, false))),
    bench('json decode 100k rows, handles', 3, fn () => fromJsonHandle(json_decode($json, false))),
    bench('json decode 10 KB body, today', 2000, fn () => fromJsonToday(json_decode($small, false))),
    bench('json decode 10 KB body, handles', 2000, fn () => fromJsonHandle(json_decode($small, false))),
];

$groups[] = [
    bench('for-of plain foreach', 5, function () use ($ints) { $s = 0; foreach ($ints as $v) { $s += $v; } return $s; }),
    bench('for-of handle foreach ->a', 5, function () use ($hints) { $s = 0; foreach ($hints->a as $v) { $s += $v; } return $s; }),
    bench('for-of handle index loop, live length', 5, function () use ($hints) { $s = 0; for ($i = 0; $i < count($hints->a); $i++) { $s += $hints->a[$i]; } return $s; }),
];

printf("PHP %s, 10 KB body is %d bytes\n%-48s %12s\n", PHP_VERSION, strlen($small), 'case', 'ms/iter');
foreach ($groups as $group) {
    foreach ($group as [$name, $ms]) {
        printf("%-48s %12.3f\n", $name, $ms);
    }
    echo "\n";
}

gc_collect_cycles();
$base = memory_get_usage();
$p = [];
for ($i = 0; $i < $N; $i++) {
    $p[] = ['id' => $i, 'name' => "row $i", 'tags' => ['a', 'b', 'c'], 'meta' => ['a' => $i, 'b' => true]];
}
$plainMem = memory_get_usage() - $base;
unset($p);
gc_collect_cycles();
$base = memory_get_usage();
$h = new JsArray();
for ($i = 0; $i < $N; $i++) {
    $h->a[] = new JsObject(['id' => $i, 'name' => "row $i", 'tags' => new JsArray(['a', 'b', 'c']), 'meta' => new JsObject(['a' => $i, 'b' => true])]);
}
$handleMem = memory_get_usage() - $base;
unset($h);
gc_collect_cycles();
$base = memory_get_usage();
$s = [];
for ($i = 0; $i < $N; $i++) {
    $s[] = (object) ['id' => $i, 'name' => "row $i", 'tags' => ['a', 'b', 'c'], 'meta' => (object) ['a' => $i, 'b' => true]];
}
$stdMem = memory_get_usage() - $base;
printf("memory 100k rows: plain %.1f MB, handle %.1f MB (+%.0f bytes/row, 3 handles per row), stdClass %.1f MB\n",
    $plainMem / 1048576, $handleMem / 1048576, ($handleMem - $plainMem) / $N, $stdMem / 1048576);
