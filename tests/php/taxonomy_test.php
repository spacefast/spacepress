<?php

declare(strict_types=1);

/*
 * `taxonomy()` and `terms()` on WordPress, in-process (tests/php/wp.php), on the app in
 * tests/fixtures/taxonomy (schema.php is what `first build` emits for it, checked by tests/compiler.rs):
 * term rows and their implicit fields, term meta fields, assigning through `on` and `terms()`, write
 * order, list filters, `with` both ways, access (assigning vs creating), the hierarchy and term URLs
 * (docs/decisions/2026-11-11-authoring-surface.md, rulings 25-34).
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$fixture = dirname(__DIR__) . '/fixtures/taxonomy';
$wp = wpSite('taxonomy', [
    'schema' => require "$fixture/schema.php",
    'functions' => file_get_contents("$fixture/functions.php"),
    'users' => ['ed' => 'editor', 'alice' => 'author', 'sub' => 'subscriber'],
]);
$db = \First\db();

/** @return array{int, mixed} */
function req(string $method, string $path, mixed $body = null, ?string $as = null, array $query = []): array
{
    global $wp;
    [$status, $data] = $wp->call($method, $path, $body, $as, $query);

    return [$status, $data];
}

function isProblem(string $label, array $r, int $status, string $code, ?string $pointer = null): void
{
    [$s, $p] = $r;
    check("$label → $status $code" . ($pointer === null ? '' : " $pointer"), $s === $status && ($p['code'] ?? null) === $code && ($p['pointer'] ?? null) === $pointer, $p);
}

$names = static fn (array $rows): array => array_column($rows, 'name');

// ================================================================ registration (ruling 25)

$taxonomy = get_taxonomy('first_topics');
check('the taxonomy registers as first_<name> for its kinds', $taxonomy instanceof \WP_Taxonomy && $taxonomy->object_type === ['first_posts', 'first_pages'], $taxonomy?->object_type);
eq('… hierarchical, in REST under first_<name>, with no rewrite or query var', [$taxonomy->hierarchical, $taxonomy->show_in_rest, $taxonomy->rest_base, $taxonomy->rewrite, $taxonomy->query_var], [true, true, 'first_topics', false, false]);
eq('… keeping write order', [$taxonomy->sort, $taxonomy->args], [true, ['orderby' => 'term_order']]);
eq('… with per-taxonomy capabilities', (array) $taxonomy->cap, ['manage_terms' => 'manage_first_topics', 'edit_terms' => 'edit_first_topics', 'delete_terms' => 'delete_first_topics', 'assign_terms' => 'assign_first_topics']);
eq('a taxonomy with a url is public', [$taxonomy->public, get_taxonomy('first_tags')->public], [true, true]);
eq('terms() registers the taxonomy for its kind', get_taxonomy('first_tags')->object_type, ['first_posts']);
check('term fields are registered term meta', isset(get_registered_meta_keys('term', 'first_topics')['first_color']), array_keys(get_registered_meta_keys('term', 'first_topics')));
$group = acf_get_local_field_group('group_first_topics');
check('the SCF field group sits on the taxonomy', is_array($group) && $group['location'][0][0] === ['param' => 'taxonomy', 'operator' => '==', 'value' => 'first_topics'], $group);
eq('no table is created for a taxonomy', $wp->connection()->run("SELECT name FROM sqlite_master WHERE name LIKE '%first_topics%'"), []);

// ================================================================ term rows (ruling 27)

