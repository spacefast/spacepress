<?php

declare(strict_types=1);

/*
 * The v2 pipeline on the blog fixture (tests/fixtures/blog: authors and posts are post-backed, comments
 * a custom table), in-process through App::handle on WordPress (tests/php/wp.php): access (role
 * ladder, filter rules, 401/403/404 masking, nested `with`), drafts transitions, lazy promotion, slug
 * derivation, revisions, hook ctx, globals, media (+ delete nulling), FK actions, extension seams.
 */

use First\App;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$open = $schema['collections']['posts'];
$open['key'] = 'openNotes';
$open['drafts'] = $open['revisions'] = false;
$open['content'] = null;
$open['columns'] = array_intersect_key($open['columns'], array_flip(['id', 'title', 'slug']));
$open['hooks'] = $open['relations'] = [];
$open['access'] = array_fill_keys(['read', 'create', 'update', 'delete'], ['role' => 'anyone']);
$open['wp'] = ['postType' => 'first_open_notes', 'groupKey' => 'group_first_open_notes', 'metaPrefix' => 'first_', 'fieldKeyPrefix' => 'field_first_open_notes_'];
$schema['collections']['openNotes'] = $open;
// Signed-in-only action: on a site without first-identity, only WordPress itself can sign anyone in.
$schema['actions']['signedInCount'] = ['access' => ['role' => 'authenticated'], 'handler' => 'action__publishedCount'] + $schema['actions']['publishedCount'];
$wp = wpSite('blog', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php'),
    'users' => ['ed' => 'editor', 'alice' => 'author', 'bob' => 'author', 'sub' => 'subscriber'],
]);
$app = $wp->app();
$db = \First\db();
eq('WordPress and the request pipeline share the validated schema', $app->schema === \First\Wp\Runtime::plugin()->schema, true);
eq('the database uses the validated schema', $db->schema() === $app->schema, true);
$anonymous = new \First\Viewer(null);
eq('an unprotected collection retains unrestricted storage visibility', $db->store()->readGuards('openNotes', $anonymous), []);
$openNote = $db->insert('openNotes', ['title' => 'Anonymous unique slug'], true, $anonymous)[0];
eq('anonymous unique creation succeeds when password guards cannot narrow reads', $openNote['slug'], 'anonymous-unique-slug');
eq('native unrestricted reads do not enumerate every primary key', $db->permittedKeys('openNotes', 'read', $anonymous), null);

$users = [];
foreach (['admin', 'ed', 'alice', 'bob', 'sub'] as $name) {
    $users[$name] = $wp->user($name);
}

/** @return array{int, mixed} [status, data or problem] */
function req(string $method, string $path, mixed $body = null, ?string $as = null, array $query = [], array $files = [], array $form = []): array
{
    global $wp;
    [$status, $data] = $wp->call($method, $path, $body, $as, $query, $files, $form);

    return [$status, $data];
}

function isProblem(string $label, array $r, int $status, string $code, ?string $pointer = null): void
{
    [$s, $p] = $r;
    check("$label → $status $code" . ($pointer === null ? '' : " $pointer"), $s === $status && ($p['code'] ?? null) === $code && ($p['pointer'] ?? null) === $pointer, $p);
}

$titles = static fn (array $rows) => array_column($rows, 'title');

// ================================================================ seed (trusted)

$aliceProfile = $db->insert('authors', ['name' => 'Alice', 'email' => 'alice@example.com', 'userId' => $users['alice']['id']], true)[0];
$hidden = $db->insert('authors', ['name' => 'Ghost', 'email' => 'ghost@example.com', 'status' => 'draft'], true)[0];
[$pub, $draft] = $db->insert('posts', [
    ['title' => 'Published one', 'authorId' => $aliceProfile['id']],
    ['title' => 'Draft one', 'status' => 'draft', 'authorId' => $aliceProfile['id']],
], true);

// ================================================================ drafts transitions (§6.1)

check('status absent → published with publishedAt = now', $pub['status'] === 'published' && $pub['publishedAt'] !== null, $pub);
eq('draft keeps a null publishedAt', [$draft['status'], $draft['publishedAt']], ['draft', null]);
problem('scheduled without publishedAt', fn () => $db->insert('posts', ['title' => 'x', 'status' => 'scheduled']), 422, 'invalid_input', '/publishedAt');
problem('scheduled in the past', fn () => $db->insert('posts', ['title' => 'x', 'status' => 'scheduled', 'publishedAt' => '2001-01-01T00:00:00Z']), 422, 'invalid_input', '/publishedAt');
$dated = $db->insert('posts', ['title' => 'Dated', 'status' => 'published', 'publishedAt' => '2031-01-01T00:00:00.000Z'], true)[0];
eq('published with a future publishedAt stays published (only scheduled schedules)', [$dated['status'], $dated['publishedAt']], ['published', '2031-01-01T00:00:00.000Z']);
$db->delete('posts', ['id' => $dated['id']]);
$published = $db->update('posts', ['status' => 'published'], ['id' => $draft['id']], true)[0];
check('draft → published sets publishedAt', $published['publishedAt'] !== null, $published);
$again = $db->update('posts', ['status' => 'draft'], ['id' => $draft['id']], true)[0];
eq('published → draft keeps publishedAt', $again['publishedAt'], $published['publishedAt']);
$db->update('posts', ['publishedAt' => null], ['id' => $draft['id']]);

// ================================================================ read access (§1.6)

[$s, $rows] = req('GET', '/posts', query: ['orderBy' => 'id']);
eq('anonymous: function rule → published only', [$s, $titles($rows)], [200, ['Published one']]);
eq('subscriber: same filter', $titles(req('GET', '/posts', as: 'sub')[1]), ['Published one']);
eq('author: function rule returns true → drafts visible', $titles(req('GET', '/posts', as: 'alice', query: ['orderBy' => 'id'])[1]), ['Published one', 'Draft one']);
eq('?status= shorthand', $titles(req('GET', '/posts', as: 'ed', query: ['status' => 'draft'])[1]), ['Draft one']);
isProblem('anonymous GET of a draft by id is masked', req('GET', "/posts/{$draft['id']}"), 404, 'not_found');
eq('shorthand read + drafts: anonymous sees published authors only', array_column(req('GET', '/authors')[1], 'name'), ['Alice']);
eq('… editors see every status', array_column(req('GET', '/authors', as: 'ed', query: ['orderBy' => 'id'])[1], 'name'), ['Alice', 'Ghost']);
eq('… authors are below editor', array_column(req('GET', '/authors', as: 'alice')[1], 'name'), ['Alice']);
eq('GET /me', [req('GET', '/me')[1], req('GET', '/me', as: 'alice')[1]], [null, $users['alice']]);
// No identity plugin: there is no issuer, and the only signed-in viewer is a WordPress user.
eq('without first-identity, First has no issuer and no guests', [class_exists(\First\Identity\Plugin::class, false), req('GET', '/auth/config')[1]], [false, ['issuer' => null, 'guests' => false]]);
isProblem('without first-identity, there are no guest sessions', req('POST', '/auth/guest', []), 404, 'not_found');
eq('without first-identity, an "anyone" action runs anonymously', req('POST', '/actions/publishedCount')[0], 200);
isProblem('without first-identity, an "authenticated" action refuses anonymous', req('POST', '/actions/signedInCount'), 401, 'unauthenticated');
eq('without first-identity, a WordPress user is authenticated', req('POST', '/actions/signedInCount', as: 'sub')[0], 200);

