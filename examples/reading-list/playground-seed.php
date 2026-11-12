<?php
// Sample data for WordPress Playground (docs-site/scripts/build-showcase.ts puts it in the blueprint).
// Written through the app's own REST API as the admin, so access rules, hooks and jobs run as they
// would for a real request.
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
// Every write must succeed: a seed that half-ran would show a site that looks broken.
$call = static function (string $method, string $route, array $body): void {
	$request = new WP_REST_Request($method, $route);
	$request->set_header('content-type', 'application/json');
	$request->set_body(wp_json_encode($body));
	$response = rest_do_request($request);
	if ($response->get_status() >= 300) {
		throw new RuntimeException("$method $route answered {$response->get_status()}");
	}
};
foreach (['The Left Hand of Darkness' => 25, 'A Wizard of Earthsea' => 45, 'The Dispossessed' => 65] as $title => $minutes) {
	$call('POST', '/first/v1/books', ['title' => $title, 'status' => 'published']);
	$book = get_page_by_path(sanitize_title($title), OBJECT, 'first_books');
	if ($book) $call('POST', '/first/v1/actions/logRead', ['bookId' => $book->ID, 'minutes' => $minutes]);
}
// A draft: books are WordPress posts, so they have drafts.
$call('POST', '/first/v1/books', ['title' => 'The Lathe of Heaven', 'status' => 'draft']);
// The tally jobs run now, as WP-Cron would on a later request.
foreach (as_get_scheduled_actions(['hook' => 'first_job', 'status' => ActionScheduler_Store::STATUS_PENDING, 'per_page' => 20], 'ids') as $id) {
	ActionScheduler::runner()->process_action($id, 'first-playground');
}
