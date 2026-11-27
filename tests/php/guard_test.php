<?php

declare(strict_types=1);

/*
 * SpacePress\Wp\Guard on an in-process WordPress: what "spacepress/server/wp" calls may not touch, whatever name
 * the app builds at runtime (the build refuses literal names with F4301), and which tables an
 * `existingTable` may bind.
 */

use SpacePress\JsObject;
use SpacePress\Wp\Functions;
use SpacePress\Wp\Guard;
use SpacePress\Wp\Migrator;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$wp     = wpSite(
	'guard',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
	)
);
$wp->actAs( 'admin' );
$call = static fn ( string $f, array $args ) => Functions::call( $f, $args );

// An ordinary option of the app's own: written, read, deleted.
eq( 'an app option is written', $call( 'update_option', array( 'guard_app_setting', 'on' ) ), true );
eq( 'and read back', $call( 'get_option', array( 'guard_app_setting' ) ), 'on' );
eq( 'and deleted', $call( 'delete_option', array( 'guard_app_setting' ) ), true );
eq( 'a site setting that holds nothing dangerous is readable', $call( 'get_option', array( 'blogname' ) ), get_option( 'blogname' ) );
// WordPress allows spaces inside a name; only trailing ones are trimmed (and padded by MySQL).
eq( 'an app option with spaces in its name is written', $call( 'update_option', array( 'my app settings', 'on' ) ), true );
eq( 'and read back', $call( 'get_option', array( 'my app settings' ) ), 'on' );
eq( 'and deleted', $call( 'delete_option', array( 'my app settings' ) ), true );

$plugins   = get_option( 'active_plugins' );
$protected = array(
	'active_plugins',
	'active_sitewide_plugins',
	'template',
	'stylesheet',
	'siteurl',
	'home',
	'admin_email',
	'users_can_register',
	'default_role',
	'wp_user_roles',
	'cron',
	'recently_activated',
	'upload_path',
	'upload_url_path',
	'uninstall_plugins',
	'sp_blog_schema',
	'sp__anything',
	'jetpack_active_modules',
	'_site_transient_update_plugins',
	'new_user_0123abcd',
	'adminhash',
	'rewrite_rules',
	'permalink_structure',
	'show_on_front',
	'blog_public',
);
foreach ( $protected as $name ) {
	problem( "update_option refuses $name", static fn () => $call( 'update_option', array( $name, 'x' ) ), 403, 'protected_option' );
	problem( "delete_option refuses $name", static fn () => $call( 'delete_option', array( $name ) ), 403, 'protected_option' );
}
eq( 'the refused writes changed nothing', array( get_option( 'active_plugins' ), get_option( 'default_role' ), get_option( 'users_can_register' ) ), array( $plugins, 'subscriber', '0' ) );
// MySQL compares option_name case-insensitively, ignores trailing spaces, and folds some letters.
foreach ( array( 'Active_Plugins', ' default_role ', "default_role\t", 'DEFAULT_ROLE', "activ\u{e9}_plugins", "default_r\u{f3}le" ) as $name ) {
	problem( 'a spelling MySQL would match is refused: ' . json_encode( $name ), static fn () => $call( 'update_option', array( $name, 'administrator' ) ), 403, 'protected_option' );
}
eq( 'default_role is still subscriber', get_option( 'default_role' ), 'subscriber' );
eq( 'a protected setting that holds no secret is still readable', $call( 'get_option', array( 'template' ) ), get_option( 'template' ) );

update_option( 'jetpack_private_options', array( 'blog_token' => 'tok.secret' ) );
update_option( 'jetpack_secrets', array( 'x' => 'y' ) );
update_option( 'example_api_key', 'k' );
foreach ( array(
	'jetpack_private_options',
	'jetpack_secrets',
	'sp_runtime_secret',
	'sp_identity_signing_keys',
	'auth_key',
	'nonce_salt',
	'secret_key',
	'recovery_keys',
	'example_api_key',
	'mailserver_pass',
	'JETPACK_PRIVATE_OPTIONS',
) as $name ) {
	problem( "get_option refuses the secret $name", static fn () => $call( 'get_option', array( $name ) ), 403, 'protected_option' );
}