// Native post passwords constrain every viewer-bound read before selection, not just its rendered body.
$protected = $db->insert('posts', ['title' => 'Protected native post', 'body' => '<p>native-password-secret</p>'], true)[0];
$public = $db->insert('posts', ['title' => 'Public next page'], true)[0];
wp_update_post(['ID' => $protected['id'], 'post_password' => 'native-secret']);
$anon = new \First\Viewer(null);
$protectedWhere = ['id' => $protected['id']];
isProblem('native password masks First item', req('GET', "/posts/{$protected['id']}"), 404, 'not_found');
eq('native password constrains body-filtered projections', $db->findMany('posts', [
    'where' => ['body' => ['like' => '%native-password-secret%']], 'columns' => ['body' => true],
], $anon), []);
eq('native password is applied before page limits', array_column($db->findMany('posts', [
    'where' => ['id' => ['in' => [$protected['id'], $public['id']]]], 'orderBy' => ['id' => 'asc'], 'limit' => 1,
], $anon), 'id'), [$public['id']]);
$linked = $db->insert('comments', ['postId' => $protected['id'], 'name' => 'Linked', 'body' => 'Visible comment', 'approved' => true], true)[0];
$related = $db->findFirst('comments', ['where' => ['id' => $linked['id']], 'with' => ['post' => true]], $anon);
eq('native password hides attached relation', $related['post'], null);
eq('native password prevents relation-filter inference', $db->findMany('comments', [
    'where' => ['id' => $linked['id'], 'post' => ['body' => ['like' => '%native-password-secret%']]],
], $anon), []);
$wp->actAs('admin');
$nativeController = new \WP_REST_Posts_Controller('first_posts');
add_filter('post_password_required', [$nativeController, 'check_password_required'], 10, 2);
eq('native edit-context filter trusts the ambient administrator', post_password_required($protected['id']), false);
eq('anonymous viewer does not borrow ambient admin authority', $db->findMany('posts', ['where' => $protectedWhere], $anon), []);
eq('subscriber viewer does not borrow ambient admin authority', $db->findMany('posts', ['where' => $protectedWhere], new \First\Viewer($users['sub'])), []);
remove_filter('post_password_required', [$nativeController, 'check_password_required']);
$wp->actAs(null);
eq('explicit editor retains native protected-post editing', $db->findFirst('posts', ['where' => $protectedWhere], new \First\Viewer($users['ed']))['body'] ?? null, $protected['body']);
eq('trusted null viewer retains server authority', $db->findFirst('posts', ['where' => $protectedWhere])['body'], $protected['body']);
$wp->actAs('ed');
$nativeEdit = new \WP_REST_Request('GET', '/wp/v2/first_posts/' . $protected['id']);
$nativeEdit->set_param('context', 'edit');
$nativeEdited = rest_do_request($nativeEdit);
eq('native editor can still load protected content for editing', [$nativeEdited->get_status(), $nativeEdited->get_data()['content']['raw'] ?? null], [200, $protected['body']]);
$wp->actAs(null);
wp_update_post(['ID' => $protected['id'], 'post_password' => '0']);
eq('WordPress empty-password semantics remain public', [post_password_required($protected['id']), $db->findFirst('posts', ['where' => $protectedWhere], $anon)['body'] ?? null], [false, $protected['body']]);
foreach (['0 ', ' ', 'Native-secret', 'native-secret '] as $password) {
    wp_update_post(['ID' => $protected['id'], 'post_password' => $password]);
    eq('only exact empty passwords are public: ' . json_encode($password), $db->findMany('posts', ['where' => $protectedWhere], $anon), []);
}
wp_update_post(['ID' => $protected['id'], 'post_password' => 'native-secret']);
$coreRead = static function () use ($protected) {
    return rest_do_request(new \WP_REST_Request('GET', '/wp/v2/first_posts/' . $protected['id']));
};
eq('native core access shares the password row boundary', $coreRead()->get_status(), 404);
wp_update_post(['ID' => $public['id'], 'post_password' => 'another-native-secret']);
$corePassword = static function (string $password, bool $list = false) use ($protected, $public) {
    $request = new \WP_REST_Request('GET', '/wp/v2/first_posts' . ($list ? '' : '/' . $protected['id']));
    $request->set_query_params(['password' => $password] + ($list ? ['include' => [$protected['id'], $public['id']]] : []));

    return rest_do_request($request);
};
eq('native item rejects a wrong password parameter', $corePassword('wrong-password')->get_status(), 403);
$concealed = new \WP_REST_Request('GET', '/wp/v2/first_posts/' . $draft['id']);
$concealed->set_query_params(['password' => 'wrong-password']);
eq('wrong native password cannot distinguish a schema-hidden row', rest_do_request($concealed)->get_status(), 404);
$unlocked = $corePassword('native-secret');
eq('native item accepts its password parameter', [$unlocked->get_status(), str_contains($unlocked->get_data()['content']['rendered'] ?? '', 'native-password-secret')], [200, true]);
$unlockedList = $corePassword('native-secret', true);
eq('native list accepts its password parameter for matching rows', [$unlockedList->get_status(), array_column($unlockedList->get_data(), 'id'), str_contains($unlockedList->get_data()[0]['content']['rendered'] ?? '', 'native-password-secret')], [200, [$protected['id']], true]);
eq('native list keeps rows locked with the wrong password', $corePassword('wrong-password', true)->get_data(), []);
eq('native password parameter does not authorize a subsequent First read', $db->findMany('posts', ['where' => $protectedWhere], $anon), []);
$nestedProof = null;
$inspectProof = static function ($response, $post) use (&$nestedProof, $coreRead, $corePassword, $db, $protectedWhere, $anon) {
    if ($nestedProof === null) {
        $nestedProof = []; // Nested dispatch must not recurse into this observation.
        $nestedProof = [$coreRead()->get_status(), $corePassword('wrong-password')->get_status(), $db->findFirst('posts', ['where' => $protectedWhere], $anon)['body'] ?? null];
    }

    return $response;
};
add_filter('rest_prepare_first_posts', $inspectProof, 20, 2);
$corePassword('native-secret');
remove_filter('rest_prepare_first_posts', $inspectProof);
eq('nested native requests suspend and then restore the outer password proof', $nestedProof, [404, 403, $protected['body']]);
$wp->actAs('admin');
$borrowedProof = null;
$inspectViewer = static function ($response) use (&$borrowedProof, $db, $protectedWhere, $anon) {
    $borrowedProof = $db->findMany('posts', ['where' => $protectedWhere], $anon);

    return $response;
};
add_filter('rest_prepare_first_posts', $inspectViewer);
$corePassword('native-secret');
remove_filter('rest_prepare_first_posts', $inspectViewer);
$wp->actAs(null);
eq('native admin password proof does not authorize an explicit anonymous viewer', $borrowedProof, []);
wp_update_post(['ID' => $public['id'], 'post_password' => '']);
$ability = wp_get_ability('blog/posts-list');
eq('native password applies to agent ability reads', $ability->execute(['where' => $protectedWhere]), ['rows' => []]);
require_once ABSPATH . WPINC . '/class-phpass.php';
$hasher = new \PasswordHash(8, true);
$_COOKIE['wp-postpass_' . COOKIEHASH] = $hasher->HashPassword('wrong-password');
eq('wrong native cookie keeps protected rows hidden', [post_password_required($protected['id']), $db->findMany('posts', ['where' => $protectedWhere], $anon)], [true, []]);
$_COOKIE['wp-postpass_' . COOKIEHASH] = $hasher->HashPassword('native-secret');
eq('valid native cookie unlocks the same viewer-bound body as WordPress', [post_password_required($protected['id']), $db->findFirst('posts', ['where' => $protectedWhere], $anon)['body'] ?? null, $coreRead()->get_status()], [false, $protected['body'], 200]);
unset($_COOKIE['wp-postpass_' . COOKIEHASH]);
eq('removing password proof invalidates visibility', [$db->findMany('posts', ['where' => $protectedWhere], $anon), $coreRead()->get_status()], [[], 404]);
$wp->startServer();
$wire = json_decode(file_get_contents($wp->url() . '/__first/api/v1/posts/' . $protected['id'], false, stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10]])), true);
eq('anonymous HTTP cannot read a native password-protected record', [$wire['status'] ?? null, $wire['code'] ?? null], [404, 'not_found']);
$db->delete('comments', ['id' => $linked['id']]);
$db->delete('posts', ['id' => ['in' => [$protected['id'], $public['id']]]]);

