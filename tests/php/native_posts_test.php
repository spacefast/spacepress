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

/** A request to the facade (`/wp-json/typedpress/v1`), where the staged-version routes live: [status, data or problem]. */
function facade(string $method, string $path, mixed $body = null, ?string $as = null): array
{
    global $wp;
    $wp->actAs($as);
    try {
        [$code, , $out] = \TypedPress\Wp\Facade::route(\TypedPress\Wp\Plugin::instance(), $method, $path, [], $body === null ? '' : (string) json_encode($body));
        $json = json_decode((string) $out, true);

        return [$code, $json['data'] ?? $json];
    } catch (\TypedPress\HttpError | \TypedPress\JsError $e) {
        return [\TypedPress\App::problem($e)['status'], \TypedPress\App::problem($e)];
    } finally {
        wp_set_current_user(0);
    }
}

// A post as the WordPress editor writes one, with the app's field as its post meta.
wp_set_current_user($wp->userId('ed'));
$hello = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Hello native', 'post_name' => 'hello-native',
    'post_content' => '<!-- wp:paragraph --><p>Body</p><!-- /wp:paragraph -->', 'post_excerpt' => 'Short'], true);
check('wp_insert_post writes a post', is_int($hello) && $hello > 0, $hello);
update_post_meta($hello, 'tp_minutes', '4');
wp_set_current_user(0);

$row = $db->findFirst('posts', ['where' => ['id' => $hello]]);
check('a core post is a row of posts', ($row['title'] ?? null) === 'Hello native' && ($row['slug'] ?? null) === 'hello-native'
    && ($row['excerpt'] ?? null) === 'Short' && ($row['status'] ?? null) === 'published' && ($row['minutes'] ?? null) === 4
    && str_contains((string) ($row['content'] ?? ''), '<p>Body</p>'), $row);
check('publishedAt is the post date', is_string($row['publishedAt'] ?? null) && str_ends_with($row['publishedAt'], 'Z'), $row);

// The post's URL is the kind's pattern, through core's post_link.
check('get_permalink follows url', get_permalink($hello) === home_url('/blog/hello-native/') || get_permalink($hello) === home_url('/blog/hello-native'), get_permalink($hello));

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
check('comments are open on a post', comments_open($hello), get_post($hello)->comment_status);
wp_set_current_user($wp->userId('sub'));
$request = new WP_REST_Request('POST', '/wp/v2/comments');
$request->set_body_params(['post' => $hello, 'content' => 'Nice post']);
$response = rest_do_request($request);
wp_set_current_user(0);
check('a signed-in reader comments on a post (core\'s comments route)', $response->get_status() === 201, [$response->get_status(), $response->get_data()]);
check('the comment is core\'s', (int) get_comments(['post_id' => $hello, 'count' => true, 'status' => 'all']) === 1, get_comments(['post_id' => $hello, 'status' => 'all']));

// Core's posts route as a visitor (what the facade dispatches, and any core client sees).
wp_set_current_user(0);
$response = rest_do_request(new WP_REST_Request('GET', '/wp/v2/posts'));
check('a visitor lists published posts on core\'s route', $response->get_status() === 200 && in_array($hello, array_column($response->get_data(), 'id'), true), [$response->get_status(), count((array) $response->get_data())]);
$response = rest_do_request(new WP_REST_Request('GET', "/wp/v2/posts/$hello"));
check('a visitor reads a published post on core\'s route', $response->get_status() === 200, $response->get_status());

// A draft is read by whom core lets read it: its author and editors, never a visitor or another author.
[$s, $draft] = $wp->call('POST', '/posts', ['title' => 'Unfinished', 'status' => 'draft'], 'alice');
$draftId = (int) ($draft['id'] ?? 0);
[$s2] = $wp->call('GET', "/posts/$draftId", null, null);
check('a draft is hidden from visitors', $s === 201 && $s2 === 404, [$s, $s2, $draft]);
[$s3, $own] = $wp->call('GET', "/posts/$draftId", null, 'alice');
check('an author reopens their own draft', $s3 === 200 && ($own['title'] ?? null) === 'Unfinished', [$s3, $own]);
[$s4] = $wp->call('GET', "/posts/$draftId", null, 'bob');
check('another author doesn\'t see it', $s4 === 404, $s4);
[$s5] = $wp->call('GET', "/posts/$draftId", null, 'ed');
check('an editor sees it', $s5 === 200, $s5);
$private = wp_insert_post(['post_type' => 'post', 'post_status' => 'private', 'post_title' => 'Private', 'post_author' => $wp->userId('alice')], true);
wp_set_current_user($wp->userId('bob'));
check('read_post on another author\'s draft and private post stays core\'s answer', !current_user_can('read_post', $draftId) && !current_user_can('read_post', $private), null);
wp_set_current_user(0);
check('a visitor has no read_post on a draft', !current_user_can('read_post', $draftId), null);
$response = rest_do_request(new WP_REST_Request('GET', "/wp/v2/posts/$private"));
check('a visitor can\'t read a private post on core\'s route', $response->get_status() !== 200, $response->get_status());

