<?php
// Sample data for WordPress Playground (docs-site/scripts/build-showcase.ts puts it in the blueprint).
// The posts in content/posts/ are already on the site: the blueprint seeds them first, as
// `wp first seed` does, so hello-first is published and typed-content-plain-files is a draft, as
// their files say. This adds an author, one more published post, three comments and the settings,
// through the app's own REST API, so access rules, hooks and jobs run as for a real request.
// A cron request, as WP-Cron's: Polylang and First set up the app's languages for it, which a
// bare wp-load.php request doesn't get.
define('DOING_CRON', true);
require_once '/wordpress/wp-load.php';
// Polylang sends a new site to its setup wizard. The app's languages are already set, so skip it.
delete_transient('pll_activation_redirect');
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
wp_set_current_user(1);
$call('PATCH', '/first/v1/globals/settings', ['siteTitle' => 'Field Guide', 'tagline' => 'Notes on building with First.']);
$call('POST', '/first/v1/authors', ['name' => 'Ada Admin', 'email' => 'ada@example.com', 'bio' => 'Writes the posts here.', 'userId' => 1]);
// The posts hook fills in the author from the signed-in user.
$call('POST', '/first/v1/posts', ['title' => 'Comments are moderated', 'locale' => 'en', 'status' => 'published', 'tags' => ['guide'], 'body' => '<!-- wp:paragraph --><p>A comment from a reader waits for an editor. Staff comments go up at once.</p><!-- /wp:paragraph -->']);
$hello = get_page_by_path('hello-first', OBJECT, 'first_posts');
if ($hello) {
	// Staff comments are approved by the afterCreate hook.
	$call('POST', '/first/v1/comments', ['postId' => $hello->ID, 'name' => 'Ada Admin', 'body' => 'Welcome, everyone.']);
	$call('POST', '/first/v1/comments', ['postId' => $hello->ID, 'name' => 'Ada Admin', 'body' => 'Edit content/posts/hello-first.md to change this post.']);
	// A reader's comment stays unapproved, and the notifyEditors job stamps it.
	wp_set_current_user(0);
	$call('POST', '/first/v1/comments', ['postId' => $hello->ID, 'name' => 'A reader', 'body' => 'Can I write posts in Markdown too?']);
	wp_set_current_user(1);
}
// Queued jobs run now, as WP-Cron would on a later request. The webhook jobs fail and back off:
// BLOG_HOOK_URL is not set here, so there is nowhere to deliver to.
foreach (as_get_scheduled_actions(['hook' => 'first_job', 'status' => ActionScheduler_Store::STATUS_PENDING, 'per_page' => 50], 'ids') as $id) {
	ActionScheduler::runner()->process_action($id, 'first-playground');
}