// Forty unrelated protected rows add one batch query, not one query per row.
$wp->actAs(null);
$protectedIds = [];
for ($i = 0; $i < 40; $i++) {
    $protectedIds[] = wp_insert_post(['post_type' => 'first_posts', 'post_title' => "Batch protected $i", 'post_password' => "batch-secret-$i", 'post_status' => 'publish']);
}
wp_cache_flush();
\First\Wp\CoreAccess::flush();
$queries = $wpdb->num_queries;
$page = $db->findMany('posts', ['where' => ['id' => ['in' => array_merge($protectedIds, [$pub['id']])]], 'orderBy' => ['id' => 'asc'], 'limit' => 1], $anon);
$firstQueries = $wpdb->num_queries - $queries;
eq('batch visibility preserves a full public page', array_column($page, 'id'), [$pub['id']]);
check('protected visibility primes forty posts in a bounded query count', $firstQueries <= 5, $firstQueries);
eq('anonymous pagination never primes unrelated protected posts', wp_cache_get($protectedIds[0], 'posts'), false);
$proofChecks = 0;
$countCapabilities = static function ($caps) use (&$proofChecks) { $proofChecks++; return $caps; };
add_filter('map_meta_cap', $countCapabilities, 1);
$viewer = new \First\Viewer($users['ed']);
$db->findMany('posts', ['limit' => 1], $viewer);
$firstChecks = $proofChecks;
$db->findMany('posts', ['limit' => 1], $viewer);
remove_filter('map_meta_cap', $countCapabilities, 1);
eq('same viewer and proof reuse visibility without rechecking every protected capability', [$firstChecks > 0, $proofChecks], [true, $firstChecks]);
wp_cache_flush();
\First\Wp\CoreAccess::flush();
$failPostLookup = static function (string $sql) use ($wpdb): string {
    return preg_match('/^\s*SELECT\b/i', $sql) && str_contains($sql, $wpdb->posts)
        ? 'SELECT * FROM first_missing_post_storage'
        : $sql;
};
add_filter('query', $failPostLookup);
$suppressed = $wpdb->suppress_errors(true);
try {
    eq('SQL policy still hides protected rows when the WP post-cache lookup fails', $db->findMany('posts', ['where' => ['id' => $protectedIds[0]]], $anon), []);
    problem('unresolved protected posts refuse editor reads', fn () => $db->findMany('posts', ['where' => ['id' => $protectedIds[0]]], $viewer), 503, 'storage_unavailable');
} finally {
    remove_filter('query', $failPostLookup);
    $wpdb->suppress_errors($suppressed);
}
eq('recovered lookups do not reuse permissive visibility from failed reads', $db->findMany('posts', ['where' => ['id' => $protectedIds[0]]], $anon), []);
eq('recovered lookups do not retain failed visibility for an authorized viewer', $db->findFirst('posts', ['where' => ['id' => $protectedIds[0]]], $viewer)['id'] ?? null, $protectedIds[0]);
wp_update_post(['ID' => $protectedIds[0], 'post_password' => '']);
eq('a native write invalidates protected visibility', $db->findFirst('posts', ['where' => ['id' => $protectedIds[0]]], $anon)['id'] ?? null, $protectedIds[0]);
foreach ($protectedIds as $id) { wp_delete_post($id, true); }

// ================================================================ write access

isProblem('anonymous create → 401', req('POST', '/posts', ['title' => 'x']), 401, 'unauthenticated');
isProblem('subscriber create → 403', req('POST', '/posts', ['title' => 'x'], 'sub'), 403, 'forbidden');
[$s, $mine] = req('POST', '/posts', ['title' => 'Alice writes', 'status' => 'draft'], 'alice');
eq('author creates; beforeCreate saw ctx.user and filled authorId', [$s, $mine['authorId'] ?? null], [201, $aliceProfile['id']]);
[$s, $bobs] = req('POST', '/posts', ['title' => 'Bob writes'], 'bob');
eq('no profile → authorId stays null', [$s, array_key_exists('authorId', $bobs), $bobs['authorId']], [201, true, null]);
isProblem('update filter: another author\'s post is masked as 404', req('PATCH', "/posts/{$mine['id']}", ['title' => 'hijack'], 'bob'), 404, 'not_found');
eq('update filter: own post', req('PATCH', "/posts/{$mine['id']}", ['excerpt' => 'mine'], 'alice')[1]['excerpt'] ?? null, 'mine');
eq('editor updates anyone\'s', req('PATCH', "/posts/{$bobs['id']}", ['excerpt' => 'edited'], 'ed')[1]['excerpt'] ?? null, 'edited');
isProblem('delete is editor+', req('DELETE', "/posts/{$mine['id']}", as: 'alice'), 403, 'forbidden');
isProblem('function rule returning a filter for anonymous → masked 404', req('PATCH', "/posts/{$pub['id']}", ['title' => 'x']), 404, 'not_found');
isProblem('role rule, anonymous → 401 before any lookup', req('PATCH', '/comments/999999', ['name' => 'x']), 401, 'unauthenticated');

