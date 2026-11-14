<?php

declare(strict_types=1);

/*
 * First\Wp\Guard on an in-process WordPress: what "php/wordpress" calls may not touch, whatever name
 * the app builds at runtime (the build refuses literal names with F4301), and which tables an
 * `existingTable` may bind.
 */

use First\JsObject;
use First\Wp\Functions;
use First\Wp\Guard;
use First\Wp\Migrator;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$wp = wpSite('guard', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
]);
$wp->actAs('admin');
$call = static fn (string $f, array $args) => Functions::call($f, $args);

// An ordinary option of the app's own: written, read, deleted.
eq('an app option is written', $call('update_option', ['guard_app_setting', 'on']), true);
eq('and read back', $call('get_option', ['guard_app_setting']), 'on');
eq('and deleted', $call('delete_option', ['guard_app_setting']), true);
eq('a site setting that holds nothing dangerous is readable', $call('get_option', ['blogname']), get_option('blogname'));

$plugins = get_option('active_plugins');
$protected = ['active_plugins', 'active_sitewide_plugins', 'template', 'stylesheet', 'siteurl', 'home', 'admin_email',
    'users_can_register', 'default_role', 'wp_user_roles', 'cron', 'recently_activated', 'upload_path', 'upload_url_path',
    'uninstall_plugins', 'first_blog_schema', 'first__anything', 'jetpack_active_modules', '_site_transient_update_plugins'];
foreach ($protected as $name) {
    problem("update_option refuses $name", static fn () => $call('update_option', [$name, 'x']), 403, 'protected_option');
    problem("delete_option refuses $name", static fn () => $call('delete_option', [$name]), 403, 'protected_option');
}
eq('the refused writes changed nothing', [get_option('active_plugins'), get_option('default_role'), get_option('users_can_register')], [$plugins, 'subscriber', '0']);
// MySQL compares option_name case-insensitively, ignores trailing spaces, and folds some letters.
foreach (['Active_Plugins', ' default_role ', "default_role\t", 'DEFAULT_ROLE', "activ\u{e9}_plugins", "default_r\u{f3}le"] as $name) {
    problem('a spelling MySQL would match is refused: ' . json_encode($name), static fn () => $call('update_option', [$name, 'administrator']), 403, 'protected_option');
}
eq('default_role is still subscriber', get_option('default_role'), 'subscriber');
eq('a protected setting that holds no secret is still readable', $call('get_option', ['template']), get_option('template'));

update_option('jetpack_private_options', ['blog_token' => 'tok.secret']);
update_option('jetpack_secrets', ['x' => 'y']);
update_option('example_api_key', 'k');
foreach (['jetpack_private_options', 'jetpack_secrets', 'first_runtime_secret', 'first_identity_signing_keys', 'auth_key', 'nonce_salt',
    'secret_key', 'recovery_keys', 'example_api_key', 'mailserver_pass', 'JETPACK_PRIVATE_OPTIONS'] as $name) {
    problem("get_option refuses the secret $name", static fn () => $call('get_option', [$name]), 403, 'protected_option');
}

// wp_insert_post runs no capability check: a published customize_changeset applies settings with it off.
$changeset = ['post_type' => 'customize_changeset', 'post_status' => 'publish', 'post_title' => 'x',
    'post_content' => json_encode(['blogname' => ['value' => 'Owned']])];
problem('wp_insert_post refuses customize_changeset', static fn () => $call('wp_insert_post', [new JsObject($changeset), true]), 403, 'protected_post_type');
foreach (['wp_template', 'wp_global_styles', 'nav_menu_item', 'first_posts', 'revision', 'oembed_cache', 'user_request', 'no_such_type'] as $type) {
    problem("wp_insert_post refuses post_type $type", static fn () => $call('wp_insert_post', [new JsObject(['post_type' => $type, 'post_title' => 'x']), true]), 403, 'protected_post_type');
}
eq('blogname kept', get_option('blogname') !== 'Owned', true);
$id = $call('wp_insert_post', [new JsObject(['post_title' => 'Plain', 'post_status' => 'draft']), true]);
eq('a plain post is inserted', is_int($id) && $id > 0, true);
eq('a page is inserted', is_int($call('wp_insert_post', [new JsObject(['post_title' => 'Page', 'post_type' => 'page']), true])), true);