// wp_insert_post runs no capability check: a published customize_changeset applies settings with it off.
$changeset = array(
	'post_type'    => 'customize_changeset',
	'post_status'  => 'publish',
	'post_title'   => 'x',
	'post_content' => json_encode( array( 'blogname' => array( 'value' => 'Owned' ) ) ),
);
problem( 'wp_insert_post refuses customize_changeset', static fn () => $call( 'wp_insert_post', array( new JsObject( $changeset ), true ) ), 403, 'protected_post_type' );
foreach ( array( 'wp_template', 'wp_global_styles', 'nav_menu_item', 'sp_posts', 'revision', 'oembed_cache', 'user_request', 'no_such_type' ) as $type ) {
	problem(
		"wp_insert_post refuses post_type $type",
		static fn () => $call(
			'wp_insert_post',
			array(
				new JsObject(
					array(
						'post_type'  => $type,
						'post_title' => 'x',
					)
				),
				true,
			)
		),
		403,
		'protected_post_type'
	);
}
eq( 'blogname kept', get_option( 'blogname' ) !== 'Owned', true );
$id = $call(
	'wp_insert_post',
	array(
		new JsObject(
			array(
				'post_title'  => 'Plain',
				'post_status' => 'draft',
			)
		),
		true,
	)
);
eq( 'a plain post is inserted', is_int( $id ) && $id > 0, true );
eq(
	'a page is inserted',
	is_int(
		$call(
			'wp_insert_post',
			array(
				new JsObject(
					array(
						'post_title' => 'Page',
						'post_type'  => 'page',
					)
				),
				true,
			)
		)
	),
	true
);
// A field the catalog's type doesn't declare (JSON.parse keeps it): ID would overwrite that post,
// a SpacePress kind's included, and turn it into a `post`.
$kind = wp_insert_post(
	array(
		'post_type'   => 'sp_posts',
		'post_status' => 'publish',
		'post_title'  => 'Kept',
	)
);
foreach ( array(
	'ID'         => $kind,
	'import_id'  => $kind + 1000,
	'meta_input' => array( '_edit_lock' => 'x' ),
	'tax_input'  => array( 'category' => array( 1 ) ),
	'post_date'  => '2001-01-01 00:00:00',
) as $field => $value ) {
	problem(
		"wp_insert_post refuses the field $field",
		static fn () => $call(
			'wp_insert_post',
			array(
				new JsObject(
					array(
						'post_title' => 'overwritten',
						$field       => $value,
					)
				),
				true,
			)
		),
		403,
		'protected_post_field'
	);
}
// A string is parsed by WordPress as a query string, so it would carry any field: refused.
foreach ( array( 'ID=' . $kind . '&post_title=overwritten', 'post_type=customize_changeset&post_status=publish', 42 ) as $raw ) {
	problem( 'wp_insert_post refuses a non-object ' . json_encode( $raw ), static fn () => $call( 'wp_insert_post', array( $raw, true ) ), 403, 'protected_post_field' );
}
eq( 'the SpacePress post is untouched', array( get_post_type( $kind ), get_the_title( $kind ) ), array( 'sp_posts', 'Kept' ) );