// ================================================================ validation pointers, references

isProblem('nested rule pointer', req('POST', '/posts', ['title' => 'G', 'gallery' => [['image' => 1, 'caption' => str_repeat('c', 121)]]], 'ed'), 422, 'invalid_input', '/gallery/0/caption');
isProblem('dangling reference (pipeline-checked)', req('POST', '/posts', ['title' => 'R', 'authorId' => 999], 'ed'), 409, 'reference_violation', '/authorId');
isProblem('unique email', req('POST', '/authors', ['name' => 'A2', 'email' => 'alice@example.com'], 'admin'), 409, 'unique_violation', '/email');

// ================================================================ slugs (§3.3 4b)

eq('slug derived from the source column', $mine['slug'], 'alice-writes');
$dup = req('POST', '/posts', ['title' => 'Alice Writes!'], 'ed')[1];
eq('collision → -2', $dup['slug'], 'alice-writes-2');
eq('explicit slug kept', req('POST', '/posts', ['title' => 'T', 'slug' => 'custom'], 'ed')[1]['slug'], 'custom');
eq('title change alone keeps the slug', req('PATCH', "/posts/{$dup['id']}", ['title' => 'Renamed'], 'ed')[1]['slug'], 'alice-writes-2');
eq('slug: null re-derives', req('PATCH', "/posts/{$dup['id']}", ['slug' => null], 'ed')[1]['slug'], 'renamed');

// ================================================================ comments: rule filter, nested with, action access, hook ctx

[$s, $c1] = req('POST', '/comments', ['postId' => $pub['id'], 'name' => 'Anon', 'body' => 'Nice'], null);
eq('anonymous create (create: anyone), unapproved', [$s, $c1['approved'] ?? null], [201, false]);
isProblem('validate message reaches the API', req('POST', '/comments', ['postId' => $pub['id'], 'name' => 'S', 'body' => 'http://spam']), 422, 'invalid_input', '/body');
eq('anonymous: unapproved comments filtered', req('GET', '/comments')[1], []);
$withComments = req('GET', "/posts/{$pub['id']}", query: ['with' => 'comments'])[1];
eq('nested with applies the target read rule', $withComments['comments'], []);
eq('signed-in readers see them through with', count(req('GET', "/posts/{$pub['id']}", as: 'sub', query: ['with' => '{"comments":true}'])[1]['comments']), 1);
isProblem('action access: anonymous', req('POST', '/actions/approveComment', ['id' => $c1['id']]), 401, 'unauthenticated');
isProblem('action access: author below editor', req('POST', '/actions/approveComment', ['id' => $c1['id']], 'alice'), 403, 'forbidden');
eq('editor approves through the action', req('POST', '/actions/approveComment', ['id' => $c1['id']], 'ed')[1]['approved'] ?? null, true);
eq('approved comment now public', count(req('GET', '/comments')[1]), 1);
$staff = req('POST', '/comments', ['postId' => $pub['id'], 'name' => 'Ed', 'body' => 'Staff'], 'ed')[1];
eq('staff comment approved on sight (afterCreate saw ctx.user)', $db->findFirst('comments', ['where' => ['id' => $staff['id']]])['approved'], true);
eq('action access "anyone"; the handler\'s db is trusted and filters status itself', req('POST', '/actions/publishedCount')[1], ['count' => 4]);

// ================================================================ scheduling (§6.3)

// Posts are WordPress posts: a scheduled row is a `future` post, hidden until WP cron publishes it
// (promotion itself is proven in tests/wp/rest.test.ts, where cron runs).
$future = '2031-01-01T00:00:00.000Z';
[$s, $sched] = req('POST', '/posts', ['title' => 'Later', 'status' => 'scheduled', 'publishedAt' => $future], 'ed');
eq('editor schedules', [$s, $sched['status'] ?? null, get_post_status($sched['id'])], [201, 'scheduled', 'future']);
check('scheduled is invisible to anonymous', !in_array('Later', $titles(req('GET', '/posts')[1]), true));
eq('… and listed for editors with its date', [in_array('Later', $titles(req('GET', '/posts', as: 'ed')[1]), true), $db->findFirst('posts', ['where' => ['id' => $sched['id']]])['publishedAt']], [true, $future]);

// ================================================================ revisions (§6.4)

$p = req('POST', '/posts', ['title' => 'Rev 1', 'excerpt' => 'first'], 'alice')[1];
req('PATCH', "/posts/{$p['id']}", ['title' => 'Rev 2', 'excerpt' => 'second'], 'alice');
\First\Extensions::onRead(static function (array $rows, string $c, ?\First\Viewer $viewer): array {
    if ($c === 'posts' && $viewer !== null) {
        foreach ($rows as &$row) {
            if (in_array($row['title'], ['Rev 1', 'Rev 2'], true)) {
                unset($row['excerpt']);
            }
        }
        unset($row);
    }

    return $rows;
}, constraintSafe: true);
[$s, $list] = req('GET', "/posts/{$p['id']}/revisions", as: 'alice');
eq('one revision per create/update, newest first, with the user', [$s, count($list), $list[0]['user'] ?? null, $list[0]['id'] > $list[1]['id']], [200, 2, ['id' => $users['alice']['id'], 'name' => 'alice'], true]);
eq('revision row is the state written then', req('GET', "/posts/{$p['id']}/revisions/{$list[1]['id']}", as: 'alice')[1]['title'] ?? null, 'Rev 1');
isProblem('revisions need update access on the row (other author: masked)', req('GET', "/posts/{$p['id']}/revisions", as: 'bob'), 404, 'not_found');
isProblem('unknown revision', req('GET', "/posts/{$p['id']}/revisions/999999", as: 'alice'), 404, 'not_found');
[$s, $restored] = req('POST', "/posts/{$p['id']}/revisions/{$list[1]['id']}/restore", as: 'alice');
eq('restore uses full revision data while hiding response fields', [
    $s, $restored['title'] ?? null, array_key_exists('excerpt', $restored),
    $db->findFirst('posts', ['where' => ['id' => $p['id']]])['excerpt'],
    count(req('GET', "/posts/{$p['id']}/revisions", as: 'alice')[1]),
], [200, 'Rev 1', false, 'first', 3]);
isProblem('collections without revisions', req('GET', "/comments/{$c1['id']}/revisions", as: 'ed'), 404, 'not_found');

// ================================================================ globals (§3.6)

