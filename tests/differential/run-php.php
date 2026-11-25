<?php

// Usage: php run-php.php <runtime plugin dir> <app plugin dir> <case> <args-json>
// Calls one compiled function from <app>/sp/app/functions.php the way the runtime does
// (§2 calling conventions) and prints {"data": ...} or {"error": message}, like run-node.mjs.
// Pure PHP: the runtime's bootstrap and the compiled functions, no WordPress and no store.

declare(strict_types=1);

[, $runtime, $root, $case, $argsJson] = $argv;
require $runtime . '/sp/bootstrap.php';
$schema = require $root . '/sp/app/schema.php';
require_once $root . '/sp/app/functions.php';
$args = json_decode($argsJson, true, 512, JSON_THROW_ON_ERROR);
$parts = explode(':', $case);
try {
    $data = match ($parts[0]) {
        'access' => (function () use ($schema, $parts, $args) {
            $ctx = $args['ctx'] + ['data' => null];
            $ctx['op'] = $parts[2];
            $fn = '\\SpacePressApp\\' . $schema['collections'][$parts[1]]['access'][$parts[2]]['fn'];

            return $fn(\SpacePress\Seam::ctx($ctx, $schema['collections'][$parts[1]]['columns']));
        })(),
        'field' => (function () use ($schema, $parts, $args) {
            $ctx = $args['ctx'];
            $ctx['op'] = $parts[3];
            $fn = '\\SpacePressApp\\' . $schema['collections'][$parts[1]]['columns'][$parts[2]]['access'][$parts[3]]['fn'];

            return $fn(\SpacePress\Seam::ctx($ctx, $schema['collections'][$parts[1]]['columns']));
        })(),
        'validate' => (function () use ($schema, $parts, $args) {
            $columns = $schema['collections'][$parts[1]]['columns'];
            $keys = explode('.', $parts[2]);
            $path = [array_shift($keys)];
            $col = $columns[$path[0]];
            while ($keys !== []) {
                if ($col['type'] === 'repeater') { $path[] = 0; }
                if ($col['type'] === 'blocks') {
                    $path[] = 0;
                    $fields = $col['layouts'][array_shift($keys)];
                } else { $fields = $col['fields']; }
                $key = array_shift($keys);
                $path[] = $key;
                $col = $fields[$key];
            }
            $fn = '\\SpacePressApp\\' . $col['rules']['validate'];
            $ctx = $args['ctx'];
            $container = &$ctx['data'];
            foreach (array_slice($path, 0, -1) as $key) { $container = &$container[$key]; }
            $container[$path[array_key_last($path)]] = $args['value'];
            unset($container);
            $ctx = \SpacePress\Seam::ctx($ctx, $columns);
            $value = $ctx->p['data'];
            foreach ($path as $key) { $value = \SpacePress\Seam::container($value)[$key]; }
            return $fn($value, $ctx);
        })(),
        default => throw new \LogicException("unknown case $case"),
    };
    echo \SpacePress\Response::json($data)->http()[2], "\n";
} catch (\Throwable $e) {
    echo \SpacePress\Js::jsonStringify(['error' => $e->getMessage()]), "\n";
}