// existingTable: this site's prefix (wp_ here), never WordPress's, First's or Action Scheduler's own.
$refused = static function (string $label, string $table, string $prefix) {
    try {
        Guard::table($table, $prefix);
        check($label, false, 'accepted');
    } catch (\First\HttpError $e) {
        check($label, $e->errorCode === 'existing_table_refused', $e->getMessage());
    }
};
$allowed = static function (string $label, string $table, string $prefix) {
    try {
        Guard::table($table, $prefix);
        check($label, true);
    } catch (\First\HttpError $e) {
        check($label, false, $e->getMessage());
    }
};
$allowed('a table under the site prefix', 'wp_legacy_orders', 'wp_');
foreach (['wp_users', 'wp_usermeta', 'WP_Options', 'wp_posts', 'wp_first_posts', 'wp_first__migrations', 'wp_actionscheduler_actions', 'wp_2_posts'] as $t) {
    $refused("$t is refused", $t, 'wp_');
}
$refused('another prefix is refused', 'other_orders', 'wp_');
$other = 'sfz_' . substr(hash('sha256', 'spc_other'), 0, 24) . '_';
$mine = 'sfz_' . substr(hash('sha256', 'spc_mine'), 0, 24) . '_';
$refused("another Space's v2 table is refused", $other . 'first_tasks', $mine);
$refused("another Space's WordPress users are refused", $other . 'users', $mine);
$legacy = 'sf_spc_mine_tasks_' . substr(hash('sha256', "spc_mine\0tasks"), 0, 10);
$allowed("this Space's own 0.8 table is bound under its sfz_ prefix", $legacy, $mine);
$refused("another Space's 0.8 table is refused", 'sf_spc_other_tasks_' . substr(hash('sha256', "spc_other\0tasks"), 0, 10), $mine);
$refused('a 0.8 table on a host that names no Space is refused', $legacy, 'wp_');
$refused('a name without the converter digest is not a 0.8 table', 'sf_spc_mine_tasks', $mine);
// Only the Space the prefix hashes to: spc_ab's tables are not spc_a's, nor spc_a's spc_ab's.
$a = 'sfz_' . substr(hash('sha256', 'spc_a'), 0, 24) . '_';
$ab = 'sfz_' . substr(hash('sha256', 'spc_ab'), 0, 24) . '_';
$allowed("spc_a's table under spc_a", 'sf_spc_a_tasks_0123456789', $a);
$refused("spc_ab's table is not spc_a's", 'sf_spc_ab_tasks_0123456789', $a);
$refused("spc_a's table is not spc_ab's", 'sf_spc_a_tasks_0123456789', $ab);
// A host that isn't Spacefast names its Space with FIRST_SPACE_ID (the in-process site defines none).
eq('no FIRST_SPACE_ID here', defined('FIRST_SPACE_ID'), false);

// The migrator refuses an unchecked binding before it reads the table or writes the ledger.
$bad = $schema;
$bad['collections']['comments']['existingTable'] = 'wp_users';
$dir = sys_get_temp_dir() . '/first-guard-' . getmypid();
@mkdir($dir);
file_put_contents("$dir/0001_adopt.sql", "-- first-adopt {\"table\":\"wp_users\",\"indexes\":[],\"foreignKeys\":[],\"integerColumns\":[]}\nSELECT `ID` FROM `wp_users` LIMIT 0;");
$migrator = new Migrator($wp->connection(), $dir, new \First\Schema($bad));
problem('the migrator refuses an existingTable of WordPress users', static fn () => $migrator->migrate(), 409, 'existing_table_refused');
eq('and records nothing', in_array('0001_adopt', $migrator->pending(), true), true);
array_map('unlink', glob("$dir/*"));
rmdir($dir);

finish('guard');