eq('never written → defaults', req('GET', '/globals/settings')[1], ['siteTitle' => 'My blog', 'tagline' => null, 'postsPerPage' => 10, 'social' => null]);
isProblem('update needs editor: anonymous', req('PATCH', '/globals/settings', ['tagline' => 'x']), 401, 'unauthenticated');
isProblem('update needs editor: author', req('PATCH', '/globals/settings', ['tagline' => 'x'], 'alice'), 403, 'forbidden');
isProblem('nested validation in a global', req('PATCH', '/globals/settings', ['social' => [['label' => 'X', 'href' => 'nope']]], 'ed'), 422, 'invalid_input', '/social/0/href');
isProblem('rules in a global', req('PATCH', '/globals/settings', ['postsPerPage' => 0], 'ed'), 422, 'invalid_input', '/postsPerPage');
isProblem('unknown global field', req('PATCH', '/globals/settings', ['nope' => 1], 'ed'), 422, 'invalid_input', '/nope');
req('PATCH', '/globals/settings', ['tagline' => 'Hi', 'social' => [['label' => 'Site', 'href' => 'https://example.com']]], 'ed');
eq('patch merges; untouched fields keep their defaults', req('PATCH', '/globals/settings', ['postsPerPage' => 20], 'ed')[1],
    ['siteTitle' => 'My blog', 'tagline' => 'Hi', 'postsPerPage' => 20, 'social' => [['label' => 'Site', 'href' => 'https://example.com']]]);
eq('trusted db sees the same values', $db->globalGet('settings')['postsPerPage'], 20);
isProblem('unknown global', req('GET', '/globals/nope'), 404, 'not_found');

// Native SCF writes cross WordPress's scalar-meta serialization before First decodes them.
// A nullable boolean must retain explicit false separately from null and an omitted default.
(static function () use ($db): void {
    $fields = ['featured' => ['type' => 'boolean', 'default' => ['value' => false]]];
    // Each type has a separate SCF writer and a different sub-field key shape.
    foreach ([
        'group' => ['type' => 'group', 'fields' => $fields],
        'repeater' => ['type' => 'repeater', 'fields' => $fields],
        'blocks' => ['type' => 'blocks', 'layouts' => ['toggle' => $fields]],
    ] as $type => $def) {
        $key = 'field_first_nullable_' . $type;
        $field = \First\Wp\Scf::fieldFor($db->schema(), $key, 'first_nullable_' . $type, 'probe', $def, []);
        acf_add_local_field_group(['key' => 'group_first_nullable_' . $type, 'title' => 'Nullable probe', 'fields' => [$field]]);
        $id = wp_insert_post(['post_type' => 'post', 'post_title' => 'SCF round trip', 'post_status' => 'draft']);
        $save = static function (array $input) use ($id, $key, $def, $type): mixed {
            $raw = match ($type) {
                'group' => $input,
                'repeater' => [$input],
                'blocks' => [['acf_fc_layout' => 'toggle'] + $input],
            };
            update_field($key, $raw, $id);
            $row = \First\Wp\Scf::fromScf($def, get_field($key, $id, false), $key);

            return ($type === 'group' ? $row : $row[0])['featured'];
        };
        if ($type === 'group') {
            eq('SCF omitted nested boolean takes its declared default', $save([]), false);
        }
        eq("SCF $type nullable false survives WordPress meta storage", $save(['featured' => false]), false);
        eq("SCF $type explicit null stays null", $save(['featured' => null]), null);
        eq("SCF $type checked nullable boolean stays true", $save(['featured' => true]), true);
        wp_delete_post($id, true);
    }
})();

\First\Features::register(); // Re-registering bootstrap modules must not duplicate the media route.

// ================================================================ media (§4.6)

$png = tempnam(sys_get_temp_dir(), 'zimg');
$im = imagecreatetruecolor(3, 2);
imagepng($im, $png);
$txt = tempnam(sys_get_temp_dir(), 'ztxt');
file_put_contents($txt, 'plain text');
$upload = static fn (string $path, string $name, ?string $as, array $form = []) => req('POST', '/media', as: $as, files: ['file' => ['name' => $name, 'tmp_name' => $path, 'error' => UPLOAD_ERR_OK, 'size' => filesize($path)]], form: $form);

isProblem('upload needs author: anonymous', $upload($png, 'a.png', null), 401, 'unauthenticated');
[$s, $img] = $upload($png, 'cover.png', 'alice', ['alt' => 'A cover']);
check('upload → 201 media row, an attachment under wp-content/uploads', $s === 201 && $img['mime'] === 'image/png' && [$img['width'], $img['height']] === [3, 2]
    && $img['alt'] === 'A cover' && $img['filename'] === 'cover.png' && preg_match('#/wp-content/uploads/\d{4}/\d{2}/cover\.png$#', $img['url']) === 1
    && is_file($wp->uploadPath($img['url'])) && get_post_type($img['id']) === 'attachment', $img);
$doc = $upload($txt, 'notes.txt', 'alice')[1];
isProblem('missing file part', req('POST', '/media', as: 'alice'), 422, 'invalid_input', '/file');
isProblem('accept: image rejects other mimes', req('PATCH', "/posts/{$mine['id']}", ['cover' => $doc['id']], 'alice'), 422, 'invalid_input', '/cover');
isProblem('unknown media id', req('PATCH', "/posts/{$mine['id']}", ['cover' => 999999], 'alice'), 422, 'invalid_input', '/cover');
req('PATCH', "/posts/{$mine['id']}", ['cover' => $img['id']], 'alice');
eq('without with: the id', req('GET', "/posts/{$mine['id']}", as: 'alice')[1]['cover'], $img['id']);
eq('with: { cover: true } populates in place', req('GET', "/posts/{$mine['id']}", as: 'alice', query: ['with' => '{"cover":true}'])[1]['cover'], $img);
eq('GET /media/{id} and list', [req('GET', "/media/{$img['id']}")[1], array_column(req('GET', '/media', query: ['where' => '{"mime":"image/png"}'])[1], 'id')], [$img, [$img['id']]]);
eq('an empty media filter object is no filter', [req('GET', '/media', query: ['where' => '{}'])[0], req('GET', '/media', query: ['where' => '{"AND":[{}]}'])[0]], [200, 200]);
isProblem('media delete needs editor', req('DELETE', "/media/{$img['id']}", as: 'alice'), 403, 'forbidden');
$revs = count($db->revisions('posts', $mine['id']));
eq('editor deletes', req('DELETE', "/media/{$img['id']}", as: 'ed')[1]['id'] ?? null, $img['id']);
$after = $db->findFirst('posts', ['where' => ['id' => $mine['id']]]);
eq('referencing media columns nulled through the pipeline (revision written)', [$after['cover'], count($db->revisions('posts', $mine['id']))], [null, $revs + 1]);
check('file removed after commit', !is_file($wp->uploadPath($img['url'])));
isProblem('deleted media is gone', req('GET', "/media/{$img['id']}"), 404, 'not_found');

// ================================================================ FK actions in the pipeline (§4.2)

