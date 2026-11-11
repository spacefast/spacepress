<?php

declare(strict_types=1);

/* Tiny assertion harness shared by the PHP suites. */

use First\App;

$passed = 0;
$failed = 0;

function check(string $label, bool $ok, mixed $detail = null): void
{
    global $passed, $failed;
    if ($ok) {
        $passed++;
        return;
    }
    $failed++;
    echo "FAIL  $label" . ($detail === null ? '' : "\n      " . json_encode($detail, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR)) . "\n";
}

function eq(string $label, mixed $actual, mixed $expected): void
{
    check($label, $actual === $expected, ['expected' => $expected, 'actual' => $actual]);
}

/** Run $fn, expect an HttpError (or JsError) with the given status/code/pointer. */
function problem(string $label, callable $fn, int $status, string $code, ?string $pointer = null): ?\Throwable
{
    try {
        $fn();
    } catch (\Throwable $e) {
        $p = App::problem($e);
        check($label, $p['status'] === $status && $p['code'] === $code && ($p['pointer'] ?? null) === $pointer,
            ['problem' => $p, 'exception' => $e::class . ': ' . $e->getMessage()]);

        return $e;
    }
    check($label, false, 'no exception thrown');

    return null;
}

function finish(string $suite): never
{
    global $passed, $failed;
    echo "$suite: $passed passed, $failed failed\n";
    exit($failed === 0 ? 0 : 1);
}