$locked = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Locked', 'post_content' => 'Locked body', 'post_password' => 'sesame'], true);
$zero = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Zero', 'post_content' => 'Zero body', 'post_password' => '0'], true);
$concealed = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Hidden by app', 'post_password' => 'sesame'], true);
$read = static function (int $post, array $query = []): array {
    $request = new WP_REST_Request('GET', "/wp/v2/posts/$post");
    $request->set_query_params($query);
    $response = rest_do_request($request);

    return [$response->get_status(), $response->get_data()['content']['rendered'] ?? ''];
};
eq('core masks a locked post without proof', $read($locked), [404, '']);
eq('core refuses a wrong password', $read($locked, ['password' => 'Sesame']), [403, '']);
[$status, $body] = $read($locked, ['password' => 'sesame']);
check('a visitor with the password reads the body on core’s route', $status === 200 && str_contains($body, 'Locked body'), [$status, $body]);
eq('the proof expires when the request returns', $read($locked), [404, '']);
eq('the correct password cannot open a post hidden by the app', $read($concealed, ['password' => 'sesame']), [404, '']);
eq('the wrong password cannot reveal a post hidden by the app', $read($concealed, ['password' => 'Sesame']), [404, '']);
require_once ABSPATH . WPINC . '/class-phpass.php';
$_COOKIE['wp-postpass_' . COOKIEHASH] = (new \PasswordHash(8, true))->HashPassword('sesame');
[$status, $body] = $read($locked);
unset($_COOKIE['wp-postpass_' . COOKIEHASH]);
check('a visitor with a valid cookie reads the body on core’s route', $status === 200 && str_contains($body, 'Locked body'), [$status, $body]);
[$status, $body] = $read($zero);
check('WordPress treats an exact password of "0" as public', $status === 200 && str_contains($body, 'Zero body'), [$status, $body]);

// Slugs are WordPress's: a taken one is made unique, as in the block editor.
[$sa, $a] = $wp->call('POST', '/posts', ['title' => 'Same A', 'slug' => 'same-url'], 'alice');
[$sb, $b] = $wp->call('POST', '/posts', ['title' => 'Same B', 'slug' => 'same-url'], 'alice');
check('a taken slug is made unique', $sa === 201 && $sb === 201 && ($a['slug'] ?? null) === 'same-url' && ($b['slug'] ?? null) !== 'same-url', [$a['slug'] ?? null, $b['slug'] ?? null]);

// Staged versions: staging is editing, so core's edit_post decides first.
[$st, $staged] = facade('PATCH', "/posts/$apiId/staged", ['title' => 'Staged title', 'excerpt' => 'Staged excerpt'], 'alice');
check('the author stages a change to their post', $st === 200, [$st, $staged]);
// A preview link shows the staged excerpt on the theme's page too, not only the staged title.
[, $link] = facade('POST', "/posts/$apiId/staged/preview", null, 'alice');
$_GET[\TypedPress\Wp\Staged::PREVIEW_PARAM] = wp_slash((string) ($link['token'] ?? ''));
$GLOBALS['wp_query'] = new WP_Query(['p' => $apiId, 'post_type' => 'post']);
$GLOBALS['wp_the_query'] = $GLOBALS['wp_query'];
\TypedPress\Wp\Staged::previewPage();
check('a staged preview shows the staged excerpt', ($GLOBALS['wp_query']->posts[0]->post_excerpt ?? null) === 'Staged excerpt'
    && ($GLOBALS['wp_query']->posts[0]->post_title ?? null) === 'Staged title', [$link, $GLOBALS['wp_query']->posts[0] ?? null]);