$db->delete('authors', ['id' => $aliceProfile['id']]);
eq('onDelete set null', array_unique(array_column($db->findMany('posts', ['where' => ['id' => ['in' => [$pub['id'], $mine['id']]]]]), 'authorId')), [null]);
$db->delete('posts', ['id' => $pub['id']]);
eq('onDelete cascade', $db->findMany('comments', ['where' => ['postId' => $pub['id']]]), []);

// ================================================================ extension seams

\First\SystemTables::register('seam', [
    'CREATE TABLE IF NOT EXISTS `{prefix}first__seam` (`id` BIGINT NOT NULL AUTO_INCREMENT, `event` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB',
    static function (\First\Store $store): void {
        $db = $store instanceof \First\Wp\CompositeStore ? $store->db : throw new \LogicException('the upgrade needs the WordPress store');
        $have = $db->run('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$db->prefix() . 'first__seam', 'extra']);
        if ($have === []) {
            $store->applySystemStatements(['ALTER TABLE `{prefix}first__seam` ADD COLUMN `extra` LONGTEXT']);
        }
    },
]);
\First\SystemTables::apply($db->store());
$wp->exec('INSERT INTO {prefix}first__seam (`id`, `event`, `extra`) VALUES (1, ?, ?)', ['kept', 'upgraded']);
\First\SystemTables::apply($db->store());
eq('idempotent system DDL and guarded ALTER preserve data', $wp->sql('SELECT `event`, `extra` FROM {prefix}first__seam')[0], ['event' => 'kept', 'extra' => 'upgraded']);
problem('system DDL rejects request transactions', fn () => $db->transaction(fn () => \First\SystemTables::apply($db->store())), 500, 'internal');

$transformMutationRows = false;
\First\Extensions::onRead(static function (array $rows, string $c) use (&$transformMutationRows): array {
    if ($transformMutationRows && $c === 'posts') {
        foreach ($rows as &$row) {
            $row['excerpt'] = 'display only';
        }
        unset($row);
    }

    return $rows;
}, constraintSafe: true);
\First\Extensions::normalizeWrite(static function (string $op, string $c, array &$data, ?array $existing): void {
    if ($c === 'posts') {
        unset($data['translationOf']);
        if (array_key_exists('password', $data)) {
            eq('input normalization receives the full stored row', $existing['excerpt'], 'extension');
            $data['excerpt'] = $data['password'];
            unset($data['password']);
        }
    }
});
\First\Extensions::onWrite(static function (string $op, string $c, array &$data, ?array $existing, ?\First\Viewer $viewer, array $provided): void {
    if ($c === 'posts' && ($data['title'] ?? '') === 'Extension') {
        eq('write extension retains virtual input and distinguishes it from defaults', $provided, ['title' => 'Extension', 'translationOf' => 123]);
        // Defaults precede the extension, and the application hook derives authorId afterwards.
        $data['title'] = $data['status'] . ' ' . $viewer->user['name'];
        $data['excerpt'] = 'extension';
    }
    if ($c === 'posts' && $op === 'update' && ($data['excerpt'] ?? '') === 'revise') {
        eq('update extension retains the original virtual patch', $provided, ['password' => 'revise']);
        $data['excerpt'] = $existing['excerpt'] . ' revised';
    }
    if ($c === 'posts' && $op === 'delete' && $data['excerpt'] === 'extension revised') {
        throw new \First\JsError('extension refused delete');
    }
});
\First\Extensions::onWritten(static function (string $op, string $c, array $row, ?array $previous) use ($db): void {
    if ($c !== 'posts' || !str_starts_with($row['excerpt'] ?? '', 'extension')) {
        return;
    }
    $db->insert('comments', ['postId' => $row['id'], 'name' => $op, 'body' => $previous['excerpt'] ?? 'created']);
    if ($row['excerpt'] === 'extension fail') {
        throw new \First\JsError('extension rolled back');
    }
    \First\Extensions::afterCommit(static function () use ($db, $op, $row): void {
        $GLOBALS['wp']->exec('INSERT INTO {prefix}first__seam (`event`) VALUES (?)', [$op . ':' . $row['excerpt']]);
    });
});
$seamAuthor = $db->insert('authors', ['name' => 'Alice again', 'email' => 'again@example.com', 'userId' => $users['alice']['id']], true)[0];
[$status, $seam] = req('POST', '/posts', ['title' => 'Extension', 'translationOf' => 123], 'alice');
eq('write extension sees defaults and viewer before the application hook', [$status, $seam['title'], $seam['excerpt'], $seam['authorId']], [201, 'published alice', 'extension', $seamAuthor['id']]);
$transformMutationRows = true;
$seam = req('PATCH', '/posts/' . $seam['id'], ['password' => 'revise'], 'ed')[1];
$transformMutationRows = false;
eq('update extension receives stored data and transforms only its response', [
    $seam['excerpt'], $db->findFirst('posts', ['where' => ['id' => $seam['id']]])['excerpt'],
], ['display only', 'extension revised']);
isProblem('normalization still rejects unconsumed create inputs', req('POST', '/posts', ['title' => 'Rejected', 'unknown' => true], 'ed'), 422, 'invalid_input', '/unknown');
isProblem('normalization still rejects unconsumed update inputs', req('PATCH', '/posts/' . $seam['id'], ['unknown' => true], 'ed'), 422, 'invalid_input', '/unknown');
eq('written extension can nest writes and schedule durable effects', [
    array_column($db->findMany('comments', ['where' => ['postId' => $seam['id']], 'orderBy' => ['id' => 'asc']]), 'body'),
    array_column($wp->sql('SELECT `event` FROM {prefix}first__seam ORDER BY `id`'), 'event'),
], [['created', 'extension'], ['kept', 'create:extension', 'update:extension revised']]);
isProblem('written extension failure rolls back row and nested effects', req('PATCH', '/posts/' . $seam['id'], ['excerpt' => 'extension fail'], 'ed'), 422, 'rejected');
eq('failed write preserves row and nested data', [
    $db->findFirst('posts', ['where' => ['id' => $seam['id']]])['excerpt'],
    count($db->findMany('comments', ['where' => ['postId' => $seam['id']]])),
    $wp->scalar('SELECT COUNT(*) FROM {prefix}first__seam'),
], ['extension revised', 2, 3]);
$transformMutationRows = true;
isProblem('delete extension receives stored data before deletion', req('DELETE', '/posts/' . $seam['id'], as: 'ed'), 422, 'rejected');
$transformMutationRows = false;

// The lookup seam primes a page cache which a read transform consumes, including nested relations.
$cache = [];
\First\Extensions::onLookup(static function (string $c, array $pks) use (&$cache): void {
    $cache[$c] = array_fill_keys($pks, 'looked up');
});
// Receipt display changes no row membership or constraint values.
\First\Extensions::onRead(static function (array $rows, string $c, ?\First\Viewer $viewer) use (&$cache): array {
    if ($viewer !== null && $c === 'posts') {
        foreach ($rows as &$row) {
            if ($row['title'] === 'Replay seam') {
                $row['excerpt'] = $cache[$c][$row['id']] ?? 'missing cache';
            }
        }
        unset($row);
    }

    return $rows;
}, constraintSafe: true);

// The receipt and download proofs run before the linkage-hiding read transform below is registered:
// that transform is not constraint-safe, so viewer-bound unique writes are refused once it exists (#72).
\First\Extensions::aroundOperation(static function (string $scope, array $spec, string $raw, array $headers, ?\First\Viewer $viewer, callable $next) use ($wp): \First\Response {
    if (!isset($headers['idempotency-key'])) {
        return $next();
    }
    $key = 'receipt:' . $scope . ':' . ($viewer?->user['id'] ?? 'anonymous') . ':' . $headers['idempotency-key'];
    $stored = $wp->scalar('SELECT `extra` FROM {prefix}first__seam WHERE `event` = ?', [$key]);
    if ($stored !== null) {
        $receipt = json_decode($stored, true);

        return \First\Response::json($receipt['data'], $receipt['status'], ['Idempotent-Replayed' => 'true']);
    }
    $result = $next();
    $wp->exec('INSERT INTO {prefix}first__seam (`event`, `extra`) VALUES (?, ?)', [$key, json_encode(\First\Seam::toWire(['status' => $result->status, 'data' => $result->data]))]);
    if ($headers['idempotency-key'] === 'fail') {
        throw new \First\JsError('Receipt persistence failed');
    }

    return $result;
});
$receiptHeaders = ['Idempotency-Key' => 'create'];
$firstReceipt = $wp->handle('POST', '/posts', '{"title":"Replay seam"}', 'ed', $receiptHeaders);
$cache = [];
$replayReceipt = $wp->handle('POST', '/posts', '{"title":"Replay seam"}', 'ed', $receiptHeaders);
eq('create replay primes fresh lookup caches without repeating its write pipeline', [
    $firstReceipt[0], $replayReceipt[0], $replayReceipt[1]['Idempotent-Replayed'], $firstReceipt[2] === $replayReceipt[2],
    json_decode($replayReceipt[2], true)['data']['excerpt'],
    count($db->findMany('posts', ['where' => ['title' => 'Replay seam']])),
], [201, 201, 'true', true, 'looked up', 1]);
eq('create authorization still runs before replay middleware', $wp->handle('POST', '/posts', '{"title":"Replay seam"}', null, ['Idempotency-Key' => 'create'])[0], 401);
$failedReceipt = $wp->handle('POST', '/posts', '{"title":"Rolled back receipt"}', 'ed', ['Idempotency-Key' => 'fail']);
eq('failed operation wrapper rolls back both its result and receipt', [
    $failedReceipt[0], $db->findMany('posts', ['where' => ['title' => 'Rolled back receipt']]),
    $wp->scalar('SELECT COUNT(*) FROM {prefix}first__seam WHERE `event` LIKE ?', ['receipt:%:fail']),
], [422, [], 0]);

\First\Extensions::route('download-proof', static function () use ($wp): \First\Response {
    $wp->exec('INSERT INTO {prefix}first__seam (`event`) VALUES (?)', ['download prepared']);
    \First\Extensions::afterCommit(static fn () => $wp->exec('INSERT INTO {prefix}first__seam (`event`) VALUES (?)', ['download committed']));

    return \First\Response::raw(static function () use ($wp): void {
        echo "file\0bytes:" . $wp->scalar('SELECT `event` FROM {prefix}first__seam ORDER BY `id` DESC LIMIT 1');
    }, 200, ['content-type' => 'text/plain', 'Content-Disposition' => 'attachment; filename="proof.bin"', 'Cache-Control' => 'public'])
        ->withHeaders(['CACHE-CONTROL' => 'private, no-store',
            'access-control-allow-origin' => 'https://app.example',
            'access-control-expose-headers' => 'Content-Disposition']);
});
[$downloadStatus, $downloadHeaders, $downloadBody] = $wp->handle('GET', '/download-proof');
ob_start();
\First\Response::emit($downloadBody);
$emitted = ob_get_clean();
eq('download response streams raw bytes and headers after commit', [
    $downloadStatus, $downloadHeaders['content-type'], $downloadHeaders['Content-Disposition'], $downloadHeaders['CACHE-CONTROL'], $emitted,
    $downloadHeaders['access-control-allow-origin'], $downloadHeaders['access-control-expose-headers'],
    count($downloadHeaders) === count(array_change_key_case($downloadHeaders)),
], [200, 'text/plain', 'attachment; filename="proof.bin"', 'private, no-store', "file\0bytes:download committed", 'https://app.example', 'Content-Disposition', true]);

\First\Extensions::onRead(static function (array $rows, string $c, ?\First\Viewer $viewer) use (&$cache): array {
    if ($viewer === null) {
        return $rows;
    }
    foreach ($rows as &$row) {
        if ($c === 'posts' && $row['excerpt'] === 'extension revised') {
            $row['excerpt'] = $cache[$c][$row['id']] . (isset($row['comments']) ? ' after with' : ' before with');
            unset($row['authorId'], $row['cover']);
        } elseif ($c === 'comments' && in_array($row['name'], ['create', 'update'], true)) {
            $row['body'] = $cache[$c][$row['id']] . ($row['approved'] === true ? ' decoded' : ' raw');
            unset($row['postId']);
        }
    }
    unset($row);

    return $rows;
});
$read = req('GET', '/posts/' . $seam['id'], as: 'ed', query: ['with' => 'comments,author,cover'])[1];
eq('lookup precedes decoded read transforms, before with, at every relation level', [$read['excerpt'], array_column($read['comments'], 'body')], ['looked up before with', ['looked up decoded', 'looked up decoded']]);

eq('read stripping keeps relation linkage private and does not resurrect populated media', [
    array_key_exists('authorId', $read), array_key_exists('cover', $read),
    $read['author']['id'], array_key_exists('postId', $read['comments'][0]),
], [false, false, $seamAuthor['id'], false]);
$revisionId = $db->revisions('posts', $seam['id'])[0]['id'];
eq('revisions use the same read transform', array_key_exists('authorId', req('GET', '/posts/' . $seam['id'] . '/revisions/' . $revisionId, as: 'ed')[1]), false);
eq('write responses use the read transform after trusted hooks', array_key_exists('authorId', req('PATCH', '/posts/' . $seam['id'], ['body' => 'changed'], 'ed')[1]), false);
\First\Extensions::beforeRead(static function (string $c, array &$opts, ?\First\Viewer $viewer): void {
    if (isset($opts['idsOnly'])) {
        $opts['columns'] = ['id' => true];
        unset($opts['idsOnly']);
    }
    if ($c !== 'posts') {
        return;
    }
    if ($viewer !== null && isset($opts['orderBy']['excerpt'])) {
        throw new \First\HttpError(403, 'forbidden', 'Cannot order by transformed data', '/orderBy/excerpt');
    }
    if (isset($opts['seamId'])) {
        $opts['where'] = ['id' => $opts['seamId']];
        unset($opts['seamId']);
    }
    if (array_key_exists('locale', $opts)) {
        if ($opts['locale'] !== 'de') {
            throw \First\HttpError::invalidQuery('Unsupported test locale', '/locale');
        }
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['title' => 'published alice']]];
        unset($opts['locale']);
    }
});
eq('query extensions normalize filters and projections at every relation level', $db->findMany('posts', [
    'seamId' => $seam['id'], 'idsOnly' => true, 'with' => ['author' => ['idsOnly' => true]],
]), [['id' => $seam['id'], 'author' => ['id' => $seamAuthor['id']]]]);
problem('query extensions reject forbidden selectors before the query', fn () => $db->findMany('posts', ['orderBy' => ['excerpt' => 'asc']], new \First\Viewer($users['ed'])), 403, 'forbidden', '/orderBy/excerpt');
eq('REST list and item queries deliver feature options before SQL', [
    array_column(req('GET', '/posts', as: 'ed', query: ['locale' => 'de'])[1], 'id'),
    req('GET', '/posts/' . $seam['id'], as: 'ed', query: ['locale' => 'de'])[1]['id'],
], [[$seam['id']], $seam['id']]);
isProblem('feature query validation reaches item REST', req('GET', '/posts/' . $seam['id'], query: ['locale' => 'invalid']), 400, 'invalid_query', '/locale');
isProblem('unconsumed feature options remain invalid on other collections', req('GET', '/authors', query: ['locale' => 'de']), 400, 'invalid_query', '/locale');

