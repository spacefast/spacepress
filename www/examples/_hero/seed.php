<?php
// Sample data for WordPress Playground, written through the app's own API as the admin.
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
foreach (['Write the schema', 'Add a page', 'Press Run in WordPress'] as $title) {
	[$status] = \TypedPress\Wp\Facade::route(\TypedPress\Wp\Runtime::plugin(), 'POST', '/tasks', [], (string) wp_json_encode(['title' => $title]));
	if ($status >= 300) {
		throw new RuntimeException("POST /tasks answered $status");
	}
}
\TypedPress\Wp\Facade::route(\TypedPress\Wp\Runtime::plugin(), 'POST', '/actions/finish', [], (string) wp_json_encode(['id' => 1]));