$news = $db->insert('topics', ['name' => 'News', 'color' => 'red', 'shades' => ['dark']], true)[0];
eq('a term row: implicit fields, then the authored ones', array_keys($news), ['id', 'name', 'slug', 'description', 'parent', 'count', 'url', 'color', 'icon', 'owner', 'shades', 'note']);
eq('… slug derived from the name, empty description, no parent, no items', [$news['slug'], $news['description'], $news['parent'], $news['count']], ['news', '', null, 0]);
eq('… url from the pattern', $news['url'], home_url('/topics/news/'));
eq('… term meta in First\'s value form', [$news['color'], $news['shades']], ['red', ['dark']]);
eq('… stored under first_<field>', get_term_meta($news['id'], 'first_color', true), 'red');
eq('the id is core\'s term id', get_term($news['id'], 'first_topics')->name, 'News');
$sports = $db->insert('topics', ['name' => 'Sports', 'slug' => 'sport'], true)[0];
eq('a given slug is kept', $sports['slug'], 'sport');
$other = $db->insert('topics', ['name' => 'Other', 'slug' => 'sport'], true)[0];
eq('a taken slug is made unique within the taxonomy, as core makes it', $other['slug'], 'sport-2');
$db->delete('topics', ['id' => $other['id']]);
problem('a taken name is a 409 at name', fn () => $db->insert('topics', ['name' => 'News']), 409, 'unique_violation', '/name');
problem('name is required', fn () => $db->insert('topics', ['color' => 'x']), 422, 'invalid_input', '/name');
problem('count is read-only', fn () => $db->insert('topics', ['name' => 'Counted', 'count' => 4]), 422, 'invalid_input', '/count');
problem('url is read-only', fn () => $db->update('topics', ['url' => 'x'], ['id' => $news['id']]), 422, 'invalid_input', '/url');
problem('a term has no author', fn () => $db->insert('topics', ['name' => 'A', 'author' => 1]), 422, 'invalid_input', '/author');
$updated = $db->update('topics', ['name' => 'World news', 'description' => 'Everywhere', 'color' => null], ['id' => $news['id']], true)[0];
eq('an update writes core\'s fields and term meta', [$updated['name'], $updated['slug'], $updated['description'], $updated['color']], ['World news', 'news', 'Everywhere', null]);
eq('a cleared field is gone from term meta', get_term_meta($news['id'], 'first_color', true), '');
eq('a term with no fields of its own is a row too', array_keys($db->insert('tags', ['name' => 'Short'], true)[0]), ['id', 'name', 'slug', 'description', 'count', 'url']);

// ================================================================ hierarchy (ruling 30)

$local = $db->insert('topics', ['name' => 'Local', 'parent' => $news['id']], true)[0];
$city = $db->insert('topics', ['name' => 'City', 'parent' => $local['id']], true)[0];
eq('parent is a term of the same taxonomy', $local['parent'], $news['id']);
eq('`:path` is the chain of ancestor slugs', $city['url'], home_url('/topics/news/local/city/'));
$tag = $db->insert('tags', ['name' => 'Elsewhere'], true)[0];
problem('a parent from another taxonomy is refused', fn () => $db->insert('topics', ['name' => 'X', 'parent' => $tag['id']]), 409, 'reference_violation', '/parent');
problem('a term can\'t be its own parent', fn () => $db->update('topics', ['parent' => $local['id']], ['id' => $local['id']]), 409, 'reference_violation', '/parent');
problem('a flat taxonomy has no parent', fn () => $db->insert('tags', ['name' => 'Y', 'parent' => $tag['id']]), 422, 'invalid_input', '/parent');

// ================================================================ assigning terms (ruling 26)

$p1 = $db->insert('posts', ['title' => 'First', 'topics' => [$sports['id'], $news['id']], 'labels' => [$tag['id']]], true)[0];
eq('`on` gives the item a field named after the taxonomy, in write order', $p1['topics'], [$sports['id'], $news['id']]);
eq('terms() is the same kind of field', $p1['labels'], [$tag['id']]);
eq('the links are core\'s term relationships, in that order', wp_get_object_terms($p1['id'], 'first_topics', ['fields' => 'ids', 'orderby' => 'term_order']), [$sports['id'], $news['id']]);
eq('core keeps the counts', $db->findFirst('topics', ['where' => ['id' => $sports['id']]])['count'], 1);
$p2 = $db->insert('posts', ['title' => 'Second', 'topics' => [$news['id']]], true)[0];
$p3 = $db->insert('posts', ['title' => 'Third'], true)[0];
eq('an item with no terms holds []', $p3['topics'], []);
$reordered = $db->update('posts', ['topics' => [$news['id'], $local['id'], $sports['id']]], ['id' => $p1['id']], true)[0];
eq('a write replaces the set, in its new order', $reordered['topics'], [$news['id'], $local['id'], $sports['id']]);
problem('a term of another taxonomy is refused', fn () => $db->update('posts', ['topics' => [$tag['id']]], ['id' => $p3['id']]), 409, 'reference_violation', '/topics/0');
problem('a duplicate id is refused', fn () => $db->update('posts', ['topics' => [$news['id'], $news['id']]], ['id' => $p3['id']]), 422, 'invalid_input', '/topics/1');
problem('a name never creates a term', fn () => $db->update('posts', ['topics' => ['Brand new']], ['id' => $p3['id']]), 422, 'invalid_input', '/topics/0');
check('… and none was created', get_term_by('name', 'Brand new', 'first_topics') === false);

// ================================================================ queries (ruling 28)

