<?php
// `wp eval` fixture for plugin.test.ts: two apps' generated uninstall.php run in one PHP request,
// as `wp plugin uninstall app-a app-b` does. Copies the blog's built uninstaller next to two stub
// schema.php files ("alpha", "beta"), grants each app's derived capability plus one WordPress never
// derives, and schedules an action per app plus a stranger's. Runs both uninstallers and prints which
// capabilities remain on the editor role and each action's status. Cleans up after.
// (uninstall.php runs in this scope and uses names like $role, $caps, $actions; these use fx_.)
declare(strict_types=1);

global $wpdb;

$fx_built   = WP_PLUGIN_DIR . '/spacepress-app-blog/uninstall.php';
$fx_root    = sys_get_temp_dir() . '/spacepress-two-uninstall-' . bin2hex( random_bytes( 4 ) );
$fx_granted = array( 'edit_others_sp_alpha', 'edit_others_sp_beta', 'create_sp_alpha' );
$fx_actions = array(
	'alpha' => as_schedule_single_action( time() + 3600, 'sp_job', array( 'id' => 'alpha-left' ), 'spacepress-alpha' ),
	'beta'  => as_schedule_single_action( time() + 3600, 'sp_job', array( 'id' => 'beta-left' ), 'spacepress-beta' ),
	'other' => as_schedule_single_action( time() + 3600, 'not_zero', array(), 'someone-else' ),
);
foreach ( $fx_granted as $fx_cap ) {
	get_role( 'editor' )->add_cap( $fx_cap );
}
$fx_ran = array();
try {
	foreach ( array( 'alpha', 'beta' ) as $fx_app ) {
		mkdir( "$fx_root/$fx_app/sp/app", 0777, true );
		copy( $fx_built, "$fx_root/$fx_app/uninstall.php" );
		file_put_contents(
			"$fx_root/$fx_app/sp/app/schema.php",
			'<?php return ' . var_export(
				array(
					'name'        => $fx_app,
					'jobs'        => array(),
					'collections' => array(
						$fx_app => array(
							'editor' => true,
							'wp'     => array( 'postType' => "sp_$fx_app" ),
						),
					),
				),
				true
			) . ';'
		);
	}
	if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
		define( 'WP_UNINSTALL_PLUGIN', 'spacepress-app-alpha/spacepress-app-alpha.php' );
	}
	foreach ( array( 'alpha', 'beta' ) as $fx_app ) {
		include "$fx_root/$fx_app/uninstall.php";
		$fx_ran[] = $fx_app;
	}
	$fx_editor   = get_role( 'editor' );
	$fx_left     = array_values( array_filter( $fx_granted, static fn ( string $cap ): bool => $fx_editor->has_cap( $cap ) ) );
	$fx_statuses = array_map( static fn ( int $id ): string => (string) $wpdb->get_var( $wpdb->prepare( "SELECT status FROM {$wpdb->prefix}actionscheduler_actions WHERE action_id = %d", $id ) ), $fx_actions );
} finally {
	foreach ( $fx_granted as $fx_cap ) {
		get_role( 'editor' )->remove_cap( $fx_cap );
	}
	foreach ( array( 'alpha', 'beta' ) as $fx_app ) {
		@unlink( "$fx_root/$fx_app/sp/app/schema.php" );
		@unlink( "$fx_root/$fx_app/uninstall.php" );
		@rmdir( "$fx_root/$fx_app/sp/app" );
		@rmdir( "$fx_root/$fx_app/sp" );
		@rmdir( "$fx_root/$fx_app" );
	}
	@rmdir( $fx_root );
}
as_unschedule_all_actions( 'not_zero' );
as_unschedule_all_actions( 'sp_job', array( 'id' => 'alpha-left' ), 'spacepress-alpha' );
as_unschedule_all_actions( 'sp_job', array( 'id' => 'beta-left' ), 'spacepress-beta' );
echo wp_json_encode(
	array(
		'ran'     => $fx_ran,
		'left'    => $fx_left,
		'actions' => $fx_statuses,
	)
);
