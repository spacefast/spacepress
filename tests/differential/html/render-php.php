<?php

// Usage: php render-php.php <runtime plugin dir> <app plugin dir> <cases.json>
// Calls each compiled component the way a page will (props decoded as JSON, the result placed
// with \First\Html::child) and prints {"<index>": {"html": …} | {"error": message}}, like
// render-node.mjs. Pure PHP: the runtime's bootstrap and the compiled functions, no WordPress.

declare(strict_types=1);

[, $runtime, $root, $casesFile] = $argv;
require $runtime . '/first/bootstrap.php';
$schema = require $root . '/first/app/schema.php';
require_once $root . '/first/app/functions.php';
$out = [];
foreach (json_decode((string) file_get_contents($casesFile), true, 512, JSON_THROW_ON_ERROR) as $index => $case) {
    try {
        $fn = '\\FirstApp\\' . $schema['components'][$case['component']];
        // JSON_FORCE_OBJECT would also turn arrays inside the props into objects; `(object)` keeps them.
        $props = \First\Js::jsonParse(json_encode((object) $case['props'], JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION));
        $out[(string) $index] = ['html' => \First\Html::child(\First\Html::component($fn(...), $props))];
    } catch (\Throwable $e) {
        $out[(string) $index] = ['error' => $e->getMessage()];
    }
}
echo json_encode($out, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_FORCE_OBJECT), "\n";
