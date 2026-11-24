<?php
// A guest with Bearer tokens for app_identity_flow, as the SpacePress runtime would mint (flow.test.ts).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security};

ob_start();
add_role( 'sp_guest', 'Guest', array( 'read' => true ) );
$guest = wp_insert_user(
	array(
		'user_login' => 'zf_' . bin2hex( random_bytes( 4 ) ),
		'user_pass'  => Security::token(),
		'role'       => 'sp_guest',
	)
);
do_action( 'sp_runtime_loaded' );
$tokens = Plugin::$accounts->issueForUser( $guest, 'app_identity_flow' );
ob_end_clean();
echo json_encode( $tokens + array( 'uid' => $guest ) );
