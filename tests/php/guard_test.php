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
// WordPress allows spaces inside a name; only trailing ones are trimmed (and padded by MySQL).
eq('an app option with spaces in its name is written', $call('update_option', ['my app settings', 'on']), true);
eq('and read back', $call('get_option', ['my app settings']), 'on');
eq('and deleted', $call('delete_option', ['my app settings']), true);

$plugins = get_option('active_plugins');
$protected = ['active_plugins', 'active_sitewide_plugins', 'template', 'stylesheet', 'siteurl', 'home', 'admin_email',
    'users_can_register', 'default_role', 'wp_user_roles', 'cron', 'recently_activated', 'upload_path', 'upload_url_path',
    'uninstall_plugins', 'first_blog_schema', 'first__anything', 'jetpack_active_modules', '_site_transient_update_plugins',
    'new_user_0123abcd', 'adminhash', 'rewrite_rules', 'permalink_structure', 'show_on_front', 'blog_public'];
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
// A longer prefix that starts with this one is another site in the same database.
$wp->connection()->run('CREATE TABLE wp_other_options (option_id INTEGER PRIMARY KEY, option_name VARCHAR(191), option_value LONGTEXT, autoload VARCHAR(20))');
$wp->connection()->run('CREATE TABLE wp_other_users (ID INTEGER PRIMARY KEY)');
$refused('a table under a longer prefix that has its own options table is refused', 'wp_other_users', 'wp_');
$allowed('a table without such a site beside it is not', 'wp_otherthing_rows', 'wp_');
// A prefix need not end in `_`: an install prefixed `wp_shop` has wp_shopusers and wp_shopoptions.
$wp->connection()->run('CREATE TABLE wp_shopoptions (option_id INTEGER PRIMARY KEY, option_name VARCHAR(191), option_value LONGTEXT, autoload VARCHAR(20))');
$wp->connection()->run('CREATE TABLE wp_shopusers (ID INTEGER PRIMARY KEY)');
$refused('a longer prefix without a trailing _ is another site: its users', 'wp_shopusers', 'wp_');
$refused('and its options', 'wp_shopoptions', 'wp_');
$refused('and any of its tables, whatever the case', 'WP_ShopOrders', 'wp_');
$allowed('a name that only shares the start of that prefix is not under it', 'wp_shoes', 'wp_');
// A plugin's own `…options` table without WordPress's options columns is not another site.
$wp->connection()->run('CREATE TABLE wp_myplugin_options (id INTEGER PRIMARY KEY, label TEXT)');
$allowed("a plugin's own options table is an app table", 'wp_myplugin_options', 'wp_');
$allowed('and so are the tables beside it', 'wp_myplugin_rows', 'wp_');
// CUSTOM_USER_TABLE and CUSTOM_USER_META_TABLE rename WordPress's users tables.
global $wpdb;
[$users, $usermeta] = [$wpdb->users, $wpdb->usermeta];
[$wpdb->users, $wpdb->usermeta] = ['wp_accounts', 'shared_accountmeta'];
$refused('a renamed users table is refused', 'wp_accounts', 'wp_');
$refused('in any case', 'WP_Accounts', 'wp_');
$refused('a renamed usermeta table outside the prefix is refused', 'shared_accountmeta', 'wp_');
[$wpdb->users, $wpdb->usermeta] = [$users, $usermeta];
$allowed('the name is an app table again once WordPress no longer uses it', 'wp_accounts', 'wp_');
foreach (['wp_first_identity_accounts', 'wp_identity_sessions', 'wp_wc_orders', 'wp_woocommerce_sessions'] as $t) {
    $refused("$t is refused", $t, 'wp_');
}

// The 0.8 table name `sf_<space>_<table>_<digest>` as src/config_migrate/app/transform.rs `physical` writes it.
$part = static fn (string $s) => substr(trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($s)), '_'), 0, 48);
$legacyOf = static fn (string $space, string $t) => substr('sf_' . $part($space) . '_' . $part($t), 0, 53) . '_' . substr(hash('sha256', "$space\0$t"), 0, 10);
$sfz = static fn (string $space) => 'sfz_' . substr(hash('sha256', $space), 0, 24) . '_';
eq('the helper matches the converter fixture name', $legacyOf('spc_migrate_test', 'tasks'), 'sf_spc_migrate_test_tasks_3c47092ff0');
eq('and a camelCase one (first migrate app --space spc_x)', $legacyOf('spc_x', 'myTasks'), 'sf_spc_x_mytasks_a102734393');
// No Space from the host: no 0.8 table binds, whatever the prefix.
$refused('a 0.8 table on a host that names no Space is refused', $legacyOf('spc_mine', 'tasks'), $sfz('spc_mine'));
eq('no FIRST_SPACE_ID in the in-process site', defined('FIRST_SPACE_ID'), false);