$titles = static fn (array $rows): array => array_column($rows, 'title');
$order = ['orderBy' => ['id' => 'asc']];
eq('has: items carrying the term', $titles($db->findMany('posts', ['where' => ['topics' => ['has' => $news['id']]]] + $order)), ['First', 'Second']);
eq('has is exact: a parent doesn\'t match items with only its children', $titles($db->findMany('posts', ['where' => ['topics' => ['has' => $local['id']]]] + $order)), ['First']);
eq('[]: items with none', $titles($db->findMany('posts', ['where' => ['topics' => []]] + $order)), ['Third']);
eq('true / false: some or none', [$titles($db->findMany('posts', ['where' => ['topics' => true]] + $order)), $titles($db->findMany('posts', ['where' => ['topics' => false]] + $order))], [['First', 'Second'], ['Third']]);
eq('a filter on the linked terms', $titles($db->findMany('posts', ['where' => ['topics' => ['slug' => 'sport']]] + $order)), ['First']);
$with = $db->findFirst('posts', ['where' => ['id' => $p1['id']], 'with' => ['topics' => true]]);
eq('with: the term rows in write order', $names($with['topics']), ['World news', 'Local', 'Sports']);
$nested = $db->findFirst('posts', ['where' => ['id' => $p1['id']], 'with' => ['topics' => ['orderBy' => ['name' => 'asc'], 'limit' => 2]]]);
eq('… nested orderBy and limit apply per item', $names($nested['topics']), ['Local', 'Sports']);
eq('terms list by name, then id', $names($db->findMany('topics')), ['City', 'Local', 'Sports', 'World news']);
eq('where and orderBy on term fields', $names($db->findMany('topics', ['where' => ['parent' => null], 'orderBy' => ['slug' => 'desc']])), ['Sports', 'World news']);
eq('the reverse relation is named after the kind', array_column($db->findFirst('topics', ['where' => ['id' => $news['id']], 'with' => ['posts' => true]])['posts'], 'title'), ['First', 'Second']);
eq('… and .reverse() renames it', array_column($db->findFirst('tags', ['where' => ['id' => $tag['id']], 'with' => ['labelled' => true]])['labelled'], 'title'), ['First']);
eq('a reverse filter', $names($db->findMany('topics', ['where' => ['posts' => ['title' => 'Second']]])), ['World news']);
problem('terms is not an orderBy key', fn () => $db->findMany('posts', ['orderBy' => ['topics' => 'asc']]), 400, 'invalid_query', '/orderBy/topics');
eq('the item URL uses the first term\'s slug', get_permalink($p1['id']), home_url('/notes/news/first/'));
eq('an item with no term has no URL yet', str_contains((string) get_permalink($p3['id']), '/notes/'), false);

// ================================================================ access (ruling 29)

eq('anyone reads terms', req('GET', '/topics')[0], 200);
[$s, $read] = req('GET', '/topics', query: ['where' => '{"slug":"sport"}']);
eq('… through First\'s pipeline', [$s, $names($read)], [200, ['Sports']]);
check('a field with a read rule is masked', !array_key_exists('note', $read[0]), $read[0]);
[$s, $created] = req('POST', '/topics', ['name' => 'By alice'], as: 'alice');
eq('the create rule (author) lets an author create', [$s, $created['name'] ?? null], [201, 'By alice']);
isProblem('a subscriber can\'t create', req('POST', '/topics', ['name' => 'By sub'], as: 'sub'), 403, 'forbidden');
isProblem('the update rule (editor) refuses an author', req('PATCH', "/topics/{$created['id']}", ['name' => 'Renamed'], as: 'alice'), 403, 'forbidden');
isProblem('tags: an author may not create', req('POST', '/tags', ['name' => 'nope'], as: 'alice'), 403, 'forbidden');
[$s, $assigned] = req('POST', '/pages', ['title' => 'By alice', 'topics' => [$news['id']]], as: 'alice');
eq('assigning needs the item\'s rule (pages: author), not the taxonomy\'s update rule', [$s, $assigned['topics'] ?? null], [201, [$news['id']]]);
isProblem('… and an item kind the author may not write refuses', req('POST', '/posts', ['title' => 'No', 'labels' => [$tag['id']]], as: 'alice'), 403, 'forbidden');
wp_set_current_user($wp->userId('alice'));
check('assign_first_topics is granted to someone who may write an attached kind', current_user_can('assign_first_topics'));
check('… assign_first_tags is not: posts are editor-only', !current_user_can('assign_first_tags'));
check('edit_first_topics (core\'s create check on a hierarchical taxonomy) follows the create rule', current_user_can('edit_first_topics'));
check('… delete_first_topics follows the delete rule (editor)', !current_user_can('delete_first_topics'));
check('core\'s create path is refused without the create rule', is_wp_error(wp_insert_term('Sneaky', 'first_tags')));
wp_set_current_user($wp->userId('sub'));
check('a subscriber who may write no attached kind has no assign capability', !current_user_can('assign_first_tags'));
wp_set_current_user(0);

