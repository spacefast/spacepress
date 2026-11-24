<?php
// Sample data for WordPress Playground, written through the app's own API as the admin.
require_once '/wordpress/wp-load.php';
wp_set_current_user( 1 );
foreach ( array( 'Write the schema', 'Add a page', 'Press Run in WordPress' ) as $title ) {
	[$status] = \SpacePress\Wp\Facade::route( \SpacePress\Wp\Runtime::plugin(), 'POST', '/tasks', array(), (string) wp_json_encode( array( 'title' => $title ) ) );
	if ( $status >= 300 ) {
		throw new RuntimeException( "POST /tasks answered $status" );
	}
}
\SpacePress\Wp\Facade::route(
	\SpacePress\Wp\Runtime::plugin(),
	'POST',
	'/actions/setDone',
	array(),
	(string) wp_json_encode(
		array(
			'id'   => 1,
			'done' => true,
		)
	)
);