// existingTable: this site's prefix (wp_ here), never WordPress's, SpacePress's or Action Scheduler's own.
$refused = static function ( string $label, string $table, string $prefix ) {
	try {
		Guard::table( $table, $prefix );
		check( $label, false, 'accepted' );
	} catch ( \SpacePress\HttpError $e ) {
		check( $label, 'existing_table_refused' === $e->errorCode, $e->getMessage() );
	}
};
$allowed = static function ( string $label, string $table, string $prefix ) {
	try {
		Guard::table( $table, $prefix );
		check( $label, true );
	} catch ( \SpacePress\HttpError $e ) {
		check( $label, false, $e->getMessage() );
	}
};
$allowed( 'a table under the site prefix', 'wp_legacy_orders', 'wp_' );
foreach ( array( 'wp_users', 'wp_usermeta', 'WP_Options', 'wp_posts', 'wp_sp_posts', 'wp_sp__migrations', 'wp_actionscheduler_actions', 'wp_2_posts' ) as $t ) {
	$refused( "$t is refused", $t, 'wp_' );
}
$refused( 'another prefix is refused', 'other_orders', 'wp_' );
// A longer prefix that starts with this one is another site in the same database.
$wp->connection()->run( 'CREATE TABLE wp_other_options (option_id INTEGER PRIMARY KEY, option_name VARCHAR(191), option_value LONGTEXT, autoload VARCHAR(20))' );
$wp->connection()->run( 'CREATE TABLE wp_other_users (ID INTEGER PRIMARY KEY)' );
$refused( 'a table under a longer prefix that has its own options table is refused', 'wp_other_users', 'wp_' );
$allowed( 'a table without such a site beside it is not', 'wp_otherthing_rows', 'wp_' );
// A prefix need not end in `_`: an install prefixed `wp_shop` has wp_shopusers and wp_shopoptions.
$wp->connection()->run( 'CREATE TABLE wp_shopoptions (option_id INTEGER PRIMARY KEY, option_name VARCHAR(191), option_value LONGTEXT, autoload VARCHAR(20))' );
$wp->connection()->run( 'CREATE TABLE wp_shopusers (ID INTEGER PRIMARY KEY)' );
$refused( 'a longer prefix without a trailing _ is another site: its users', 'wp_shopusers', 'wp_' );
$refused( 'and its options', 'wp_shopoptions', 'wp_' );
$refused( 'and any of its tables, whatever the case', 'WP_ShopOrders', 'wp_' );
$allowed( 'a name that only shares the start of that prefix is not under it', 'wp_shoes', 'wp_' );
// A plugin's own `…options` table without WordPress's options columns is not another site.
$wp->connection()->run( 'CREATE TABLE wp_myplugin_options (id INTEGER PRIMARY KEY, label TEXT)' );
$allowed( "a plugin's own options table is an app table", 'wp_myplugin_options', 'wp_' );
$allowed( 'and so are the tables beside it', 'wp_myplugin_rows', 'wp_' );
// CUSTOM_USER_TABLE and CUSTOM_USER_META_TABLE rename WordPress's users tables.
global $wpdb;
[$users, $usermeta]             = array( $wpdb->users, $wpdb->usermeta );
[$wpdb->users, $wpdb->usermeta] = array( 'wp_accounts', 'shared_accountmeta' );
$refused( 'a renamed users table is refused', 'wp_accounts', 'wp_' );
$refused( 'in any case', 'WP_Accounts', 'wp_' );
$refused( 'a renamed usermeta table outside the prefix is refused', 'shared_accountmeta', 'wp_' );
[$wpdb->users, $wpdb->usermeta] = array( $users, $usermeta );
$allowed( 'the name is an app table again once WordPress no longer uses it', 'wp_accounts', 'wp_' );
foreach ( array( 'wp_sp_identity_accounts', 'wp_identity_sessions', 'wp_wc_orders', 'wp_woocommerce_sessions' ) as $t ) {
	$refused( "$t is refused", $t, 'wp_' );
}

$mine = 'guard_';
$refused( 'a table outside the site prefix cannot be adopted', 'external_tasks', $mine );

