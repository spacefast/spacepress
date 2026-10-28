<?php

declare(strict_types=1);

/*
 * The v2 pipeline on the blog fixture, in-process through App::handle against a real SQLite file:
 * access (role ladder, filter rules, 401/403/404 masking, nested `with`), drafts transitions, lazy
 * promotion, slug derivation, revisions, hook ctx, globals, media (+ delete nulling), FK actions.
 */

use Zero\App;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = blogApp(sys_get_temp_dir() . '/zero-blog-test-' . bin2hex(random_bytes(4)));
putenv('ZERO_DB_PATH');
putenv('ZERO_AUTO_MIGRATE');
putenv('ZERO_NOW');
ini_set('error_log', "$root/error.log");
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));

require "$root/zero/runtime/bootstrap.php";
$app = App::boot($root);
$db = \Zero\db();
$ids = $app->identity();

$tokens = [];
$users = [];
foreach (['admin' => 'admin', 'ed' => 'editor', 'alice' => 'author', 'bob' => 'author', 'sub' => 'subscriber'] as $name => $role) {
    $users[$name] = $ids->addUser($name, $role, null);
    $tokens[$name] = $ids->createToken($name, null)['token'];
}

/** @return array{int, mixed} [status, data or problem] */
function req(string $method, string $path, mixed $body = null, ?string $as = null, array $query = [], array $files = [], array $form = []): array
{
    global $app, $tokens;
    $headers = $as === null ? [] : ['authorization' => 'Bearer ' . $tokens[$as]];
    [$status, , $out] = $app->handle($method, $path, $query, $body === null ? '' : json_encode($body), $headers, $files, $form);
    $json = json_decode($out, true);

    return [$status, $status < 300 ? ($json['data'] ?? null) : $json];
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

// ================================================================ lazy promotion (§6.3)

$future = '2031-01-01T00:00:00.000Z';
[$s, $sched] = req('POST', '/posts', ['title' => 'Later', 'status' => 'scheduled', 'publishedAt' => $future], 'ed');
eq('editor schedules', [$s, $sched['status'] ?? null], [201, 'scheduled']);
check('scheduled is invisible to anonymous', !in_array('Later', $titles(req('GET', '/posts')[1]), true));
$revsBefore = count($db->revisions('posts', $sched['id']));
putenv('ZERO_NOW=2031-01-01T00:00:01Z');
eq('first request after the time promotes it', in_array('Later', $titles(req('GET', '/posts')[1]), true), true);
putenv('ZERO_NOW');
$row = $db->findFirst('posts', ['where' => ['id' => $sched['id']]]);
eq('promotion keeps publishedAt, writes no revision', [$row['status'], $row['publishedAt'], count($db->revisions('posts', $sched['id']))], ['published', $future, $revsBefore]);

// ================================================================ revisions (§6.4)

$p = req('POST', '/posts', ['title' => 'Rev 1', 'excerpt' => 'first'], 'alice')[1];
req('PATCH', "/posts/{$p['id']}", ['title' => 'Rev 2'], 'alice');
[$s, $list] = req('GET', "/posts/{$p['id']}/revisions", as: 'alice');
eq('one revision per create/update, newest first, with the user', [$s, count($list), $list[0]['user'] ?? null, $list[0]['id'] > $list[1]['id']], [200, 2, ['id' => $users['alice']['id'], 'name' => 'alice'], true]);
eq('revision row is the state written then', req('GET', "/posts/{$p['id']}/revisions/{$list[1]['id']}", as: 'alice')[1]['title'] ?? null, 'Rev 1');
isProblem('revisions need update access on the row (other author: masked)', req('GET', "/posts/{$p['id']}/revisions", as: 'bob'), 404, 'not_found');
isProblem('unknown revision', req('GET', "/posts/{$p['id']}/revisions/999999", as: 'alice'), 404, 'not_found');
[$s, $restored] = req('POST', "/posts/{$p['id']}/revisions/{$list[1]['id']}/restore", as: 'alice');
eq('restore runs the update pipeline', [$s, $restored['title'] ?? null, count(req('GET', "/posts/{$p['id']}/revisions", as: 'alice')[1])], [200, 'Rev 1', 3]);
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

// ================================================================ media (§4.6)

$png = tempnam(sys_get_temp_dir(), 'zimg');
$im = imagecreatetruecolor(3, 2);
imagepng($im, $png);
$txt = tempnam(sys_get_temp_dir(), 'ztxt');
file_put_contents($txt, 'plain text');
$upload = static fn (string $path, string $name, ?string $as, array $form = []) => req('POST', '/media', as: $as, files: ['file' => ['name' => $name, 'tmp_name' => $path, 'error' => UPLOAD_ERR_OK, 'size' => filesize($path)]], form: $form);

isProblem('upload needs author: anonymous', $upload($png, 'a.png', null), 401, 'unauthenticated');
[$s, $img] = $upload($png, 'cover.png', 'alice', ['alt' => 'A cover']);
check('upload → 201 media row, file under public/uploads', $s === 201 && $img['mime'] === 'image/png' && [$img['width'], $img['height']] === [3, 2]
    && $img['alt'] === 'A cover' && $img['filename'] === 'cover.png' && preg_match('#^/uploads/\d{4}/\d{2}/[0-9a-f-]{36}\.png$#', $img['url']) === 1
    && is_file("$root/public" . $img['url']), $img);
$doc = $upload($txt, 'notes.txt', 'alice')[1];
isProblem('missing file part', req('POST', '/media', as: 'alice'), 422, 'invalid_input', '/file');
isProblem('accept: image rejects other mimes', req('PATCH', "/posts/{$mine['id']}", ['cover' => $doc['id']], 'alice'), 422, 'invalid_input', '/cover');
isProblem('unknown media id', req('PATCH', "/posts/{$mine['id']}", ['cover' => 999999], 'alice'), 422, 'invalid_input', '/cover');
req('PATCH', "/posts/{$mine['id']}", ['cover' => $img['id']], 'alice');
eq('without with: the id', req('GET', "/posts/{$mine['id']}", as: 'alice')[1]['cover'], $img['id']);
eq('with: { cover: true } populates in place', req('GET', "/posts/{$mine['id']}", as: 'alice', query: ['with' => '{"cover":true}'])[1]['cover'], $img);
eq('GET /media/{id} and list', [req('GET', "/media/{$img['id']}")[1], array_column(req('GET', '/media', query: ['where' => '{"mime":"image/png"}'])[1], 'id')], [$img, [$img['id']]]);
isProblem('media delete needs editor', req('DELETE', "/media/{$img['id']}", as: 'alice'), 403, 'forbidden');
$revs = count($db->revisions('posts', $mine['id']));
eq('editor deletes', req('DELETE', "/media/{$img['id']}", as: 'ed')[1]['id'] ?? null, $img['id']);
$after = $db->findFirst('posts', ['where' => ['id' => $mine['id']]]);
eq('referencing media columns nulled through the pipeline (revision written)', [$after['cover'], count($db->revisions('posts', $mine['id']))], [null, $revs + 1]);
check('file removed after commit', !is_file("$root/public" . $img['url']));
isProblem('deleted media is gone', req('GET', "/media/{$img['id']}"), 404, 'not_found');

// ================================================================ FK actions in the pipeline (§4.2)

$db->delete('authors', ['id' => $aliceProfile['id']]);
eq('onDelete set null', array_unique(array_column($db->findMany('posts', ['where' => ['id' => ['in' => [$pub['id'], $mine['id']]]]]), 'authorId')), [null]);
$db->delete('posts', ['id' => $pub['id']]);
eq('onDelete cascade', $db->findMany('comments', ['where' => ['postId' => $pub['id']]]), []);

finish('blog_test');
