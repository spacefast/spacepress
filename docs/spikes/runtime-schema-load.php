<?php

declare(strict_types=1);

/*
 * How much a request pays to load "the compiled schema plus the site's active runtime schema
 * version", for each way of storing the active version (docs/decisions/2026-11-13-runtime-schema.md).
 *
 *   php -d opcache.enable_cli=1 -d opcache.file_update_protection=0 docs/spikes/runtime-schema-load.php [--json]
 *
 * The compiled schema is tests/fixtures/phase2.schema.json written the way `typedpress build` writes
 * schema.php (one PHP array literal). An overlay of N fields is spread over the schema's
 * post-backed collections. Every variant ends with the same array, checked before timing.
 *
 *   compiled     require schema.php (today's request)
 *   file         require a generated PHP file holding the merged schema
 *   option-full  unserialize the whole merged schema (an autoloaded option, or an object-cache value)
 *   option-delta require schema.php, unserialize only the added fields, add them to the array
 *   json-delta   the same with the fields stored as JSON
 *
 * Each sample is the median of 7 rounds of 500 loads, in microseconds per load. Run it with and
 * without opcache: `file` and `compiled` depend on it, the option variants do not.
 */

$repo = dirname(__DIR__, 2);
$compiled = json_decode((string) file_get_contents("$repo/tests/fixtures/phase2.schema.json"), true, 512, JSON_THROW_ON_ERROR);
$dir = sys_get_temp_dir() . '/typedpress-rtschema-' . bin2hex(random_bytes(4));
mkdir($dir);
register_shutdown_function(static function () use ($dir): void {
    array_map('unlink', glob("$dir/*") ?: []);
    rmdir($dir);
});
$write = static function (string $name, array $schema) use ($dir): string {
    file_put_contents("$dir/$name", '<?php return ' . var_export($schema, true) . ';');

    return "$dir/$name";
};
$compiledFile = $write('schema.php', $compiled);

$kinds = array_keys(array_filter($compiled['collections'], static fn (array $c): bool => ($c['wp'] ?? null) !== null));
$fieldTypes = [
    ['type' => 'text', 'rules' => ['max' => 120], 'ui' => ['label' => 'Subtitle', 'help' => 'Shown under the title']],
    ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 0]],
    ['type' => 'text', 'enum' => ['draft', 'review', 'final'], 'notNull' => true, 'default' => ['value' => 'draft']],
    ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
    ['type' => 'group', 'fields' => ['label' => ['type' => 'text'], 'href' => ['type' => 'url']]],
];
/** @return array<string, array<string, array>> kind => added fields */
$overlay = static function (int $fields) use ($kinds, $fieldTypes): array {
    $out = [];
    for ($i = 0; $i < $fields; $i++) {
        $out[$kinds[$i % count($kinds)]]["runtime_field_$i"] = $fieldTypes[$i % count($fieldTypes)];
    }

    return $out;
};
$merge = static function (array $schema, array $delta): array {
    foreach ($delta as $kind => $fields) {
        if (isset($schema['collections'][$kind])) {
            $schema['collections'][$kind]['columns'] += $fields;
        }
    }

    return $schema;
};
$time = static function (callable $fn): float {
    $rounds = [];
    for ($r = 0; $r < 7; $r++) {
        $start = hrtime(true);
        for ($i = 0; $i < 500; $i++) {
            $fn();
        }
        $rounds[] = (hrtime(true) - $start) / 500 / 1000;
    }
    sort($rounds);

    return round($rounds[3], 2);
};

$results = [
    'php' => PHP_VERSION,
    'opcache' => function_exists('opcache_get_status') && (opcache_get_status(false)['opcache_enabled'] ?? false),
    'compiledBytes' => filesize($compiledFile),
    'kinds' => count($compiled['collections']),
    'postKinds' => count($kinds),
    'unit' => 'microseconds per load, median of 7 rounds of 500',
    'runs' => [],
];
foreach ([0, 1, 20, 200, 450] as $fields) {
    $delta = $overlay($fields);
    $merged = $merge($compiled, $delta);
    $mergedFile = $write("merged-$fields.php", $merged);
    $full = serialize($merged);
    $serializedDelta = serialize($delta);
    $jsonDelta = json_encode($delta, JSON_THROW_ON_ERROR);
    $variants = [
        'compiled' => static fn (): array => require $compiledFile,
        'file' => static fn (): array => require $mergedFile,
        'option-full' => static fn (): array => unserialize($full),
        'option-delta' => static fn (): array => $merge(require $compiledFile, unserialize($serializedDelta)),
        'json-delta' => static fn (): array => $merge(require $compiledFile, json_decode($jsonDelta, true)),
    ];
    $run = ['fields' => $fields, 'deltaBytes' => strlen($serializedDelta), 'mergedBytes' => strlen($full), 'us' => []];
    foreach ($variants as $name => $fn) {
        if ($name !== 'compiled' && $fn() !== $merged) {
            fwrite(STDERR, "variant $name does not produce the merged schema\n");
            exit(1);
        }
        $run['us'][$name] = $time($fn);
    }
    $results['runs'][] = $run;
}

if (in_array('--json', $argv, true)) {
    echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
    exit;
}
printf("PHP %s, opcache %s, schema.php %d bytes, %d kinds (%d post-backed)\n", $results['php'], $results['opcache'] ? 'on' : 'off', $results['compiledBytes'], $results['kinds'], $results['postKinds']);
printf("%-8s %-12s %10s %10s %12s %13s %11s\n", 'fields', 'delta bytes', 'compiled', 'file', 'option-full', 'option-delta', 'json-delta');
foreach ($results['runs'] as $run) {
    printf("%-8d %-12d %10.2f %10.2f %12.2f %13.2f %11.2f\n", $run['fields'], $run['deltaBytes'], ...array_values($run['us']));
}
