<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit; }
// Only this example's own records/options are removed. Published SpacePress stories are retained.
foreach ( array( 'zpl_event', 'zpl_delivery', 'zpl_form', 'zpl_submit' ) as $type ) {
	foreach ( get_posts(
		array(
			'post_type'   => $type,
			'post_status' => 'any',
			'numberposts' => -1,
		)
	) as $post ) {
		wp_delete_post( $post->ID, true ); }
}
global $wpdb;
$names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'sp_plugins_' ) . '%' ) );
foreach ( $names as $name ) {
	delete_option( $name ); }
if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'sp_plugins_deliver', array(), 'spacepress-official-plugins' );
	as_unschedule_all_actions( 'sp_plugins_diagnostic', array(), 'spacepress-official-plugins' );
}
