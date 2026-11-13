<?php

declare(strict_types=1);

/*
 * What a real WordPress request pays to resolve "compiled schema + active runtime schema version"
 * (docs/decisions/2026-11-13-runtime-schema.md). Companion to runtime-schema-load.php, which times
 * the same loaders in isolation.
 *
 *   php docs/spikes/runtime-schema-request.php [--json]
 *
 * Boots the blog fixture on the in-process WordPress harness (tests/php/wp.php), seeds ten posts,
 * starts the harness's `php -S` and sends `GET /__first/api/v1/posts?limit=10` over loopback. A
 * must-use plugin runs one loader per request, chosen by a file the script rewrites between
 * rounds, and logs how long the loader took and how long the whole request took:
 *
 *   compiled   require the app's schema.php
 *   option     the same, plus get_option() of an autoloaded option holding the added fields, added
 *              to the compiled array (compiled keys win)
 *   file       get_option() of an autoloaded pointer, then require a generated PHP file holding the
 *              merged schema
 *
 * Rounds alternate between loaders so drift on a shared machine lands on all of them. Reported:
 * the median over all timed requests.
 */

require dirname(__DIR__, 2) . '/tests/php/wp.php';

const ROUNDS = 5;
const REQUESTS = 30;

$schema = require dirname(__DIR__, 2) . '/tests/fixtures/blog/schema.php';
$wp = wpSite('rtschema-spike', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__, 2) . '/tests/fixtures/blog/functions.php'),
    'server' => true,
    'muPlugins' => ['overlay-spike' => <<<'PHP_MU'
        <?php
        // A must-use plugin runs in the global scope: keep its variables out of it.
        (static function (): void {
            $site = dirname(__DIR__, 2);
            $mode = is_file("$site/spike-mode") ? trim((string) file_get_contents("$site/spike-mode")) : '';
            if ($mode === '') {
                return;
            }
            [$loader, $fields] = explode(':', $mode);
            $compiled = glob(WP_PLUGIN_DIR . '/first-app-*/first/app/schema.php')[0];
            // The file the loader requires: the compiled schema, or the generated merged one.
            $required = $loader === 'file' ? "$site/merged-$fields.php" : $compiled;
            $start = hrtime(true);
            if ($loader === 'compiled') {
                $loaded = require $compiled;
            } elseif ($loader === 'option') {
                $loaded = require $compiled;
                foreach ((array) get_option("first_spike_overlay_$fields", []) as $kind => $added) {
                    if (isset($loaded['collections'][$kind])) {
                        $loaded['collections'][$kind]['columns'] += $added;
                    }
                }
            } else {
                $loaded = require "$site/" . get_option("first_spike_pointer_$fields");
            }
            $took = hrtime(true) - $start;
            $columns = array_sum(array_map(static fn (array $c): int => count($c['columns']), $loaded['collections']));
            register_shutdown_function(static function () use ($site, $mode, $took, $columns, $required): void {
                $line = [$mode, $took / 1000, (microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000, $columns,
                    function_exists('opcache_is_script_cached') && opcache_is_script_cached($required)];
                file_put_contents("$site/spike.log", json_encode($line) . "\n", FILE_APPEND | LOCK_EX);
            });
        })();
        PHP_MU],
]);

for ($i = 1; $i <= 10; $i++) {
    [$status] = $wp->call('POST', '/posts', ['title' => "Post $i", 'body' => str_repeat('Body text. ', 40)], 'editor');
    $status === 201 || throw new RuntimeException("seeding post $i answered $status");
}