// Spacefast names the Space (spacefast_content_space_id); the digest needs the real id and table.
$GLOBALS['GUARD_SPACE'] = 'spc_mine';
eval('function spacefast_content_space_id(): string { return (string) ($GLOBALS["GUARD_SPACE"] ?? ""); }');
$mine = $sfz('spc_mine');
$allowed("this Space's own 0.8 table", $legacyOf('spc_mine', 'tasks'), $mine);
$refused("another Space's 0.8 table", $legacyOf('spc_other', 'tasks'), $mine);
$refused("another Space's v2 table", $sfz('spc_other') . 'first_tasks', $mine);
$refused("another Space's WordPress users", $sfz('spc_other') . 'users', $mine);
$refused('a name without the converter digest', 'sf_spc_mine_tasks', $mine);
$refused('a made-up digest', 'sf_spc_mine_tasks_0123456789', $mine);
$refused('the host Space must be the one its sfz_ prefix was made from', $legacyOf('spc_mine', 'tasks'), $sfz('spc_other'));
// spc_a's name starts spc_a_b's: the digest keeps them apart in both directions.
$GLOBALS['GUARD_SPACE'] = 'spc_a';
$allowed("spc_a's table under spc_a", $legacyOf('spc_a', 'tasks'), $sfz('spc_a'));
$refused("spc_a_b's table is not spc_a's", $legacyOf('spc_a_b', 'tasks'), $sfz('spc_a'));
$GLOBALS['GUARD_SPACE'] = 'spc_a_b';
$refused("spc_a's table is not spc_a_b's", $legacyOf('spc_a', 'b_tasks'), $sfz('spc_a_b'));
$allowed("spc_a_b's own b_tasks-free name", $legacyOf('spc_a_b', 'tasks'), $sfz('spc_a_b'));
// The converter lowercases and normalizes the id, and cuts long names.
$GLOBALS['GUARD_SPACE'] = 'Space-Mixed.1';
$allowed('a mixed-case Space id adopts its own tables', $legacyOf('Space-Mixed.1', 'tasks'), $sfz('Space-Mixed.1'));
$GLOBALS['GUARD_SPACE'] = 'spc_long';
$refused('a cut name alone is not enough: the digest needs the table name', $legacyOf('spc_long', str_repeat('t', 60)), $sfz('spc_long'));
$adopts = static function (string $label, string $table, string $prefix, array $names) {
    try {
        Guard::table($table, $prefix, $names);
        check($label, true);
    } catch (\First\HttpError $e) {
        check($label, false, $e->getMessage());
    }
};
$adopts('a long table name the converter cut adopts through the collection named after it', $legacyOf('spc_long', str_repeat('t', 60)), $sfz('spc_long'), [str_repeat('t', 60)]);
// A collection renamed with `was` keeps its 0.8 table: the digest is over the name it was adopted
// under, which the compiler keeps as `adoptedAs` (src/pipeline.rs adopted_names).
$GLOBALS['GUARD_SPACE'] = 'spc_mine';
$myTasks = $legacyOf('spc_mine', 'myTasks');
$spec = ['key' => 'items', 'existingTable' => $myTasks];
try {
    Guard::table($myTasks, $mine, Guard::names('items', $spec));
    check('a renamed collection without its adopted name does not match the digest', false, 'accepted');
} catch (\First\HttpError $e) {
    check('a renamed collection without its adopted name does not match the digest', $e->errorCode === 'existing_table_refused');
}
$adopts('a collection renamed with was still binds its 0.8 table', $myTasks, $mine, Guard::names('items', $spec + ['adoptedAs' => 'myTasks']));
$adopts("a snapshot from before adoptedAs names the stored table (my_tasks), whose key's digest still matches", $myTasks, $mine, Guard::names('items', $spec + ['adoptedAs' => 'my_tasks']));
$adopts('a renamed collection over a cut 0.8 name', $legacyOf('spc_mine', 'aVeryLongTableNameThatTheConverterCutsDownToSize'), $mine,
    Guard::names('short', ['key' => 'short', 'adoptedAs' => 'aVeryLongTableNameThatTheConverterCutsDownToSize']));