// The migrator refuses an unchecked binding before it reads the table or writes the ledger.
$write_mig = static function ( string $root, string $id, string $sql ): void {
	@mkdir( "$root/$id", 0777, true );
	file_put_contents( "$root/$id/migration.sql", $sql );
};
$clear_dir = static function ( string $root ): void {
	foreach ( glob( "$root/*" ) ?: array() as $entry ) {
		if ( is_dir( $entry ) ) {
			foreach ( glob( "$entry/*" ) ?: array() as $f ) {
				@unlink( $f );
			}
			@rmdir( $entry );
		} else {
			@unlink( $entry );
		}
	}
};
$bad       = $schema;
$bad['collections']['comments']['existingTable'] = 'wp_users';
$dir = sys_get_temp_dir() . '/spacepress-guard-' . getmypid();
@mkdir( $dir );
$write_mig( $dir, '20261121180000_aaaaaa_adopt', "-- spacepress-adopt {\"table\":\"wp_users\",\"indexes\":[],\"foreignKeys\":[],\"integerColumns\":[]}\nSELECT `ID` FROM `wp_users` LIMIT 0;" );
$migrator = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $bad ) );
problem( 'the migrator refuses an existingTable of WordPress users', static fn () => $migrator->migrate(), 409, 'existing_table_refused' );
eq( 'and records nothing', in_array( '20261121180000_aaaaaa_adopt', $migrator->pending(), true ), true );
problem( 'planning the deploy refuses it the same way, before the schema check reads it', static fn () => $migrator->plan(), 409, 'existing_table_refused' );
// A historical adoption record is refused by plan() too, with no collection binding the table.
$historical = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $schema ) );
problem( 'planning refuses a historical adoption of WordPress users', static fn () => $historical->plan(), 409, 'existing_table_refused' );
problem( 'marking a step of it applied is refused before the ledger is touched', static fn () => $historical->markApplied( '20261121180000_aaaaaa_adopt:1' ), 409, 'existing_table_refused' );
eq( 'and the step is still pending', in_array( '20261121180000_aaaaaa_adopt', $historical->pending(), true ), true );
// The site's read-only inspection returns the refusal instead of throwing: a copy of the plugin
// whose app directory holds the historical adoption of wp_users.
$plugin = ( new \ReflectionClass( \SpacePress\Wp\Plugin::class ) )->newInstanceWithoutConstructor();
$app    = sys_get_temp_dir() . '/spacepress-guard-app-' . getmypid();
@mkdir( "$app/sp/app", 0777, true );
@symlink( $dir, "$app/sp/app/migrations" );
( function () use ( $app, $schema ) {
	$this->dir    = $app;
	$this->schema = new \SpacePress\Schema( $schema );
} )->call( $plugin );
try {
	$report = $plugin->inspect();
	check( 'inspect reports an existingTable refusal instead of throwing', in_array( 'existing_table_refused', array_column( $report['refusals'], 'code' ), true ), $report['refusals'] );
} catch ( \Throwable $e ) {
	check( 'inspect reports an existingTable refusal instead of throwing', false, get_class( $e ) . ': ' . $e->getMessage() );
}
unlink( "$app/sp/app/migrations" );
rmdir( "$app/sp/app" );
rmdir( "$app/sp" );
rmdir( $app );
$clear_dir( $dir );

// A historical adoption is checked on its own: a later migration of the same deploy retired its
// collection, so no collection binds the table any more.
$imported = 'guard_imported_tasks';
$wp->connection()->run( "CREATE TABLE `$imported` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `title` TEXT)" );
$wp->connection()->run( "INSERT INTO `$imported` (`title`) VALUES ('kept')" );
// The Migrator reads $wpdb->prefix; the Space's sfz_ prefix is set around each run.
$under        = static function ( string $prefix, callable $fn ) use ( $wpdb ) {
	$was          = $wpdb->prefix;
	$wpdb->prefix = $prefix;
	try {
		return $fn();
	} finally {
		$wpdb->prefix = $was;
	}
};
$adopt_record = static fn ( string $table, ?string $name ) => '-- spacepress-adopt ' . json_encode(
	array_filter(
		array(
			'table' => $table,
			'name'  => $name,
		),
		static fn ( $v ) => null !== $v
	)
	+ array(
		'indexes'        => array(
			array(
				'name'    => 'PRIMARY',
				'unique'  => true,
				'columns' => array( 'id' ),
			),
		),
		'foreignKeys'    => array(),
		'integerColumns' => array(
			array(
				'name'     => 'id',
				'unsigned' => true,
			),
		),
	)
)
	. "\nSELECT `id`, `title` FROM `$table` LIMIT 0;";
