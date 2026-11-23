<?php

declare(strict_types=1);

/*
 * A site that ran a pre-release build's identity, then runs this checkout's identity without the
 * runtime (identity alone): identity moves its own tables, options and cron events, once, and its
 * accounts are there under the current names. A second boot changes nothing.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

const LEGACY_COMMIT = '45d81e72857beb2d2f6b6c15bc3d749ead96baf2';

// The children. `settled`: one boot of the moved site, printing every query it sent. `cronfail`: one
// boot whose save of the cron events fails, printing the identity options it left.
if (($argv[1] ?? '') === 'cronfail') {
    $site = json_decode((string) file_get_contents("{$argv[2]}/site.json"), true, 512, JSON_THROW_ON_ERROR);
    wpDefine($argv[2], $site['url']);
    $GLOBALS['wp_filter']['pre_update_option_cron'][10]['fail'] = ['accepted_args' => 2, 'function' => static fn ($new, $old) => $old];
    require_once ABSPATH . 'wp-settings.php';
    echo json_encode($GLOBALS['wpdb']->get_col("SELECT option_name FROM {$GLOBALS['wpdb']->options} WHERE option_name LIKE '%identity\\_schema\\_version'")), "\n";
    exit(0);
}
if (($argv[1] ?? '') === 'settled') {
    $site = json_decode((string) file_get_contents("{$argv[2]}/site.json"), true, 512, JSON_THROW_ON_ERROR);
    wpDefine($argv[2], $site['url']);
    $sent = [];
    $GLOBALS['wp_filter']['query'][10]['probe'] = ['accepted_args' => 1, 'function' => static function (string $query) use (&$sent): string {
        $sent[] = $query;

        return $query;
    }];
    require_once ABSPATH . 'wp-settings.php';
    echo json_encode($sent), "\n";
    exit(0);
}

$before = require __DIR__ . '/brand_upgrade/legacy.php';
$dir = $before['dir'];
$repo = dirname(__DIR__, 2);
// Identity alone: the pre-release runtime and app are deactivated, this checkout's identity takes the place of its own.
wpCopy("$repo/runtime/identity", "$dir/content/plugins/spacepress-identity", ['apps', 'composer.json', 'composer.lock']);
$site = ['salts' => 'typedpress-test-'] + json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
file_put_contents("$dir/site.json", json_encode(['activate' => ['spacepress-identity'], 'deactivate' => ['typedpress-app-blog', 'typedpress-identity', 'typedpress-runtime']] + $site, JSON_THROW_ON_ERROR));
exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__DIR__ . '/wp.php') . ' activate ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
$code === 0 || throw new RuntimeException("switching to identity alone failed:\n" . implode("\n", $out));
file_put_contents("$dir/site.json", json_encode($site, JSON_THROW_ON_ERROR));
// A boot that cannot save the moved cron events leaves the move unfinished, for the next boot.
$out = [];
exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__FILE__) . ' cronfail ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
eq('a failed cron save keeps the schema version under the earlier name', [$code, json_decode((string) end($out), true)], [0, ['tp_identity_schema_version']]);

wpDefine($dir, $site['url']);
require_once ABSPATH . 'wp-settings.php';
global $wpdb;
$p = $wpdb->prefix;
$tables = static fn (string $like): array => $wpdb->get_col($wpdb->prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE %s ORDER BY name", $like));
$identity = array_values(array_filter($before['tables'], static fn (string $t): bool => str_contains($t, '_identity_')));

check('identity runs without the runtime', !class_exists(\SpacePress\Wp\BrandUpgrade::class) && class_exists(\SpacePress\Identity\Plugin::class));
eq('identity\'s tables moved under the current names', $tables("{$p}sp\\_identity\\_%"), array_map(static fn (string $t): string => str_replace('_tp_identity_', '_sp_identity_', $t), $identity));
eq('… and none is left under the earlier one', $tables("{$p}tp\\_identity\\_%"), []);
eq('the accounts are there', (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$p}sp_identity_applications`") > 0, true);
eq('its options moved, none left behind', [get_option('sp_identity_schema_version') !== false, $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE 'tp\\_identity\\_%'")], [true, []]);
$hooks = array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array'))));
eq('its cron events moved', [array_values(array_filter($hooks, static fn (string $h): bool => str_starts_with($h, 'tp_identity_'))), in_array('sp_identity_password_inventory', $hooks, true)], [[], true]);
$snapshot = static fn (): array => [$tables("{$p}%"), $wpdb->get_results("SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name LIKE '%identity%' ORDER BY option_name", ARRAY_A)];
$once = $snapshot();
\SpacePress\Identity\Legacy::move($wpdb);
eq('a second move changes nothing', $snapshot(), $once);
// A settled site pays nothing for the move: no boot asks for the earlier name again.
$out = [];
exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__FILE__) . ' settled ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
$sent = json_decode((string) end($out), true);
check('a settled boot sends queries', $code === 0 && is_array($sent) && $sent !== []);
eq('… none naming the earlier schema version', array_values(array_filter((array) $sent, static fn (string $q): bool => str_contains($q, 'tp_identity_'))), []);
check('… since identity recorded that it has nothing left to move', $wpdb->get_var("SELECT autoload FROM {$wpdb->options} WHERE option_name = 'sp_identity_upgrade'") === 'on');

// A site with identity's storage under both names (and so a current schema version): reported, not
// passed over, and recorded as settled only once someone has chosen which one stays.
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name = 'sp_identity_upgrade'");
$wpdb->query("INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('tp_identity_schema_version', '4', 'off')");
$wpdb->query("CREATE TABLE `{$p}tp_identity_sessions` (id char(32) NOT NULL, PRIMARY KEY (id))");
$out = [];
exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__FILE__) . ' settled ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
check('a boot of a site with identity\'s storage under both names looks for the earlier one', $code === 0 && array_filter((array) json_decode((string) end($out), true), static fn (string $q): bool => str_contains($q, 'tp_identity_schema_version')) !== []);
check('… and reports the collision', str_contains((string) @file_get_contents("$dir/content/debug.log"), "Identity storage exists under both {$p}tp_identity_sessions and {$p}sp_identity_sessions"));
eq('… without recording identity as settled', $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name = 'sp_identity_upgrade'"), '0');

// An event already under the current hook at the same time and arguments, on another schedule, is
// someone's: the move stops before anything changes. The same event under both hooks is one event.
$wpdb->query("DROP TABLE `{$p}tp_identity_sessions`");
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name = 'tp_identity_schema_version'");
$wpdb->query("UPDATE {$wpdb->options} SET option_name = 'tp_identity_schema_version' WHERE option_name = 'sp_identity_schema_version'");
wp_cache_flush();
$at = time() + 3600;
$event = static fn (string $schedule, int $interval): array => [md5(serialize([])) => ['schedule' => $schedule, 'args' => [], 'interval' => $interval]];
$cron = _get_cron_array();
$cron[$at] = ['tp_identity_maintenance' => $event('tp_identity_minute', 60), 'sp_identity_maintenance' => $event('hourly', 3600)];
_set_cron_array($cron);
$cronBefore = _get_cron_array();
$failure = null;
try {
    \SpacePress\Identity\Legacy::move($wpdb);
} catch (\SpacePress\Identity\Failure $e) {
    $failure = $e->getMessage();
}
wp_cache_flush();
check('a current event at the same time and arguments on another schedule stops the move', str_contains((string) $failure, 'sp_identity_maintenance'));
eq('… before anything changed', [_get_cron_array(), $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '%identity\\_schema\\_version'")], [$cronBefore, ['tp_identity_schema_version']]);
$cron = _get_cron_array();
$cron[$at]['sp_identity_maintenance'] = $event('sp_identity_minute', 60);
_set_cron_array($cron);
\SpacePress\Identity\Legacy::move($wpdb);
wp_cache_flush();
eq('the same event under both hooks moves as one', [_get_cron_array()[$at] ?? null, get_option('sp_identity_schema_version') !== false], [['sp_identity_maintenance' => $event('sp_identity_minute', 60)], true]);

finish('brand_upgrade_identity');
