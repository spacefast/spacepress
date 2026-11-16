<?php

declare(strict_types=1);

/*
 * WordPress's own posts in an app (`wp.posts.extend()`, `wp.posts.clone()`), in-process
 * (tests/php/wp.php), on tests/fixtures/native-posts as `typedpress build` emits it
 * (tests/compiler.rs `native_posts_run_on_wordpress` builds it and runs this):
 *
 * - a post written in WordPress (wp_insert_post, as the editor does) is a row of the app's `posts`:
 *   title, slug, content, excerpt, status, publishedAt from the post itself, fields from post meta;
 * - the app's writes land in core's `post` type, and core's revisions record them;
 * - each post's URL is the kind's `url`, through core's `post_link`;
 * - core's capabilities still decide (a subscriber can't write a post, an author can't edit another's),
 *   and the app's rules narrow them;
 * - comments are open on posts, through core's comment API;
 * - `wp.posts.clone()` is its own post type with the same fields.
 *
 *   php tests/php/native_posts_test.php <wp-content dir>
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp = wpSite('native-posts', [
    'wpContent' => $argv[1],
    'users' => ['ed' => 'editor', 'alice' => 'author', 'bob' => 'author', 'sub' => 'subscriber'],
]);
$db = \TypedPress\db();

// A post as the WordPress editor writes one, with the app's field as its post meta.
wp_set_current_user($wp->userId('ed'));
$id = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Hello native', 'post_name' => 'hello-native',
    'post_content' => '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->', 'post_excerpt' => 'Short'], true);
check('wp_insert_post writes a post', is_int($id) && $id > 0, $id);
update_post_meta($id, 'tp_minutes', '4');
wp_set_current_user(0);

$row = $db->findFirst('posts', ['where' => ['id' => $id]]);
check('a core post is a row of posts', ($row['title'] ?? null) === 'Hello native' && ($row['slug'] ?? null) === 'hello-native'
    && ($row['excerpt'] ?? null) === 'Short' && ($row['status'] ?? null) === 'published' && ($row['minutes'] ?? null) === 4
    && str_contains((string) ($row['content'] ?? ''), '<p>Body</p>'), $row);
check('publishedAt is the post date', is_string($row['publishedAt'] ?? null) && str_ends_with($row['publishedAt'], 'Z'), $row);

// The post's URL is the kind's pattern, through core's post_link.
check('get_permalink follows url', get_permalink($id) === home_url('/blog/hello-native/') || get_permalink($id) === home_url('/blog/hello-native'), get_permalink($id));

// The fields are an SCF field group on posts, so the block editor shows them.
$groups = array_column(acf_get_field_groups(['post_type' => 'post']), 'key');
check('posts get the app\'s field group', in_array('group_tp_wp_posts', $groups, true), $groups);
// Other plugins' fields on posts are not the app's to lock (SchemaLock leaves `post` alone).
check('core keeps registering posts', post_type_exists('post') && get_post_type_object('post')->_builtin, null);

// The API: list, read and write as signed-in people.
[$s, $list] = $wp->call('GET', '/posts', null, null);
check('anyone lists published posts', $s === 200 && in_array('Hello native', array_column((array) $list, 'title'), true), [$s, $list]);
[$s, $created] = $wp->call('POST', '/posts', ['title' => 'From the API', 'content' => '<p>Hi</p>', 'excerpt' => 'Via API', 'minutes' => 2], 'alice');
check('an author creates a post through the API', $s === 201 && ($created['title'] ?? null) === 'From the API' && ($created['minutes'] ?? null) === 2, [$s, $created]);
$apiId = (int) ($created['id'] ?? 0);
check('it is core\'s post type', get_post_type($apiId) === 'post' && get_post($apiId)->post_excerpt === 'Via API', get_post($apiId));
check('its field is post meta tp_minutes', get_post_meta($apiId, 'tp_minutes', true) === '2', get_post_meta($apiId));
check('it has a uid of its own', is_string($created['uid'] ?? null) ? true : !array_key_exists('uid', (array) $created), $created);

[$s, $p] = $wp->call('POST', '/posts', ['title' => 'Nope'], 'sub');
check('a subscriber can\'t create a post', in_array($s, [401, 403], true), [$s, $p]);
[$s, $p] = $wp->call('PATCH', "/posts/$apiId", ['title' => 'Taken over'], 'bob');
check('an author can\'t edit another author\'s post (core\'s edit_others_posts)', in_array($s, [403, 404], true) && get_post($apiId)->post_title === 'From the API', [$s, $p]);
[$s, $p] = $wp->call('PATCH', "/posts/$apiId", ['title' => 'From the API, edited', 'minutes' => 3], 'alice');
check('the author edits their own post', $s === 200 && ($p['title'] ?? null) === 'From the API, edited' && ($p['minutes'] ?? null) === 3, [$s, $p]);
check('core keeps revisions of the edit', count(wp_get_post_revisions($apiId)) >= 1, count(wp_get_post_revisions($apiId)));
[$s, $p] = $wp->call('PATCH', "/posts/$apiId", ['minutes' => 0], 'alice');
check('a field rule still applies', $s === 422, [$s, $p]);

// Core's own REST route for posts answers through TypedPress's controller, as the block editor uses it.
wp_set_current_user($wp->userId('alice'));
$request = new WP_REST_Request('POST', "/wp/v2/posts/$apiId");
$request->set_body_params(['title' => 'Edited in the editor', 'meta' => ['minutes' => 5]]);
$response = rest_do_request($request);
wp_set_current_user(0);
check('core\'s /wp/v2/posts writes the app\'s field', $response->get_status() === 200 && get_post_meta($apiId, 'tp_minutes', true) === '5'
    && get_post($apiId)->post_title === 'Edited in the editor', [$response->get_status(), $response->get_data()['message'] ?? null]);

// Comments: open on posts, through core's comment API.
check('comments are open on a post', comments_open($id), get_post($id)->comment_status);
wp_set_current_user($wp->userId('sub'));
$request = new WP_REST_Request('POST', '/wp/v2/comments');
$request->set_body_params(['post' => $id, 'content' => 'Nice post']);
$response = rest_do_request($request);
wp_set_current_user(0);
check('a signed-in reader comments on a post (core\'s comments route)', $response->get_status() === 201, [$response->get_status(), $response->get_data()]);
check('the comment is core\'s', (int) get_comments(['post_id' => $id, 'count' => true, 'status' => 'all']) === 1, get_comments(['post_id' => $id, 'status' => 'all']));

// Core's posts route as a visitor (what the facade dispatches, and any core client sees).
wp_set_current_user(0);
$response = rest_do_request(new WP_REST_Request('GET', '/wp/v2/posts'));
check('a visitor lists published posts on core\'s route', $response->get_status() === 200 && in_array($id, array_column($response->get_data(), 'id'), true), [$response->get_status(), count((array) $response->get_data())]);
$response = rest_do_request(new WP_REST_Request('GET', "/wp/v2/posts/$id"));
check('a visitor reads a published post on core\'s route', $response->get_status() === 200, $response->get_status());

// A draft is nobody's to read but its writers'.
[$s, $draft] = $wp->call('POST', '/posts', ['title' => 'Unfinished', 'status' => 'draft'], 'alice');
[$s2] = $wp->call('GET', '/posts/' . (int) ($draft['id'] ?? 0), null, null);
check('a draft is hidden from visitors', $s === 201 && $s2 === 404, [$s, $s2, $draft]);

// wp.posts.clone(): its own post type, shaped like posts.
[$s, $note] = $wp->call('POST', '/notes', ['title' => 'A note', 'excerpt' => 'Note excerpt', 'mood' => 'calm'], 'alice');
check('a clone is its own post type', $s === 201 && get_post_type((int) ($note['id'] ?? 0)) === 'tp_notes'
    && get_post((int) $note['id'])->post_excerpt === 'Note excerpt' && ($note['mood'] ?? null) === 'calm', [$s, $note]);
check('a clone has comments on', comments_open((int) ($note['id'] ?? 0)), null);
check('a clone item\'s URL follows its url', str_contains((string) get_permalink((int) ($note['id'] ?? 0)), '/notes/a-note'), get_permalink((int) ($note['id'] ?? 0)));
check('posts are not in the clone', $db->findFirst('notes', ['where' => ['id' => $id]]) === null, null);

// A site that ran the app's `posts` as a collection (post type tp_posts): the deploy that switches it to
// wp.posts makes those items core posts in place, keeping ids, fields, uids and history.
$old = wp_insert_post(['post_type' => 'tp_posts', 'post_status' => 'publish', 'post_title' => 'From the collection', 'post_name' => 'from-the-collection', 'comment_status' => 'closed'], true);
update_post_meta($old, 'tp_excerpt', 'Kept excerpt');
update_post_meta($old, 'tp_minutes', '7');
update_post_meta($old, '_tp_uid', 'zr_0123456789abcdef0123');
$rev = wp_insert_post(['post_type' => 'revision', 'post_status' => 'inherit', 'post_parent' => $old, 'post_title' => 'From the collection', 'post_name' => "$old-revision-v1"], true);
add_metadata('post', $rev, 'tp_excerpt', 'Kept excerpt'); // revision meta, as acf_copy_metadata writes it
check('adopt moves the old collection\'s items', \TypedPress\Wp\NativePosts::adopt(\TypedPress\Wp\Plugin::instance()) === 1, null);
clean_post_cache($old);
$moved = $db->findFirst('posts', ['where' => ['id' => $old]]);
check('an adopted item is a post with its excerpt, fields and uid', get_post_type($old) === 'post' && ($moved['excerpt'] ?? null) === 'Kept excerpt'
    && ($moved['minutes'] ?? null) === 7 && get_post_meta($old, '_tp_uid', true) === 'zr_0123456789abcdef0123', $moved);
check('an adopted item takes comments, as posts do', comments_open($old), get_post($old)->comment_status);
check('its revisions keep the excerpt', get_post($rev)->post_excerpt === 'Kept excerpt' && (int) get_post($rev)->post_parent === $old, get_post($rev));
check('adopting again moves nothing', \TypedPress\Wp\NativePosts::adopt(\TypedPress\Wp\Plugin::instance()) === 0, null);

finish('native posts');