$history      = static function ( string $adopt, string $table ) use ( $dir, $clear_dir, $write_mig ): void {
	$clear_dir( $dir );
	$write_mig( $dir, '20261121180000_aaaaaa_adopt', $adopt );
	$write_mig( $dir, '20261121180001_bbbbbb_retire', "-- retiring table \"$table\" (data preserved; forward-only)\n" );
};
$later        = $schema; // the blog schema binds no existingTable: the collection is gone
$history( $adopt_record( $imported, 'myTasks' ), $imported );
$wp->connection()->run( "DROP TABLE IF EXISTS `{$mine}sp__migrations`" );
$replay = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $later ) );
try {
	$under( $mine, static fn () => $replay->migrate() );
	check( 'an adoption whose collection a later migration retires replays cleanly', true );
} catch ( \Throwable $e ) {
	check( 'an adoption whose collection a later migration retires replays cleanly', false, $e->getMessage() );
}
eq( 'and both migrations are recorded', $under( $mine, static fn () => array_values( array_intersect( array( '20261121180000_aaaaaa_adopt', '20261121180001_bbbbbb_retire' ), $replay->pending() ) ) ), array() );
eq( 'and the retired table data stays intact (forward-only)', $wp->connection()->run( "SELECT `title` FROM `$imported`" ), array( array( 'title' => 'kept' ) ) );
// The same historical record is still refused for a table no Space or site may bind.
foreach ( array(
	'wp_users'                   => 'WordPress users',
	'other_users'                => "another site's users",
	'other_tasks'                => "another site's custom table",
	'wp_sp__migrations'          => "SpacePress's own",
	'wp_actionscheduler_actions' => "Action Scheduler's",
	'wp_shopusers'               => "another install's",
) as $table => $what ) {
	$history( $adopt_record( $table, 'myTasks' ), $table );
	$site = 'wp_shopusers' === $table ? 'wp_' : $mine;
	$wp->connection()->run( "DROP TABLE IF EXISTS `{$site}sp__migrations`" );
	$replay = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $later ) );
	problem( "a historical adoption of $what's table is still refused", static fn () => $under( $site, static fn () => $replay->migrate() ), 409, 'existing_table_refused' );
}
$wp->connection()->run( "DROP TABLE IF EXISTS `{$mine}sp__migrations`" );

// Core forward-only guard refuses DROP TABLE even if hand-edited into a migration file.
$wp->connection()->run( "CREATE TABLE IF NOT EXISTS `$imported` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `title` TEXT)" );
$clear_dir( $dir );
$write_mig( $dir, '20261121180000_aaaaaa_adopt', $adopt_record( $imported, 'myTasks' ) );
$write_mig( $dir, '20261121180001_bbbbbb_drop', "DROP TABLE `$imported`;" );
$wp->connection()->run( "DROP TABLE IF EXISTS `{$mine}sp__migrations`" );
$drop_migrator = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $later ) );
try {
	$under( $mine, static fn () => $drop_migrator->migrate() );
	check( 'core migrator refuses DROP TABLE in a schema migration', false, 'accepted' );
} catch ( \RuntimeException $e ) {
	check( 'core migrator refuses DROP TABLE in a schema migration', str_contains( $e->getMessage(), 'forward-only' ), $e->getMessage() );
}
$wp->connection()->run( "DROP TABLE IF EXISTS `{$mine}sp__migrations`" );
$wp->connection()->run( "DROP TABLE IF EXISTS `$imported`" );

