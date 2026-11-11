// The examples the site shows. Each one compiles, does one job, and is short enough to read whole.
// Every page shows the example's files and every file `first build` writes for it. The rest of
// examples/ are test harnesses, long demos, or migration work, and stay in the repository.
// `landing` is the page WordPress Playground opens. `seed`, if set, is PHP that runs after the
// plugins activate: sample data written through the app's own REST API as the admin, so access
// rules, hooks and jobs run as they would for a real request.
const readingListSeed = `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
$call = static function (string $method, string $route, array $body): int {
\t$request = new WP_REST_Request($method, $route);
\t$request->set_header('content-type', 'application/json');
\t$request->set_body(wp_json_encode($body));
\treturn rest_do_request($request)->get_status();
};
foreach (['The Left Hand of Darkness' => 25, 'A Wizard of Earthsea' => 45, 'The Dispossessed' => 65] as $title => $minutes) {
\t$call('POST', '/first/v1/books', ['title' => $title, 'status' => 'published']);
\t$book = get_page_by_path(sanitize_title($title), OBJECT, 'first_books');
\tif ($book) $call('POST', '/first/v1/actions/logRead', ['bookId' => $book->ID, 'minutes' => $minutes]);
}
// The tally jobs run now, as WP-Cron would on a later request.
foreach (as_get_scheduled_actions(['hook' => 'first_job', 'status' => ActionScheduler_Store::STATUS_PENDING, 'per_page' => 20], 'ids') as $id) {
\tActionScheduler::runner()->process_action($id, 'first-playground');
}
`;

// Pantry: two places and a few items. Milk drops to its low-stock mark when consumed, so the hook
// puts it on the shopping list and queues the notification job.
const pantrySeed = `<?php
require_once '/wordpress/wp-load.php';
wp_set_current_user(1);
$call = static function (string $method, string $route, array $body): array {
\t$request = new WP_REST_Request($method, $route);
\t$request->set_header('content-type', 'application/json');
\t$request->set_body(wp_json_encode($body));
\t$response = rest_do_request($request);
\t// First's REST responses carry the body as JSON text; WordPress's own carry data.
\treturn json_decode((string) wp_json_encode($response->get_data()), true) ?: [];
};
$call('POST', '/first/v1/locations', ['name' => 'Fridge', 'kind' => 'fridge']);
$call('POST', '/first/v1/locations', ['name' => 'Shelf', 'kind' => 'pantry']);
foreach ([['Milk', 2, 'l', 1], ['Rice', 2, 'kg', 2], ['Eggs', 12, 'pcs', 1]] as [$name, $quantity, $unit, $where]) {
\t$call('POST', '/first/v1/items', ['name' => $name, 'quantity' => $quantity, 'unit' => $unit, 'locationId' => $where, 'lowStockAt' => 1]);
}
$call('POST', '/first/v1/actions/consume', ['itemId' => 1, 'amount' => 1]);
foreach (as_get_scheduled_actions(['hook' => 'first_job', 'status' => ActionScheduler_Store::STATUS_PENDING, 'per_page' => 20], 'ids') as $id) {
\tActionScheduler::runner()->process_action($id, 'first-playground');
}
`;

// Kitchen sink: Polylang sends a new site to its setup wizard; the app's languages are already set,
// so skip it and open the dashboard.
const kitchenSinkSeed = `<?php
require_once '/wordpress/wp-load.php';
delete_transient('pll_activation_redirect');
`;

export const siteExamples = [
  { name: "reading-list", title: "Reading list", summary: "Each part of an app once: a collection, a table, owner-only access, hooks, an action, a job, a public route and two npm packages compiled to PHP.", landing: "/wp-admin/edit.php?post_type=first_books", seed: readingListSeed },
  { name: "pantry", title: "Pantry", summary: "Plain SQL tables with relations, a hook that keeps a shopping list, actions and a background job.", landing: "/wp-json/first/v1/shopping_list", seed: pantrySeed },
  { name: "kitchen-sink", title: "Kitchen sink", summary: "WordPress posts and users, settings, custom fields, media, translations, hooks and jobs in one config.", landing: "/wp-admin/edit.php?post_type=first_pages", seed: kitchenSinkSeed },
  { name: "recipes", title: "Reusable fields", summary: "A field set defined once in a TypeScript file and spread into a collection.", landing: "/wp-admin/post-new.php?post_type=first_articles", seed: undefined },
  { name: "wp-plugins", title: "WordPress plugins", summary: "Pin a plugin from WordPress.org, and First installs that version with the app.", landing: "/wp-admin/plugins.php", seed: undefined },
] as const;