$db->setActor($users['sub']);
$invoked = $app->invoke('POST', '/comments', [], ['postId' => $seam['id'], 'name' => 'dispatch', 'body' => 'approved as editor'], new \First\Viewer($users['ed']));
eq('operation invocation uses explicit authority and restores its caller actor', [$db->findFirst('comments', ['where' => ['id' => $invoked['id']]])['approved'], $db->actor()], [true, $users['sub']]);
problem('operation invocation throws access errors without serializing them', fn () => $app->invoke('POST', '/actions/approveComment', [], ['id' => $invoked['id']], new \First\Viewer($users['sub'])), 403, 'forbidden');
eq('throwing operation invocation also restores the caller actor', $db->actor(), $users['sub']);
$db->setActor(null);

\First\Extensions::schemaDescribe(static fn (array $d): array => $d + ['seam' => ['version' => 1]]);
eq('public schema description extensions reach HTTP', req('GET', '/_schema')[1]['seam'], ['version' => 1]);

\First\Extensions::route('posts', static function (string $method, array $segments, array $query, string $body, \First\Viewer $viewer, array $files, array $form): array {
    App::allow($method, ['POST']);

    return [202, [$segments, $query, $body, $viewer->user['name'] ?? null, $files, $form]];
});
eq('route extension owns a prefix before collections and receives all request parts',
    req('POST', '/posts/a%20b/c/d/e/f', ['raw' => true], 'ed', ['q' => 'value'], ['file' => ['name' => 'x']], ['alt' => 'y']),
    [202, [['posts', 'a b', 'c', 'd', 'e', 'f'], ['q' => 'value'], '{"raw":true}', 'ed', ['file' => ['name' => 'x']], ['alt' => 'y']]]);