// The converter hashes the whole 0.8 name, however long; only the physical name is cut.
$huge = 'items' . str_repeat('X', 70);
$adopts('a 0.8 table name longer than 64 characters still adopts', $legacyOf('spc_mine', $huge), $mine, Guard::names('items', ['key' => 'items', 'adoptedAs' => $huge]));
$refused("another Space's renamed table, whatever names the app gives", $legacyOf('spc_other', 'myTasks'), $mine);
$GLOBALS['GUARD_SPACE'] = '';

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

// A historical adoption is checked on its own: a later migration of the same deploy dropped its
// collection, so no collection binds the table any more.
$GLOBALS['GUARD_SPACE'] = 'spc_mine';
$legacy = $legacyOf('spc_mine', 'myTasks');
$wp->connection()->run("CREATE TABLE `$legacy` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `title` TEXT)");
$wp->connection()->run("INSERT INTO `$legacy` (`title`) VALUES ('kept')");
// The Migrator reads $wpdb->prefix; the Space's sfz_ prefix is set around each run.
$under = static function (string $prefix, callable $fn) use ($wpdb) {
    $was = $wpdb->prefix;
    $wpdb->prefix = $prefix;
    try {
        return $fn();
    } finally {
        $wpdb->prefix = $was;
    }
};
$adoptRecord = static fn (string $table, ?string $name) => '-- first-adopt ' . json_encode(array_filter(['table' => $table, 'name' => $name], static fn ($v) => $v !== null)
    + ['indexes' => [['name' => 'PRIMARY', 'unique' => true, 'columns' => ['id']]], 'foreignKeys' => [], 'integerColumns' => [['name' => 'id', 'unsigned' => true]]])
    . "\nSELECT `id`, `title` FROM `$table` LIMIT 0;";
$history = static function (string $adopt, string $table) use ($dir): void {
    array_map('unlink', glob("$dir/*"));
    file_put_contents("$dir/0001_adopt.sql", $adopt);
    file_put_contents("$dir/0002_update.sql", '-- first-check ' . json_encode(['check' => 'drop', 'name' => 'myTasks', 'table' => $table, 'adopted' => true]) . "\nDROP TABLE `$table`;");
};
$later = $schema; // the blog schema binds no existingTable: the collection is gone
$history($adoptRecord($legacy, 'myTasks'), $legacy);
$wp->connection()->run("DROP TABLE IF EXISTS `{$mine}first__migrations`");
$replay = new Migrator($wp->connection(), $dir, new \First\Schema($later), ['myTasks' => 1]);
try {
    $under($mine, static fn () => $replay->migrate());
    check('an adoption whose collection a later migration drops replays with the drop confirmed', true);
} catch (\Throwable $e) {
    check('an adoption whose collection a later migration drops replays with the drop confirmed', false, $e->getMessage());
}
eq('and both migrations are recorded', $under($mine, static fn () => array_values(array_intersect(['0001_adopt', '0002_update'], $replay->pending()))), []);
eq('the drop ran as confirmed', $wp->connection()->run("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [$legacy]), []);
// The same historical record is still refused for a table no Space or site may bind.
foreach (['wp_users' => 'WordPress users', $sfz('spc_other') . 'users' => "another Space's users", $legacyOf('spc_other', 'myTasks') => "another Space's 0.8 table",
    'wp_first__migrations' => "First's own", 'wp_actionscheduler_actions' => "Action Scheduler's", 'wp_shopusers' => "another install's"] as $table => $what) {
    $history($adoptRecord($table, 'myTasks'), $table);
    $site = $table === 'wp_shopusers' ? 'wp_' : $mine;
    $wp->connection()->run("DROP TABLE IF EXISTS `{$site}first__migrations`");
    $replay = new Migrator($wp->connection(), $dir, new \First\Schema($later), ['myTasks' => 0]);
    problem("a historical adoption of $what's table is still refused", static fn () => $under($site, static fn () => $replay->migrate()), 409, 'existing_table_refused');
}
$wp->connection()->run("DROP TABLE IF EXISTS `{$mine}first__migrations`");
array_map('unlink', glob("$dir/*"));
rmdir($dir);
$GLOBALS['GUARD_SPACE'] = '';

finish('guard');
