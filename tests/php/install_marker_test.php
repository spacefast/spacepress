<?php

declare(strict_types=1);

/*
 * The install marker (First\Wp\InstallMarker) on WordPress on SQLite, over HTTP through php -S: once
 * a request has found everything this build installs in place, the next requests run none of the
 * install checks (the ledger read, the system-tables, stored-name, search and Action Scheduler
 * checks), and whatever changes what those checks cover makes the next request check again. A
 * failed install is never hidden by it.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// Each request's statements, as First's connection and $wpdb see them, written where this process
// can read them back (a must-use plugin loaded before First on every request the server answers).
$log = sys_get_temp_dir() . '/first-install-marker-' . bin2hex(random_bytes(4)) . '.log';
$logFile = var_export($log, true);
$wp = wpSite('install-marker', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'muPlugins' => ['statements' => <<<PHP
        <?php
        if (isset(\$_SERVER['HTTP_X_STATEMENTS'])) {
            \$GLOBALS['first_statements'] = [];
            add_filter('query', static function (string \$sql): string { \$GLOBALS['first_statements'][] = \$sql; return \$sql; });
            add_action('plugins_loaded', static function (): void {
                if (class_exists(\\First\\Wp\\Connection::class) && property_exists(\\First\\Wp\\Connection::class, "observer")) {
                    \\First\\Wp\\Connection::\$observer = static function (string \$sql): void { \$GLOBALS['first_statements'][] = \$sql; };
                }
            }, 0);
            register_shutdown_function(static fn () => file_put_contents($logFile, json_encode(\$GLOBALS['first_statements'])));
        }
        PHP],
]);
register_shutdown_function(static fn () => @unlink($log));
$url = 'http://127.0.0.1:' . $wp->startServer();

/** The statements one GET ran, and its status. @return array{int, list<string>} */
function request(string $url, string $path): array
{
    global $log;
    @unlink($log);
    $ch = curl_init($url . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => ['X-Statements: 1']]);
    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    clearstatcache();

    return [$status, json_decode((string) @file_get_contents($log), true) ?? []];
}

/** The install checks among a request's statements, by what they look for. */
function checks(array $statements): array
{
    $found = [];
    foreach ($statements as $sql) {
        foreach ([
            'ledger' => 'information_schema.COLUMNS',
            'schema hash' => "option_name = 'first_blog_schema'",
            'system tables' => "option_name = 'first_runtime_tables'",
            'stored names' => "option_name = 'first_zero_names'",
            'search table' => 'first__search` LIMIT 1',
            'search shape' => "option_name = 'first_search_shape'",
            'scheduled actions' => "a.hook='first_jobs_maintain'",
        ] as $name => $needle) {
            if (str_contains($sql, $needle)) {
                $found[$name] = true;
            }
        }
    }
    ksort($found);

    return array_keys($found);
}

$marker = static function () use ($wp): mixed {
    $row = $wp->sql("SELECT option_value AS v, autoload AS a FROM {prefix}options WHERE option_name = 'first_installed'")[0] ?? null;

    return $row === null ? null : [$row['a'], (string) $row['v']];
};

// ---- the first request records it, the next ones skip every check -----------------------------------
// This process loaded the installed site too (and recorded the marker as any request would): start over.
\First\Wp\InstallMarker::forget();
eq('no marker to begin with', $marker(), null);
[$status, $first] = request($url, '/');
check('a request with no marker runs the install checks', $status === 200 && in_array('ledger', checks($first), true) && in_array('system tables', checks($first), true), [$status, checks($first)]);
check('the request that found everything installed records the marker, autoloaded', in_array($marker()[0] ?? null, ['yes', 'on', 'auto-on'], true), $marker());
[$status, $next] = request($url, '/');
eq('with the marker, a request runs none of the install checks', [$status, checks($next)], [200, []]);
check('and fewer statements in all', count($next) < count($first), [count($first), count($next)]);
[$status, $api] = request($url, '/__first/api/v1/posts');
eq('an API read runs none of them either', [$status, checks($api)], [200, []]);

// ---- what drops it -----------------------------------------------------------------------------------
$recheck = static function (string $label, callable $change, bool $dropped = true) use ($url, $marker): void {
    $before = $marker();
    $change();
    wp_cache_flush();
    if ($dropped) {
        eq("$label: the marker is gone", $marker(), null);
    }
    [$status, $statements] = request($url, '/');
    check("$label: the next request checks again", $status === 200 && in_array('ledger', checks($statements), true), checks($statements));
    check("$label: and records the marker again", $marker() !== null && ($dropped || $marker() !== $before), [$before, $marker()]);
};
// A new build isn't announced to the site: its marker no longer matches (the key holds the build's hash).
$recheck('a new build (schema.php changed)', static function () use ($wp, $schema): void {
    $schema['collections']['posts']['label'] = 'Articles';
    $wp->writeSchema($schema);
}, false);
$recheck('the system tables recorded again', static fn () => update_option('first_runtime_tables', 'older'));
$recheck('a migration run', static fn () => $wp->wpCli(['migrate']));
$recheck('the app deactivated', static function (): void {
    deactivate_plugins('first-app-blog/first-app-blog.php');
    activate_plugin('first-app-blog/first-app-blog.php');
});
$recheck('the search shape cleared', static fn () => delete_option('first_search_shape'));
$recheck('a recurring action cancelled', static fn () => as_unschedule_all_actions('first_jobs_maintain', [], 'first'));
check('which the checking request scheduled again', as_has_scheduled_action('first_jobs_maintain', [], 'first'));

// ---- a failed install is never hidden ------------------------------------------------------------------
// A migration the database refuses: the request that runs it fails, records nothing, and every request
// after it retries (and fails) instead of skipping the check.
$migrations = $wp->dir . '/content/plugins/first-app-blog/first/app/migrations';
file_put_contents("$migrations/0002_broken.sql", "ALTER TABLE `{prefix}no_such_table` ADD COLUMN `x` INT;\n");
$broken = $schema;
$broken['collections']['posts']['label'] = 'Broken build';
$wp->writeSchema($broken);
[, $statements] = request($url, '/');
check('a failing migration is tried', in_array('ledger', checks($statements), true), checks($statements));
eq('and leaves no marker', $marker(), null);
[$status, $statements] = request($url, '/__first/api/v1/posts');
eq('the next request retries it, and First refuses meanwhile', [$status, in_array('schema hash', checks($statements), true), $marker()], [503, true, null]);
unlink("$migrations/0002_broken.sql");
$wp->writeSchema($schema);
request($url, '/');
check('once the build is fixed, the marker is recorded again', $marker() !== null, $marker());

// ---- a managed build never records one ---------------------------------------------------------------
eq('a plugin-installed site is not managed', \First\Wp\Runtime::managed(), false);

finish('install_marker');