isProblem('extension errors use the normal problem envelope', req('GET', '/posts'), 405, 'method_not_allowed');
isProblem('prefix dispatch matches complete segments', req('GET', '/postsExtra'), 404, 'not_found');

\First\Extensions::beforeAction(static function (array $spec, string $name, string $raw, array $headers, ?\First\Viewer $viewer): void {
    if ($name === 'approveComment' && ($headers['x-proof'] ?? '') !== hash('sha256', $raw)) {
        throw new \First\HttpError(403, 'forbidden', 'Bad raw-body proof');
    }
    if ($name === 'publishedCount' && $viewer === null && trim($raw) === '{"reject":true}') {
        throw new \First\JsError('CLI action extension');
    }
});
$seamComment = $db->findFirst('comments', ['where' => ['postId' => $seam['id']]]);
$raw = '{ "id": ' . $seamComment['id'] . ' }';
[$s, , $out] = $wp->handle('POST', '/actions/approveComment', $raw, 'ed', ['X-Proof' => hash('sha256', $raw)]);
eq('action invocation extension gets exact raw body and normalized headers', [$s, json_decode($out, true)['data']['id']], [200, $seamComment['id']]);
[$s, , $out] = $wp->handle('POST', '/actions/approveComment', $raw, 'ed');
eq('action extension may reject before handler execution', [$s, json_decode($out, true)['code']], [403, 'forbidden']);
$actionHeaders = ['x-proof' => hash('sha256', $raw), 'idempotency-key' => 'action'];
$wp->handle('POST', '/actions/approveComment', $raw, 'ed', $actionHeaders);
[$s, $replayedHeaders, $out] = $wp->handle('POST', '/actions/approveComment', $raw, 'ed', $actionHeaders);
eq('action middleware receives result and can replay it with response metadata', [$s, $replayedHeaders['Idempotent-Replayed'], json_decode($out, true)['data']['id']], [200, 'true', $seamComment['id']]);
$actionHeaders['x-proof'] = 'invalid';
eq('action signature guard still runs before replay middleware', $wp->handle('POST', '/actions/approveComment', $raw, 'ed', $actionHeaders)[0], 403);
[$code, $out] = $app->cli(['action', 'publishedCount', '{"reject":true}']);
eq('trusted CLI actions share the invocation extension', [$code, json_decode($out, true)['error']['code']], [1, 'rejected']);
\First\Extensions::cli('seam', static function (array $args, array $flags) use ($wp): array {
    $wp->exec('INSERT INTO {prefix}first__seam (`event`) VALUES (?)', [$args[0]]);
    if (isset($flags['fail'])) {
        throw new \First\JsError('CLI extension rollback');
    }

    return ['args' => $args, 'flags' => $flags];
});
[$code, $out] = $app->cli(['seam', 'saved', '--mode=local']);
eq('CLI extension runs through the canonical envelope', [$code, json_decode($out, true)['data']], [0, ['args' => ['saved'], 'flags' => ['mode' => 'local']]]);
$app->cli(['seam', 'discarded', '--fail']);
eq('CLI extension effects join the command transaction', $wp->scalar('SELECT `event` FROM {prefix}first__seam ORDER BY `id` DESC LIMIT 1'), 'saved');

try {
    \First\Extensions::route('sync', static fn (): array => [200, null]);
    check('a second owner for an extension route is refused', false);
} catch (\LogicException) {
    check('a second owner for an extension route is refused', true);
}

finish('blog_test');