// An adoption an earlier runtime applied, whose collection is gone, is checked again before any later
// statement touches its table: a ledger that recorded `20261121180000_aaaaaa_adopt` of wp_users can't alter wp_users.
$wp->connection()->run( 'DROP TABLE IF EXISTS wp_sp__migrations' );
$clear_dir( $dir );
$write_mig( $dir, '20261121180000_aaaaaa_adopt', $adopt_record( 'wp_users', 'members' ) );
$write_mig( $dir, '20261121180001_bbbbbb_alter', 'ALTER TABLE `wp_users` ADD COLUMN `note` TEXT NULL;' );
$migrator = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $later ) );
$wp->connection()->run( 'CREATE TABLE wp_sp__migrations (`app` VARCHAR(191) NOT NULL, `id` VARCHAR(191) NOT NULL, `kind` VARCHAR(32) NOT NULL DEFAULT \'schema\', `applied_at` CHAR(24) NOT NULL, `sql` CHAR(64) NULL, `actor` VARCHAR(191) NULL, `reason` TEXT NULL, `rows_affected` BIGINT UNSIGNED NULL, PRIMARY KEY (`app`, `id`))' );
$wp->connection()->run( 'INSERT INTO wp_sp__migrations (`app`, `id`, `kind`, `applied_at`) VALUES (?, ?, ?, ?)', array( ( new \SpacePress\Schema( $later ) )->name(), '20261121180000_aaaaaa_adopt', 'schema', '2026-01-01T00:00:00.000Z' ) );
problem( 'planning an alter of a table adopted earlier re-checks that adoption', static fn () => $migrator->plan(), 409, 'existing_table_refused' );
problem( 'and so does applying it', static fn () => $migrator->migrate(), 409, 'existing_table_refused' );
eq( 'wp_users is still there', (int) $wp->connection()->run( 'SELECT COUNT(*) AS n FROM wp_users' )[0]['n'] > 0, true );
$wp->connection()->run( 'DROP TABLE IF EXISTS wp_sp__migrations' );

// plan() checks an adoption against the live table as migrate() does: a declared index the table
// lacks is a refusal at plan time, not a successful plan that then fails to apply.
$wp->connection()->run( 'CREATE TABLE wp_legacy_notes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, `title` TEXT)' );
$clear_dir( $dir );
$write_mig(
	$dir,
	'20261121180000_aaaaaa_adopt',
	'-- spacepress-adopt ' . json_encode(
		array(
			'table'          => 'wp_legacy_notes',
			'name'           => 'notes',
			'indexes'        => array(
				array(
					'name'    => 'PRIMARY',
					'unique'  => true,
					'columns' => array( 'id' ),
				),
				array(
					'name'    => 'by_title',
					'unique'  => false,
					'columns' => array( 'title' ),
				),
			),
			'foreignKeys'    => array(),
			'integerColumns' => array(
				array(
					'name'     => 'id',
					'unsigned' => true,
				),
			),
		)
	) . "\nSELECT `id`, `title` FROM `wp_legacy_notes` LIMIT 0;"
);
$notes = $schema;
$notes['collections']['comments']['existingTable'] = 'wp_legacy_notes';
$planner = new Migrator( $wp->connection(), $dir, new \SpacePress\Schema( $notes ) );
problem( 'plan() refuses an adoption whose declared index the table lacks', static fn () => $planner->plan(), 409, 'schema_refused' );
$write_mig(
	$dir,
	'20261121180000_aaaaaa_adopt',
	'-- spacepress-adopt ' . json_encode(
		array(
			'table'          => 'wp_legacy_notes',
			'name'           => 'notes',
			'indexes'        => array(
				array(
					'name'    => 'PRIMARY',
					'unique'  => true,
					'columns' => array( 'id' ),
				),
			),
			'foreignKeys'    => array(),
			'integerColumns' => array(
				array(
					'name'     => 'id',
					'unsigned' => true,
				),
			),
		)
	)
	. "\nSELECT `id`, `missing` FROM `wp_legacy_notes` LIMIT 0;"
);
problem( 'and one whose declared column the table lacks', static fn () => $planner->plan(), 409, 'schema_refused' );
$clear_dir( $dir );
rmdir( $dir );

finish( 'guard' );
