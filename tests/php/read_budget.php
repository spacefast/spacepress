<?php

declare(strict_types=1);

/*
 * What a request reads, counted on a built example served by WordPress-on-SQLite with a warm
 * persistent object cache (tests/read_budget.rs builds drive-store, www and the shop, runs this once
 * for each and holds every route to a budget).
 *
 *   TP_WP_THEMES=1 php tests/php/read_budget.php <app> <wp-content dir> [seed records dir]
 *
 * <app> is `drive-store`, `www`, `shop`, or `shop-24`: the shop with 22 more products, so its
 * catalog shows a full page of 24.
 *
 * Prints one JSON object: for each route and visitor (anonymous, and a signed-in subscriber)
 *   sql    $wpdb->num_queries + the statements TypedPress sent through Wp\Connection::run, which
 *          never reach $wpdb. Counted from the first hook of the request to its last shutdown function.
 *   files  count(get_included_files()) at the same point (about 35 of them are this harness's).
 *   trips  object-cache round trips: single-key gets of a key the request did not hold yet, plus
 *          multi-key gets (tests/php/fixtures/object-cache.php).
 *   rows   for an API list, the rows it answered with.
 *   body   SHA-256 of the response body.
 * Each count is the median of three requests, after two that warm the caches; the three bodies must
 * be the same. `cold` is `sql` with no persistent object cache (WordPress's default, one request
 * long), and the script fails when a route's body differs between the two: what a cache holds must
 * never change a page. TP_READ_BUDGET_TRACE=1 adds every statement and cache get, with its caller.
 */

require __DIR__ . '/wp.php';

const BUDGET_PLUGIN = <<<'PLUGIN'
    <?php
    if (isset($_SERVER['HTTP_X_TP_READ_BUDGET'])) {
        $direct = [];
        if (isset($_SERVER['HTTP_X_TP_READ_BUDGET_TRACE'])) {
            define('SAVEQUERIES', true);
        }
        add_action('plugins_loaded', static function () use (&$direct): void {
            \TypedPress\Wp\Connection::$observer = static function (string $sql) use (&$direct): void {
                $direct[] = isset($_SERVER['HTTP_X_TP_READ_BUDGET_TRACE']) ? [$sql, wp_debug_backtrace_summary(null, 2)] : [$sql, ''];
            };
        }, PHP_INT_MIN);
        // Registered from a shutdown function, so it runs after every other one of this request.
        register_shutdown_function(static function () use (&$direct): void {
            register_shutdown_function(static function () use (&$direct): void {
            global $wpdb, $wp_object_cache;
            $trace = isset($_SERVER['HTTP_X_TP_READ_BUDGET_TRACE']);
            $short = static fn (string $sql): string => substr((string) preg_replace('/\s+/', ' ', $sql), 0, 240);
            file_put_contents(WP_CONTENT_DIR . '/read-budget.json', json_encode([
                'sample' => $_SERVER['HTTP_X_TP_READ_BUDGET'],
                'user' => get_current_user_id(),
                'wpdb' => (int) $wpdb->num_queries,
                'direct' => count($direct),
                'files' => count(get_included_files()),
                'trips' => $wp_object_cache->trips ?? null,
                'statements' => !$trace ? null : [
                    ...array_map(static fn (array $q): string => 'wpdb: ' . $short((string) $q[0]) . ' <- ' . substr((string) $q[2], -600), $wpdb->queries ?? []),
                    ...array_map(static fn (array $q): string => 'typedpress: ' . $short($q[0]) . ' <- ' . substr($q[1], -600), $direct),
                ],
            ], JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
            });
        });
    }
    PLUGIN;

[, $app, $content] = $argv;
$site = wpSite("read-budget-$app", ['wpContent' => $content, 'users' => ['ann' => 'subscriber'], 'muPlugins' => ['read-budget' => BUDGET_PLUGIN]]);
wp_set_current_user(1);
if (isset($argv[3])) {
    \TypedPress\Sync\Seed::run(\TypedPress\Wp\Runtime::plugin(), $argv[3]);
}
// Action Scheduler runs a hybrid store until its one-off migration action has run, which costs
// every request extra statements. The harness has no cron to run it, so mark it done, as the action
// does on a site with nothing to migrate.
if (class_exists(ActionScheduler_DataController::class)) {
    ActionScheduler_DataController::mark_migration_complete();
}
$api = static fn (string $path): string => (string) substr(\TypedPress\Wp\Facade::url($path), strlen(home_url()));
$routes = match ($app) {
    'drive-store' => ['catalog' => '/', 'product' => '/drives/wd-red-plus-4tb/', 'api-list' => $api('/drives?limit=24')],
    'www' => ['doc' => '/docs/introduction/', 'route-handler' => '/api/examples.json', 'api-list' => $api('/docs?limit=24')],
    'shop', 'shop-24' => ['catalog' => '/shop/', 'product' => '/products/ceramic-mug/'],
};
if ($app === 'shop-24') {
    // The shop seeds itself on its first request (two products).
    $site->startServer();
    file_get_contents($site->url() . '/shop/');
    for ($n = 3; $n <= 24; $n++) {
        $product = new WC_Product_Simple();
        $product->set_name("Budget mug $n");
        $product->set_regular_price('24.00');
        $product->set_status('publish');
        $product->save();
    }
}
// The browser's sign-in: the logged-in cookie, and for the API the REST nonce that goes with it.
$ann = $site->userId('ann');
$expires = time() + DAY_IN_SECONDS;
$cookie = wp_generate_auth_cookie($ann, $expires, 'logged_in', WP_Session_Tokens::get_instance($ann)->create($expires));
$_COOKIE[LOGGED_IN_COOKIE] = $cookie;
wp_set_current_user($ann);
$nonce = wp_create_nonce('wp_rest');
unset($_COOKIE[LOGGED_IN_COOKIE]);
$site->actAs(null);
$visitors = ['anonymous' => [], 'signed-in' => ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($cookie), "X-WP-Nonce: $nonce"]];
$site->startServer();

function fetch(string $url, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_HTTPHEADER => $headers]);
    $body = (string) curl_exec($ch);

    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $body];
}

