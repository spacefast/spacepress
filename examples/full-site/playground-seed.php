<?php
// Sample data for WordPress Playground (docs-site/scripts/build-showcase.ts puts it in the blueprint).
// Three published notes, one with desk notes (shown to staff only), a draft, and three cheers.
require_once '/wordpress/wp-load.php';
// Every write must succeed: a seed that half-ran would show a site that looks broken.
$call = static function (string $method, string $route, array $body): void {
	// The app's API (/__first/api/v1), in process: each call dispatches to the core route as the
	// current user, exactly as an HTTP request to the facade would.
	[$status] = \First\Wp\Facade::route(\First\Wp\Runtime::plugin(), $method, $route, [], (string) wp_json_encode($body));
	if ($status >= 300) {
		throw new RuntimeException("$method $route answered $status");
	}
};
$paragraph = static fn (string $text): string => "<!-- wp:paragraph --><p>$text</p><!-- /wp:paragraph -->";
wp_set_current_user(1);
$first = null;
foreach ([
	['title' => 'Dawn on the ridge', 'dek' => 'Fog lifts off the valley by seven.', 'body' => $paragraph('The path up is wet. The view is worth it.'), 'deskNotes' => 'Check the photo credit before this goes out.'],
	['title' => 'Counting swifts', 'dek' => 'Forty-two over the church tower.', 'body' => $paragraph('They arrive in May and leave in August.')],
	['title' => 'A wet field day', 'dek' => 'Rain all morning, sun by three.', 'body' => $paragraph('The notebook survived. The pencil did not.')],
] as $note) {
	$call('POST', '/notes', $note + ['status' => 'published']);
	$first ??= get_page_by_path(sanitize_title($note['title']), OBJECT, 'first_notes')?->ID;
}
$call('POST', '/notes', ['title' => 'Notes for next week', 'dek' => 'Not ready yet.', 'status' => 'draft']);
// Three cheers on the first note, through the action the page's button calls.
wp_set_current_user(0);
for ($i = 0; $i < 3 && $first !== null; $i++) {
	$call('POST', '/actions/cheer', ['noteId' => $first]);
}
