<?php
// Sample data for WordPress Playground (www/scripts/build-showcase.ts puts it in the blueprint).
// Written through the app's own API as the admin, so access rules, hooks and jobs run as they
// would for a real request.
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
// Every write must succeed: a seed that half-ran would show a site that looks broken.
$call = static function (string $method, string $route, array $body): void {
	// The app's API (/wp-json/spacepress/v1), in process: each call dispatches to the core route as the
	// current user, exactly as an HTTP request to the facade would.
	[$status] = \SpacePress\Wp\Facade::route(\SpacePress\Wp\Runtime::plugin(), $method, $route, [], (string) wp_json_encode($body));
	if ($status >= 300) {
		throw new RuntimeException("$method $route answered $status");
	}
};
foreach (['The Left Hand of Darkness' => 25, 'A Wizard of Earthsea' => 45, 'The Dispossessed' => 65] as $title => $minutes) {
	$call('POST', '/books', ['title' => $title, 'status' => 'published']);
	$book = get_page_by_path(sanitize_title($title), OBJECT, 'sp_books');
	if ($book) $call('POST', '/actions/logRead', ['bookId' => $book->ID, 'minutes' => $minutes]);
}
// A draft: books are WordPress posts, so they have drafts.
$call('POST', '/books', ['title' => 'The Lathe of Heaven', 'status' => 'draft']);
// The tally jobs run now, as WP-Cron would on a later request.
foreach (as_get_scheduled_actions(['hook' => 'sp_job', 'status' => ActionScheduler_Store::STATUS_PENDING, 'per_page' => 20], 'ids') as $id) {
	ActionScheduler::runner()->process_action($id, 'spacepress-playground');
}
