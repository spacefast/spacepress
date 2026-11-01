<?php

// Usage: php run-php.php <runtime plugin dir> <app plugin dir> <case> <args-json>
// Calls one compiled function from <app>/zero/app/functions.php the way the runtime does
// (§2 calling conventions) and prints {"data": ...} or {"error": message}, like run-node.mjs.
// Pure PHP: the runtime's bootstrap and the compiled functions, no WordPress and no store.

declare(strict_types=1);

[, $runtime, $root, $case, $argsJson] = $argv;
require $runtime . '/zero/bootstrap.php';
$schema = require $root . '/zero/app/schema.php';
require_once $root . '/zero/app/functions.php';
$args = json_decode($argsJson, true, 512, JSON_THROW_ON_ERROR);
$parts = explode(':', $case);
try {
    $data = match ($parts[0]) {
        'access' => (function () use ($schema, $parts, $args) {
            $ctx = $args['ctx'] + ['data' => null];
            $ctx['op'] = $parts[2];
            $fn = '\\ZeroApp\\' . $schema['collections'][$parts[1]]['access'][$parts[2]]['fn'];

            return $fn($ctx);
        })(),
        'field' => (function () use ($schema, $parts, $args) {
            $ctx = $args['ctx'];
            $ctx['op'] = $parts[3];
            $fn = '\\ZeroApp\\' . $schema['collections'][$parts[1]]['columns'][$parts[2]]['access'][$parts[3]]['fn'];

            return $fn($ctx);
        })(),
        'validate' => (function () use ($schema, $parts, $args) {
            $fn = '\\ZeroApp\\' . $schema['collections'][$parts[1]]['columns'][$parts[2]]['rules']['validate'];
            $value = $args['value'];

            return $fn($value, $args['ctx']);
        })(),
        default => throw new \LogicException("unknown case $case"),
    };
    echo \Zero\Js::jsonStringify(['data' => $data]), "\n";
} catch (\Throwable $e) {
    echo \Zero\Js::jsonStringify(['error' => $e->getMessage()]), "\n";
}
