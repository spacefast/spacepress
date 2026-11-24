<?php
declare(strict_types=1);
require_once '/tmp/spacepress-import/bootstrap.php';
$plugin  = \SpacePress\Wp\Runtime::plugin();
$schema  = new \SpacePress\Schema( require '/tmp/spacepress-native-posts-schema.php' );
$native  = wp_insert_post(
	array(
		'post_type'    => 'post',
		'post_status'  => 'publish',
		'post_title'   => 'Retained native title',
		'post_content' => '<p>Retained body</p>',
	)
);
$foreign = wp_insert_post(
	array(
		'post_type'   => 'post',
		'post_status' => 'publish',
		'post_title'  => 'Other Space',
	)
);
add_post_meta( $native, '_spacefast_space_id', 'native-space' );
add_post_meta( $foreign, '_spacefast_space_id', 'other-space' );
$migrate              = new \SpacePress\Wp\Legacy\Migrate( $plugin->connection(), $schema );
$release              = require '/tmp/spacepress-legacy-release.php';
$release['postTypes'] = array_values( array_filter( $release['postTypes'], static fn ( $p ) => 'collection' !== $p['kind'] ) );
$run                  = static fn ( bool $dry ) => $plugin->connection()->transaction( static fn () => $migrate->run( $release, $dry, 'native-space' ) );
$dry                  = $run( true );
if ( $dry['collections']['posts']['records'] !== array( $native ) || get_post_type( $native ) !== 'post' ) {
	throw new RuntimeException( 'native dry run changed rows' ); }
$done = $run( false );
clean_post_cache( $native );
if ( $done['collections']['posts']['records'] !== array( $native ) || get_post_type( $native ) !== 'sp_posts' || get_post_field( 'post_content', $native ) !== '<p>Retained body</p>' || get_post_type( $foreign ) !== 'post' ) {
	throw new RuntimeException( 'native adoption lost IDs, body or Space fence' ); }
if ( array() !== $run( false )['collections']['posts']['records'] ) {
	throw new RuntimeException( 'native adoption is not idempotent' ); }
echo "native posts proof: IDs, body and Space fence retained; dry run and second run change nothing\n";