unset($_GET[\TypedPress\Wp\Staged::PREVIEW_PARAM]);
foreach ([['GET', ''], ['DELETE', ''], ['GET', '/compare']] as [$verb, $sub]) {
    [$sx] = facade($verb, "/posts/$apiId/staged$sub", null, 'bob');
    check("another author can't $verb staged$sub of it", $sx === 404, $sx);
}
[$sp] = facade('POST', "/posts/$apiId/staged/preview", null, 'bob');
check('another author can\'t mint its preview link', in_array($sp, [404, 405], true), $sp);

// wp.posts.clone(): its own post type, shaped like posts.
[$s, $note] = $wp->call('POST', '/notes', ['title' => 'A note', 'excerpt' => 'Note excerpt', 'mood' => 'calm'], 'alice');
check('a clone is its own post type', $s === 201 && get_post_type((int) ($note['id'] ?? 0)) === 'tp_notes'
    && get_post((int) $note['id'])->post_excerpt === 'Note excerpt' && ($note['mood'] ?? null) === 'calm', [$s, $note]);
check('a clone has comments on', comments_open((int) ($note['id'] ?? 0)), null);
check('a clone item\'s URL follows its url', str_contains((string) get_permalink((int) ($note['id'] ?? 0)), '/notes/a-note'), get_permalink((int) ($note['id'] ?? 0)));
check('posts are not in the clone', $db->findFirst('notes', ['where' => ['id' => $hello]]) === null, null);

// A site that ran the app's `posts` as a collection (post type tp_posts): the deploy that switches it to
// wp.posts makes those items core posts in place, keeping ids, fields, uids and history.
$old = wp_insert_post(['post_type' => 'tp_posts', 'post_status' => 'publish', 'post_title' => 'From the collection', 'post_name' => 'from-the-collection', 'comment_status' => 'closed'], true);
update_post_meta($old, 'tp_excerpt', 'Kept excerpt');
update_post_meta($old, 'tp_minutes', '7');
update_post_meta($old, '_tp_uid', 'zr_0123456789abcdef0123');
$rev = wp_insert_post(['post_type' => 'revision', 'post_status' => 'inherit', 'post_parent' => $old, 'post_title' => 'From the collection', 'post_name' => "$old-revision-v1"], true);
add_metadata('post', $rev, 'tp_excerpt', 'Kept excerpt'); // revision meta, as acf_copy_metadata writes it
// One of them has the slug a core post already has.
$clash = wp_insert_post(['post_type' => 'tp_posts', 'post_status' => 'publish', 'post_title' => 'Clash', 'post_name' => 'hello-native'], true);
global $wpdb;
$wpdb->update($wpdb->posts, ['post_name' => 'hello-native'], ['ID' => $clash]); // as the collection stored it
$plugin = $wp->plugin();
$postTypes = 'tp_' . $plugin->schema->name() . '_post_types';
$schemaOption = 'tp_' . $plugin->schema->name() . '_schema';
$adopted = 'tp_' . $plugin->schema->name() . '_adopted_posts';
$nativeInstall = ['schemaHash' => get_option($schemaOption), 'types' => ['post', 'tp_notes']];
eq('installation records the app’s actual post types', get_option($postTypes), $nativeInstall);
check('an earlier build with no matching collection leaves other apps’ posts alone',
    \TypedPress\Wp\NativePosts::adopt($plugin) === 0 && get_post_type($old) === 'tp_posts' && get_option($adopted) === false, get_post_type($old));
// Model a deployment from a runtime that predates tracking the app's post types.
delete_option($postTypes);
check('a schema hash alone does not authorize adoption',
    \TypedPress\Wp\NativePosts::adopt($plugin) === 0 && get_post_type($old) === 'tp_posts' && get_option($adopted) === false, get_post_type($old));
// Record a preceding installation in which this app used the custom post type.
$previous = $plugin->schema->raw();
$previous['collections']['posts']['native'] = false;
$previous['collections']['posts']['wp']['postType'] = 'tp_posts';
$previousHash = hash('sha256', 'previous collection build');
\TypedPress\Wp\NativePosts::rememberPostTypes(new \TypedPress\Schema($previous), $previousHash);
check('a post type recorded for a different build cannot authorize adoption',
    \TypedPress\Wp\NativePosts::adopt($plugin) === 0 && get_post_type($old) === 'tp_posts', get_post_type($old));
