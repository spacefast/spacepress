<?php

declare(strict_types=1);

/*
 * The install marker (TypedPress\Wp\InstallMarker) on WordPress on SQLite, over HTTP through php -S: once
 * a request has found everything this build installs in place, the next requests run none of the
 * install checks (the ledger read, the system-tables, stored-name, search and Action Scheduler
 * checks), and whatever changes what those checks cover makes the next request check again. A
 * failed install is never hidden by it.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// Each request's statements, as TypedPress's connection and $wpdb see them, written where this process
// can read them back (a must-use plugin loaded before TypedPress on every request the server answers).
$log = sys_get_temp_dir() . '/typedpress-install-marker-' . bin2hex(random_bytes(4)) . '.log';
$logFile = var_export($log, true);
$wp = wpSite('install-marker', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'muPlugins' => ['statements' => <<<PHP
        <?php
        if (isset(\$_SERVER['HTTP_X_STATEMENTS'])) {
            \$GLOBALS['tp_statements'] = [];
            add_filter('query', static function (string \$sql): string { \$GLOBALS['tp_statements'][] = \$sql; return \$sql; });
            add_action('plugins_loaded', static function (): void {
                if (class_exists(\\TypedPress\\Wp\\Connection::class) && property_exists(\\TypedPress\\Wp\\Connection::class, "observer")) {
                    \\TypedPress\\Wp\\Connection::\$observer = static function (string \$sql): void { \$GLOBALS['tp_statements'][] = \$sql; };
                }
            }, 0);
            register_shutdown_function(static fn () => file_put_contents($logFile, json_encode(\$GLOBALS['tp_statements'])));
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
            'schema hash' => "option_name = 'tp_blog_schema'",
            'system tables' => "option_name = 'tp_runtime_tables'",
            'stored names' => "option_name = 'tp_zero_names'",
            'search table' => 'tp__search` LIMIT 1',
            'search shape' => "option_name = 'tp_search_shape'",
            'scheduled actions' => "a.hook='tp_jobs_maintain'",
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
    $row = $wp->sql("SELECT option_value AS v, autoload AS a FROM {prefix}options WHERE option_name = 'tp_installed'")[0] ?? null;

    return $row === null ? null : [$row['a'], (string) $row['v']];
};

// ---- the first request records it, the next ones skip every check -----------------------------------
// This process loaded the installed site too (and recorded the marker as any request would): start over.
\TypedPress\Wp\InstallMarker::forget();
eq('no marker to begin with', $marker(), null);
[$status, $first] = request($url, '/');
check('a request with no marker runs the install checks', $status === 200 && in_array('ledger', checks($first), true) && in_array('system tables', checks($first), true), [$status, checks($first)]);
check('the request that found everything installed records the marker, autoloaded', in_array($marker()[0] ?? null, ['yes', 'on', 'auto-on'], true), $marker());
[$status, $next] = request($url, '/');
eq('with the marker, a request runs none of the install checks', [$status, checks($next)], [200, []]);
check('and fewer statements in all', count($next) < count($first), [count($first), count($next)]);
[$status, $api] = request($url, '/__tp/api/v1/posts');
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
$recheck('the system tables recorded again', static fn () => update_option('tp_runtime_tables', 'older'));
$recheck('a migration run', static fn () => $wp->wpCli(['migrate']));
$recheck('the app deactivated', static function (): void {
    deactivate_plugins('typedpress-app-blog/typedpress-app-blog.php');
    activate_plugin('typedpress-app-blog/typedpress-app-blog.php');
});
$recheck('the search shape cleared', static fn () => delete_option('tp_search_shape'));
$recheck('a recurring action cancelled', static fn () => as_unschedule_all_actions('tp_jobs_maintain', [], 'typedpress'));
check('which the checking request scheduled again', as_has_scheduled_action('tp_jobs_maintain', [], 'typedpress'));
// A site an older runtime scheduled daily keeps that interval until a check replaces it with the hourly one.
$maintenance = static function (): array {
    $store = ActionScheduler::store();
    $ids = $store->query_actions(['hook' => 'tp_jobs_maintain', 'group' => 'typedpress', 'status' => ActionScheduler_Store::STATUS_PENDING]);

    return array_map(static fn ($id): int => (int) $store->fetch_action((string) $id)->get_schedule()->get_recurrence(), $ids);
};
eq('maintenance recurs hourly', $maintenance(), [HOUR_IN_SECONDS]);
$recheck('maintenance on an older runtime\'s daily interval', static function (): void {
    as_unschedule_all_actions('tp_jobs_maintain', [], 'typedpress');
    as_schedule_recurring_action(time() + DAY_IN_SECONDS, DAY_IN_SECONDS, 'tp_jobs_maintain', [], 'typedpress');
});
eq('which the checking request replaced with one hourly schedule', $maintenance(), [HOUR_IN_SECONDS]);
// A refused schedule keeps the old run: the site is never left without maintenance, and install says so.
as_unschedule_all_actions('tp_jobs_maintain', [], 'typedpress');
as_schedule_recurring_action(time() + DAY_IN_SECONDS, DAY_IN_SECONDS, 'tp_jobs_maintain', [], 'typedpress');
$refuse = static fn () => 0;
add_filter('pre_as_schedule_recurring_action', $refuse);
$refused = null;
try {
    \TypedPress\Wp\Jobs\ActionSchedulerQueue::install();
} catch (\RuntimeException $e) {
    $refused = $e->getMessage();
}
remove_filter('pre_as_schedule_recurring_action', $refuse);
eq('a refused schedule fails the install', $refused, 'Action Scheduler refused to schedule TypedPress job maintenance');
eq('and keeps the daily run it would have replaced', $maintenance(), [DAY_IN_SECONDS]);
\TypedPress\Wp\Jobs\ActionSchedulerQueue::install();
eq('which the next install replaces', $maintenance(), [HOUR_IN_SECONDS]);

// ---- a failed install is never hidden ------------------------------------------------------------------
// A migration the database refuses: the request that runs it fails, records nothing, and every request
// after it retries (and fails) instead of skipping the check.
$migrations = $wp->dir . '/content/plugins/typedpress-app-blog/tp/app/migrations';
file_put_contents("$migrations/0002_broken.sql", "ALTER TABLE `{prefix}no_such_table` ADD COLUMN `x` INT;\n");
$broken = $schema;
$broken['collections']['posts']['label'] = 'Broken build';
$wp->writeSchema($broken);
[, $statements] = request($url, '/');
check('a failing migration is tried', in_array('ledger', checks($statements), true), checks($statements));
eq('and leaves no marker', $marker(), null);
[$status, $statements] = request($url, '/__tp/api/v1/posts');
eq('the next request retries it, and TypedPress refuses meanwhile', [$status, in_array('schema hash', checks($statements), true), $marker()], [503, true, null]);
unlink("$migrations/0002_broken.sql");
$wp->writeSchema($schema);
request($url, '/');
check('once the build is fixed, the marker is recorded again', $marker() !== null, $marker());

// ---- per site, and the active plugins are part of the key ----------------------------------------------
// (Review 1, item 6.) This process holds the marker's answer for blog 1. Another blog's answer is its
// own: on multisite, switch_to_blog() changes get_current_blog_id() and the options read. The harness has
// no multisite network, so the blog id is moved the way switch_to_blog() moves it.
request($url, '/');
wp_cache_flush();
// This process cached blog 1's answer when the test began (forget()); start from no cached answer.
(new ReflectionProperty(\TypedPress\Wp\InstallMarker::class, 'current'))->setValue(null, is_array((new ReflectionProperty(\TypedPress\Wp\InstallMarker::class, 'current'))->getValue()) ? [] : null);
check('this site matches its marker', \TypedPress\Wp\InstallMarker::current(), [$marker(), get_current_blog_id()]);
$GLOBALS['blog_id'] = 2;
delete_option('tp_installed'); // the options this process reads now stand for blog 2's, which has none
wp_cache_flush();
eq('after switching blogs, the answer is read for that blog, not reused', \TypedPress\Wp\InstallMarker::current(), false);
$GLOBALS['blog_id'] = 1;
// A plugin activated or deactivated outside TypedPress's hooks (a network activation on multisite changes
// sitemeta, which fires no option hook of the site): the key no longer matches.
[$status] = request($url, '/');
$recorded = $marker()[1] ?? null;
$wp->sql("UPDATE {prefix}options SET option_value = ? WHERE option_name = 'active_plugins'", [serialize([...get_option('active_plugins'), 'hello-not-installed/hello.php'])]);
wp_cache_flush();
[$status, $statements] = request($url, '/');
check('a changed plugin list is checked again on the next request, without any option hook', $status === 200 && in_array('ledger', checks($statements), true), checks($statements));
check('and recorded under a new key', ($marker()[1] ?? null) !== null && $marker()[1] !== $recorded, [$recorded, $marker()]);

// ---- an invalidation while recording (review 2, S5) ---------------------------------------------------
// Another request cancels the recurring maintenance after this one's final check and before its write:
// the marker must not stay, or the next request would skip scheduling it again. Run in this process: the
// injected step is the other request's work, and the marker this process sees is the site's.
$pending = static fn (): bool => as_has_scheduled_action('tp_jobs_maintain', [], 'typedpress');
\TypedPress\Wp\InstallMarker::forget();
wp_cache_flush();
check('the maintenance action is scheduled before the race', $pending());
\TypedPress\Wp\InstallMarker::$beforeWrite = static fn () => as_unschedule_all_actions('tp_jobs_maintain', [], 'typedpress');
(new ReflectionProperty(\TypedPress\Wp\InstallMarker::class, 'current'))->setValue(null, []);
\TypedPress\Wp\InstallMarker::record();
\TypedPress\Wp\InstallMarker::$beforeWrite = null;
wp_cache_flush();
eq('a cancellation between the check and the write leaves no marker', [$pending(), $marker()], [false, null]);
[$status, $statements] = request($url, '/');
check('so the next request checks and schedules it again', $status === 200 && in_array('scheduled actions', checks($statements), true) && $pending(), [checks($statements), $pending()]);
check('and records the marker', $marker() !== null, $marker());

// The other process's cancellation (review 3): the maintenance action goes, but this process's
// forget() doesn't run (its hook is detached for that step). Only the check after the write can
// remove the marker.
\TypedPress\Wp\InstallMarker::forget();
request($url, '/');
wp_cache_flush();
\TypedPress\Wp\InstallMarker::forget();
wp_cache_flush();
check('the maintenance action is scheduled before the second race', $pending());
\TypedPress\Wp\InstallMarker::$beforeWrite = static function (): void {
    global $wp_filter;
    $saved = $wp_filter['action_scheduler_canceled_action'] ?? null;
    unset($wp_filter['action_scheduler_canceled_action']);
    try {
        as_unschedule_all_actions('tp_jobs_maintain', [], 'typedpress');
    } finally {
        if ($saved !== null) {
            $wp_filter['action_scheduler_canceled_action'] = $saved;
        }
    }
};
(new ReflectionProperty(\TypedPress\Wp\InstallMarker::class, 'current'))->setValue(null, []);
\TypedPress\Wp\InstallMarker::record();
\TypedPress\Wp\InstallMarker::$beforeWrite = null;
wp_cache_flush();
eq('a cancellation by another process (no forget() here) leaves no marker either', [$pending(), $marker()], [false, null]);
request($url, '/');
check('and the next request schedules the action again', $pending());

// A request that read the marker as absent (cached in notoptions) still deletes it when another
// request wrote it since (review 3): forget() never trusts its own cached miss.
\TypedPress\Wp\InstallMarker::forget();
wp_cache_flush();
eq('no marker, and this process caches the miss', get_option('tp_installed'), false);
$wp->exec("INSERT INTO {prefix}options (option_name, option_value, autoload) VALUES ('tp_installed', 'written-by-another-request', 'on')");
eq('the row exists, the cache still says absent', [count($wp->sql("SELECT 1 FROM {prefix}options WHERE option_name = 'tp_installed'")), get_option('tp_installed')], [1, false]);
\TypedPress\Wp\InstallMarker::forget();
eq('forget() deletes the row anyway', count($wp->sql("SELECT 1 FROM {prefix}options WHERE option_name = 'tp_installed'")), 0);
wp_cache_flush();
request($url, '/');

// A recurring action whose next run Action Scheduler could not schedule: nothing would schedule it
// again while the marker matches, so the failure drops the marker.
request($url, '/');
wp_cache_flush();
check('a marker is recorded before the scheduling failure', $marker() !== null, $marker());
do_action('action_scheduler_failed_to_schedule_next_instance', 0, new \RuntimeException('no next run'), null);
wp_cache_flush();
eq('a recurring action that could not be scheduled again drops the marker', $marker(), null);
request($url, '/');

// ---- the app's own install options drop the marker (tp_<app>_schema, _refused, _route_pages, _content) ---
foreach (['tp_blog_schema', 'tp_blog_refused', 'tp_blog_route_pages', 'tp_blog_content'] as $option) {
    request($url, '/');
    wp_cache_flush();
    $before = get_option($option);
    update_option($option, $before === false ? 'changed' : (is_array($before) ? $before + ['changed' => 1] : $before . '-changed'), false);
    wp_cache_flush();
    $dropped = $marker() === null;
    $before === false ? delete_option($option) : update_option($option, $before, false);
    check("a change to $option drops the marker", $dropped);
}
request($url, '/');

// ---- a managed build never records one ---------------------------------------------------------------
// (tests/wp/store-install-run.sh checks a managed site after initialize and its first requests.)
eq('a plugin-installed site is not managed', \TypedPress\Wp\Runtime::managed(), false);

finish('install_marker');
