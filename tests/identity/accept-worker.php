<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Organizations, Failure};

$input = json_decode( stream_get_contents( STDIN ), true, 32, JSON_THROW_ON_ERROR );
$db    = Plugin::$db;
echo $GLOBALS['wpdb']->get_var( 'SELECT CONNECTION_ID()' ), "\n";
fflush( STDOUT );
$r = new WP_REST_Request( 'POST' );
$r->set_body_params( array( 'invitation' => $input['invitation'] ) );
try {
	// As Api::sensitive runs it: one transaction, with earlier plain reads (its snapshot) first.
	$db->transaction(
		function () use ( $db, $r, $input ) {
			$db->rows( "SELECT wp_user_id FROM {$db->prefix}members" );
			return ( new Organizations( $db, Plugin::$security, Plugin::$accounts ) )->handle( 'organizations/accept', 'POST', $r, $input['uid'] );
		}
	);
	echo "joined\n";
} catch ( Failure $e ) {
	echo $e->kind . "\n";
}
