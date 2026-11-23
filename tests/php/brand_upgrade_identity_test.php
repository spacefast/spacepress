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

$before = require __DIR__ . '/brand_upgrade/legacy.php';
$dir = $before['dir'];
$repo = dirname(__DIR__, 2);
// Identity alone: the pre-release runtime and app are deactivated, this checkout's identity takes the place of its own.
wpCopy("$repo/runtime/identity", "$dir/content/plugins/spacepress-identity", ['apps', 'composer.json', 'composer.lock']);
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
file_put_contents("$dir/site.json", json_encode(['activate' => ['spacepress-identity'], 'deactivate' => ['typedpress-app-blog', 'typedpress-identity', 'typedpress-runtime']] + $site, JSON_THROW_ON_ERROR));
exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__DIR__ . '/wp.php') . ' activate ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
$code === 0 || throw new RuntimeException("switching to identity alone failed:\n" . implode("\n", $out));
file_put_contents("$dir/site.json", json_encode($site, JSON_THROW_ON_ERROR));

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

finish('brand_upgrade_identity');