/** @return array{sql: int, wpdb: int, direct: int, files: int, trips: ?array, user: int, body: string, bytes: int, rows: ?int, statements: ?list<string>} */
$sample = static function (string $name, string $path, array $headers, bool $trace = false) use ($site): array {
    [$status, $body] = fetch($site->url() . $path, [...$headers, "X-TP-Read-Budget: $name", ...($trace ? ['X-TP-Read-Budget-Trace: 1'] : [])]);
    if ($status !== 200) {
        throw new RuntimeException("$name answered $status:\n" . substr($body, 0, 2000));
    }
    $seen = json_decode((string) file_get_contents($site->content . '/read-budget.json'), true, 512, JSON_THROW_ON_ERROR);
    if ($seen['sample'] !== $name) {
        throw new RuntimeException("no counts for $name");
    }
    // A <Live> region's seed is sealed with a fresh nonce on every render: the one part of a page
    // that differs between two requests for it.
    $body = (string) preg_replace('/(&quot;token&quot;:&quot;)[A-Za-z0-9_-]+(&quot;)/', '$1…$2', $body);
    $list = str_contains($name, 'api-list') ? json_decode($body, true)['data'] ?? null : null;

    return ['sql' => $seen['wpdb'] + $seen['direct'], 'body' => hash('sha256', $body), 'bytes' => strlen($body), 'rows' => is_array($list) ? count($list) : null] + $seen;
};
$median = static function (array $values): mixed {
    sort($values);

    return $values[intdiv(count($values), 2)];
};
$measure = static function (bool $trace) use ($routes, $visitors, $sample, $median, $ann): array {
    $out = [];
    foreach ($routes as $route => $path) {
        foreach ($visitors as $who => $headers) {
            $name = "$route/$who";
            $sample("$name/warm-1", $path, $headers);
            $sample("$name/warm-2", $path, $headers);
            $runs = [];
            for ($i = 0; $i < 3; $i++) {
                $runs[] = $sample("$name/$i", $path, $headers, $trace);
            }
            if (count(array_unique(array_column($runs, 'body'))) !== 1) {
                throw new RuntimeException("$name answered different bodies to the same request");
            }
            if ($runs[0]['user'] !== ($who === 'anonymous' ? 0 : $ann)) {
                throw new RuntimeException("$name ran as user {$runs[0]['user']}");
            }
            $trips = array_map(static fn (array $r): ?int => $r['trips'] === null ? null : $r['trips']['single'] + $r['trips']['multi'], $runs);
            $out[$name] = ['sql' => $median(array_column($runs, 'sql')), 'wpdb' => $median(array_column($runs, 'wpdb')), 'typedpress' => $median(array_column($runs, 'direct')),
                'files' => $median(array_column($runs, 'files')), 'trips' => $median($trips), 'rows' => $runs[0]['rows'], 'body' => $runs[0]['body'], 'bytes' => $runs[0]['bytes']]
                + ($trace ? ['statements' => $runs[0]['statements'], 'gets' => $runs[0]['trips']['log'] ?? []] : []);
        }
    }

    return $out;
};

$trace = getenv('TP_READ_BUDGET_TRACE') === '1';
$cold = $measure(false);
copy(__DIR__ . '/fixtures/object-cache.php', $site->content . '/object-cache.php');
$warm = $measure($trace);
$report = [];
foreach ($warm as $name => $counts) {
    if ($counts['body'] !== $cold[$name]['body']) {
        throw new RuntimeException("$name answers differently with a persistent object cache than without one");
    }
    $report[$name] = ['cold' => $cold[$name]['sql']] + $counts;
}
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