update_option($schemaOption, $previousHash);
// A failure part way leaves nothing moved: the whole adoption is one transaction, and it runs again.
$calls = 0;
$fail = static function (string $slug) use (&$calls): string {
    if (++$calls === 2) {
        throw new \RuntimeException('injected failure'); // after the first item's UPDATE ran
    }
    return $slug;
};
add_filter('wp_unique_post_slug', $fail);
try {
    $plugin->initialize();
    $threw = false;
} catch (\RuntimeException $e) {
    $threw = $e->getMessage() === 'injected failure';
}
remove_filter('wp_unique_post_slug', $fail);
clean_post_cache($old);
check('an interrupted adoption moves nothing and records nothing', $threw && get_post_type($old) === 'tp_posts' && get_option($adopted) === false, [$threw, get_post_type($old), get_option($adopted)]);
$plugin->initialize();
eq('deployment records the two old items it moved', get_option($adopted), '2');
eq('deployment replaces the ownership record with the new post types', get_option($postTypes), $nativeInstall);
clean_post_cache($old);
$moved = $db->findFirst('posts', ['where' => ['id' => $old]]);
check('an adopted item is a post with its excerpt, fields and uid', get_post_type($old) === 'post' && ($moved['excerpt'] ?? null) === 'Kept excerpt'
    && ($moved['minutes'] ?? null) === 7 && get_post_meta($old, '_tp_uid', true) === 'zr_0123456789abcdef0123', $moved);
check('an adopted item takes comments, as posts do', comments_open($old), get_post($old)->comment_status);
check('its revisions keep the excerpt', get_post($rev)->post_excerpt === 'Kept excerpt' && (int) get_post($rev)->post_parent === $old, get_post($rev));
check('adopting again moves nothing', \TypedPress\Wp\NativePosts::adopt($plugin) === 0, null);
check('a slug a core post already had is made unique, and the old one redirects', get_post($clash)->post_name !== 'hello-native'
    && in_array('hello-native', get_post_meta($clash, '_wp_old_slug'), true) && get_post($hello)->post_name === 'hello-native', [get_post($clash)->post_name, get_post($hello)->post_name]);

// Sync: an author pulls only what core lets them read, and can't trash another author's post.
$secret = wp_insert_post(['post_type' => 'post', 'post_status' => 'draft', 'post_title' => 'Ed\'s secret draft', 'post_author' => $wp->userId('ed')], true);
[$ss, $page] = $wp->call('GET', '/sync/posts', null, 'bob', ['first' => '100']);
$titles = array_map(static fn ($r) => $r['record']['fields']['title'] ?? null, array_filter((array) ($page['records'] ?? []), static fn ($r) => isset($r['record'])));
check('sync lists published posts to an author', $ss === 200 && in_array('Hello native', $titles, true), [$ss, $page]);
check('sync hides drafts, private and protected posts from other authors', array_intersect($titles, ["Ed's secret draft", 'Unfinished', 'Private', 'Locked']) === [], $titles);
$addPost = static fn (string $title, array $extra = []): int => wp_insert_post($extra + [
    'post_type' => 'post', 'post_status' => 'publish', 'post_title' => $title, 'post_author' => $wp->userId('ed'),
], true);
$cursor = $addPost('Before hidden posts');
$addPost('Hidden draft on page', ['post_status' => 'draft']);
$addPost('Hidden password on page', ['post_password' => 'private']);
$addPost('Hidden by app');
$nextId = $addPost('Visible after hidden posts');
$addPost('Final readable draft', ['post_status' => 'draft', 'post_author' => $wp->userId('bob')]);
[$sp, $chunk] = $wp->call('GET', '/sync/posts', null, 'bob', ['first' => '1', 'after' => (string) $cursor]);
eq('sync filters skipped rows before deciding whether there is a next page', [$sp, $chunk['records'][0]['record']['fields']['title'] ?? null, $chunk['next'] ?? null],
    [200, 'Visible after hidden posts', $nextId]);
[$sp, $chunk] = $wp->call('GET', '/sync/posts', null, 'bob', ['first' => '1', 'after' => (string) $nextId]);
eq('following the sync cursor reaches the final visible row and stops', [$sp, $chunk['records'][0]['record']['fields']['title'] ?? null, $chunk['next'] ?? null],
    [200, 'Final readable draft', null]);
$target = array_values(array_filter((array) ($page['records'] ?? []), static fn ($r) => ($r['record']['fields']['title'] ?? null) === 'Hello native'))[0] ?? null;
[$sx, $px] = $wp->call('POST', '/sync/posts/trash', ['uid' => $target['record']['uid'] ?? '', 'expect' => $target['digest'] ?? ''], 'bob');
check('an author can\'t trash another author\'s post through sync', $sx === 404 && get_post_status($hello) === 'publish', [$sx, $px, get_post_status($hello)]);

finish('native posts');