// ================================================================ deletes (ruling 30)

$db->delete('topics', ['id' => $local['id']]);
$city = $db->findFirst('topics', ['where' => ['id' => $city['id']]]);
eq('deleting a term moves its children to its parent', $city['parent'], $news['id']);
eq('… and removes its links', $db->findFirst('posts', ['where' => ['id' => $p1['id']]])['topics'], [$news['id'], $sports['id']]);
$before = $db->findFirst('topics', ['where' => ['id' => $news['id']]])['count'];
$db->delete('posts', ['id' => $p2['id']]);
eq('deleting an item removes its links and recounts (count spans every attached kind)', [$before, $db->findFirst('topics', ['where' => ['id' => $news['id']]])['count']], [3, 2]);
eq('deleting a term removes its meta', (function () use ($db, $sports): array {
    $db->update('topics', ['color' => 'blue'], ['id' => $sports['id']]);
    $db->delete('topics', ['id' => $sports['id']]);
    return get_term_meta($sports['id']);
})(), []);

// ================================================================ core internals the term route relies on
// TermsController subclasses core's WP_REST_Terms_Controller and TermMeta its WP_REST_Term_Meta_Fields
// (docs/wordpress-internals.md). A core release that renames, hides or reshapes one of these fails here
// by name, against the WordPress this suite runs on.
$member = static function (string $class, string $name): array {
    $m = new ReflectionMethod($class, $name);
    return [$m->isProtected() ? 'protected' : ($m->isPublic() ? 'public' : 'private'), $m->getNumberOfParameters(), $m->getNumberOfRequiredParameters()];
};
$property = static function (string $class, string $name): string {
    $p = new ReflectionProperty($class, $name);
    return $p->isProtected() ? 'protected' : ($p->isPublic() ? 'public' : 'private');
};
eq('core terms controller: get_term($id) is protected, one parameter', $member(WP_REST_Terms_Controller::class, 'get_term'), ['protected', 1, 1]);
eq('core terms controller: $meta and $taxonomy are protected properties', [$property(WP_REST_Terms_Controller::class, 'meta'), $property(WP_REST_Terms_Controller::class, 'taxonomy')], ['protected', 'protected']);
eq('core terms controller: the overridden handlers take ($request)', array_map(static fn (string $m) => $member(WP_REST_Terms_Controller::class, $m), ['get_items', 'get_item', 'create_item', 'update_item', 'delete_item', 'get_items_permissions_check', 'get_item_permissions_check', 'create_item_permissions_check', 'update_item_permissions_check', 'delete_item_permissions_check']),
    array_fill(0, 10, ['public', 1, 1]));
eq('core terms controller: prepare_item_for_response($item, $request), get_collection_params()', [$member(WP_REST_Terms_Controller::class, 'prepare_item_for_response'), $member(WP_REST_Terms_Controller::class, 'get_collection_params')], [['public', 2, 2], ['public', 0, 0]]);
eq('core term meta fields: constructed with ($taxonomy); get_value($object_id, $request)', [$member(WP_REST_Term_Meta_Fields::class, '__construct'), $member(WP_REST_Meta_Fields::class, 'get_value')], [['public', 1, 1], ['public', 2, 2]]);

// `columns` on a term-backed kind: only what was asked (and the key) is selected, the result as before.
$statements = [];
\First\Wp\Connection::$observer = static function (string $sql) use (&$statements): void {
    $statements[] = $sql;
};
$narrow = $db->findMany('topics', ['columns' => ['name' => true, 'shades' => true], 'orderBy' => ['id' => 'asc']]);
\First\Wp\Connection::$observer = null;
$wide = array_map(static fn (array $r): array => array_intersect_key($r, array_flip(['name', 'shades'])), $db->findMany('topics', ['orderBy' => ['id' => 'asc']]));
eq('a term read with columns returns what reading every column gave', $narrow, $wide);
$termSql = array_values(array_filter($statements, static fn (string $s): bool => str_contains($s, 'AS `name`')))[0] ?? '';
check('and selects no other term field or meta join', !str_contains($termSql, 'AS `color`') && !str_contains($termSql, 'AS `description`') && !str_contains($termSql, "meta_key = 'first_color'"), $termSql);

finish('taxonomy');