$compiled = require "$wp->content/plugins/first-app-blog/first/app/schema.php";
$kinds = ['authors', 'posts'];
$defs = [
    ['type' => 'text', 'rules' => ['max' => 120], 'ui' => ['label' => 'Subtitle', 'help' => 'Shown under the title']],
    ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 0]],
    ['type' => 'text', 'enum' => ['draft', 'review', 'final'], 'notNull' => true, 'default' => ['value' => 'draft']],
    ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
    ['type' => 'group', 'fields' => ['label' => ['type' => 'text'], 'href' => ['type' => 'url']]],
];
$modes = ['compiled:0'];
$baseColumns = array_sum(array_map(static fn (array $c): int => count($c['columns']), $compiled['collections']));
foreach ([1, 20, 200, 450] as $fields) {
    $overlay = [];
    for ($i = 0; $i < $fields; $i++) {
        $overlay[$kinds[$i % 2]]["runtime_field_$i"] = $defs[$i % count($defs)];
    }
    $merged = $compiled;
    foreach ($overlay as $kind => $added) {
        $merged['collections'][$kind]['columns'] += $added;
    }
    update_option("first_spike_overlay_$fields", $overlay, true);
    file_put_contents("$wp->dir/merged-$fields.php", '<?php return ' . var_export($merged, true) . ';');
    // opcache keeps a file out of the cache for opcache.file_update_protection seconds after its mtime.
    touch("$wp->dir/merged-$fields.php", time() - 60);
    update_option("first_spike_pointer_$fields", "merged-$fields.php", true);
    $modes[] = "option:$fields";
    $modes[] = "file:$fields";
}
touch("$wp->content/plugins/first-app-blog/first/app/schema.php", time() - 60);

$url = $wp->url() . '/__first/api/v1/posts?limit=10';
$get = static function () use ($url): void {
    $body = file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 30, 'ignore_errors' => true]]));
    $rows = json_decode((string) $body, true)['data'] ?? null;
    if (!is_array($rows) || count($rows) !== 10) {
        throw new RuntimeException('the request did not return ten posts: ' . substr((string) $body, 0, 300));
    }
};
foreach ($modes as $mode) {
    file_put_contents("$wp->dir/spike-mode", $mode);
    for ($i = 0; $i < 5; $i++) {
        $get();
    }
}
@unlink("$wp->dir/spike.log");
for ($round = 0; $round < ROUNDS; $round++) {
    foreach ($modes as $mode) {
        file_put_contents("$wp->dir/spike-mode", $mode);
        for ($i = 0; $i < REQUESTS; $i++) {
            $get();
        }
    }
}

$samples = [];
foreach (file("$wp->dir/spike.log", FILE_IGNORE_NEW_LINES) as $line) {
    [$mode, $loaderUs, $requestMs, $columns, $cached] = json_decode($line, true);
    $samples[$mode]['loader'][] = $loaderUs;
    $samples[$mode]['request'][] = $requestMs;
    $samples[$mode]['columns'] = $columns;
    $samples[$mode]['cached'] = $cached;
}
$median = static function (array $v): float {
    sort($v);

    return $v[intdiv(count($v), 2)];
};
$load = sys_getloadavg();
$results = ['php' => PHP_VERSION, 'wordpress' => WP_CORE_VERSION, 'database' => 'SQLite', 'server' => 'php -S (cli-server)',
    'request' => 'GET /__first/api/v1/posts?limit=10', 'requestsPerLoader' => ROUNDS * REQUESTS, 'hostLoad' => $load, 'baseColumns' => $baseColumns, 'loaders' => []];
foreach ($modes as $mode) {
    [$loader, $fields] = explode(':', $mode);
    count($samples[$mode]['request']) === ROUNDS * REQUESTS || throw new RuntimeException("$mode logged " . count($samples[$mode]['request']) . ' requests');
    $samples[$mode]['columns'] === $baseColumns + (int) $fields || throw new RuntimeException("$mode loaded {$samples[$mode]['columns']} columns");
    $results['loaders'][] = ['loader' => $loader, 'fields' => (int) $fields, 'opcache' => $samples[$mode]['cached'],
        'loaderUs' => round($median($samples[$mode]['loader']), 2), 'requestMs' => round($median($samples[$mode]['request']), 2)];
}
if (in_array('--json', $argv, true)) {
    echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
    exit;
}
printf("PHP %s, WordPress %s on SQLite, %s; %d requests per loader; load %.2f\n", PHP_VERSION, WP_CORE_VERSION, $results['server'], ROUNDS * REQUESTS, $load[0]);
printf("%-10s %-7s %-8s %12s %12s\n", 'loader', 'fields', 'opcache', 'loader µs', 'request ms');
foreach ($results['loaders'] as $r) {
    printf("%-10s %-7d %-8s %12.2f %12.2f\n", $r['loader'], $r['fields'], $r['opcache'] ? 'hit' : 'miss', $r['loaderUs'], $r['requestMs']);
}
