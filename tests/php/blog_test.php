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
req('PATCH', "/posts/{$p['id']}", ['title' => 'Rev 2', 'excerpt' => 'second'], 'alice');
\Zero\Extensions::onRead(static function (array $rows, string $c, ?\Zero\Viewer $viewer): array {
    if ($c === 'posts' && $viewer !== null) {
        foreach ($rows as &$row) {
            if (in_array($row['title'], ['Rev 1', 'Rev 2'], true)) {
                unset($row['excerpt']);
            }
        }
        unset($row);
    }

    return $rows;
});
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

\Zero\Features::register(); // Re-registering bootstrap modules must not duplicate the media route.

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

// ================================================================ extension seams

\Zero\SystemTables::register('seam', [
    'CREATE TABLE IF NOT EXISTS "__zero_seam" ("id" integer PRIMARY KEY, "event" text NOT NULL)',
    static function (\Zero\Store $store): void {
        if (!$store instanceof \Zero\Store\SqliteStore) {
            throw new \LogicException('SQLite upgrade needs the SQLite store');
        }
        if (!in_array('extra', array_column($store->run('PRAGMA table_info("__zero_seam")')->fetchAll(), 'name'), true)) {
            $store->applySystemStatements(['ALTER TABLE "__zero_seam" ADD COLUMN "extra" text']);
        }
    },
], ['CREATE TABLE IF NOT EXISTS `{prefix}zero__seam` (`id` bigint PRIMARY KEY, `event` text NOT NULL) ENGINE=InnoDB']);
$systemStore = new \Zero\Store\SqliteStore(\Zero\Store\SqliteStore::connect(':memory:'), $app->schema);
$systemStore->run('INSERT INTO "__zero_seam" ("id", "event") VALUES (1, ?)', ['automatic']);
eq('registered tables are installed during standalone store construction', $systemStore->run('SELECT event FROM "__zero_seam"')->fetchColumn(), 'automatic');
\Zero\SystemTables::apply($db->store());
$db->store()->run('INSERT INTO "__zero_seam" ("id", "event", "extra") VALUES (1, ?, ?)', ['kept', 'upgraded']);
\Zero\SystemTables::apply($db->store());
eq('idempotent system DDL and guarded ALTER preserve data', $db->store()->run('SELECT event, extra FROM "__zero_seam"')->fetch(), ['event' => 'kept', 'extra' => 'upgraded']);
problem('system DDL rejects request transactions', fn () => $db->transaction(fn () => \Zero\SystemTables::apply($db->store())), 500, 'internal');

\Zero\Extensions::normalizeWrite(static function (string $op, string $c, array &$data): void {
    if ($c === 'posts') {
        unset($data['translationOf']);
        if (array_key_exists('password', $data)) {
            $data['excerpt'] = $data['password'];
            unset($data['password']);
        }
    }
});
\Zero\Extensions::onWrite(static function (string $op, string $c, array &$data, ?array $existing, ?\Zero\Viewer $viewer, array $provided): void {
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
        throw new \Zero\JsError('extension refused delete');
    }
});
\Zero\Extensions::onWritten(static function (string $op, string $c, array $row, ?array $previous) use ($db): void {
    if ($c !== 'posts' || !str_starts_with($row['excerpt'] ?? '', 'extension')) {
        return;
    }
    $db->insert('comments', ['postId' => $row['id'], 'name' => $op, 'body' => $previous['excerpt'] ?? 'created']);
    if ($row['excerpt'] === 'extension fail') {
        throw new \Zero\JsError('extension rolled back');
    }
    \Zero\Extensions::afterCommit(static function () use ($db, $op, $row): void {
        $db->store()->run('INSERT INTO "__zero_seam" ("event") VALUES (?)', [$op . ':' . $row['excerpt']]);
    });
});
$seamAuthor = $db->insert('authors', ['name' => 'Alice again', 'email' => 'again@example.com', 'userId' => $users['alice']['id']], true)[0];
[$status, $seam] = req('POST', '/posts', ['title' => 'Extension', 'translationOf' => 123], 'alice');
eq('write extension sees defaults and viewer before the application hook', [$status, $seam['title'], $seam['excerpt'], $seam['authorId']], [201, 'published alice', 'extension', $seamAuthor['id']]);
$seam = req('PATCH', '/posts/' . $seam['id'], ['password' => 'revise'], 'ed')[1];
eq('update extension receives the previous row', $seam['excerpt'], 'extension revised');
isProblem('normalization still rejects unconsumed create inputs', req('POST', '/posts', ['title' => 'Rejected', 'unknown' => true], 'ed'), 422, 'invalid_input', '/unknown');
isProblem('normalization still rejects unconsumed update inputs', req('PATCH', '/posts/' . $seam['id'], ['unknown' => true], 'ed'), 422, 'invalid_input', '/unknown');
eq('written extension can nest writes and schedule durable effects', [
    array_column($db->findMany('comments', ['where' => ['postId' => $seam['id']], 'orderBy' => ['id' => 'asc']]), 'body'),
    $db->store()->run('SELECT event FROM "__zero_seam" ORDER BY id')->fetchAll(\PDO::FETCH_COLUMN),
], [['created', 'extension'], ['kept', 'create:extension', 'update:extension revised']]);
isProblem('written extension failure rolls back row and nested effects', req('PATCH', '/posts/' . $seam['id'], ['excerpt' => 'extension fail'], 'ed'), 422, 'rejected');
eq('failed write preserves row and nested data', [
    $db->findFirst('posts', ['where' => ['id' => $seam['id']]])['excerpt'],
    count($db->findMany('comments', ['where' => ['postId' => $seam['id']]])),
    $db->store()->run('SELECT COUNT(*) FROM "__zero_seam"')->fetchColumn(),
], ['extension revised', 2, 3]);
isProblem('delete extension runs before deletion', req('DELETE', '/posts/' . $seam['id'], as: 'ed'), 422, 'rejected');

// The lookup seam primes a page cache which a read transform consumes, including nested relations.
$cache = [];
\Zero\Extensions::onLookup(static function (string $c, array $pks) use (&$cache): void {
    $cache[$c] = array_fill_keys($pks, 'looked up');
});
\Zero\Extensions::onRead(static function (array $rows, string $c, ?\Zero\Viewer $viewer) use (&$cache): array {
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
\Zero\Extensions::beforeRead(static function (string $c, array &$opts, ?\Zero\Viewer $viewer): void {
    if ($c !== 'posts') {
        return;
    }
    if ($viewer !== null && isset($opts['orderBy']['excerpt'])) {
        throw new \Zero\HttpError(403, 'forbidden', 'Cannot order by transformed data', '/orderBy/excerpt');
    }
    if (isset($opts['seamId'])) {
        $opts['where'] = ['id' => $opts['seamId']];
        unset($opts['seamId']);
    }
    if (array_key_exists('locale', $opts)) {
        if ($opts['locale'] !== 'de') {
            throw \Zero\HttpError::invalidQuery('Unsupported test locale', '/locale');
        }
        $opts['where'] = ['AND' => [$opts['where'] ?? [], ['title' => 'published alice']]];
        unset($opts['locale']);
    }
});
eq('query extensions normalize options before validation and SQL', array_column($db->findMany('posts', ['seamId' => $seam['id']]), 'id'), [$seam['id']]);
problem('query extensions reject forbidden selectors before the query', fn () => $db->findMany('posts', ['orderBy' => ['excerpt' => 'asc']], new \Zero\Viewer($users['ed'], 'standalone')), 403, 'forbidden', '/orderBy/excerpt');
eq('REST list and item queries deliver feature options before SQL', [
    array_column(req('GET', '/posts', as: 'ed', query: ['locale' => 'de'])[1], 'id'),
    req('GET', '/posts/' . $seam['id'], as: 'ed', query: ['locale' => 'de'])[1]['id'],
], [[$seam['id']], $seam['id']]);
isProblem('feature query validation reaches item REST', req('GET', '/posts/' . $seam['id'], query: ['locale' => 'invalid']), 400, 'invalid_query', '/locale');
isProblem('unconsumed feature options remain invalid on other collections', req('GET', '/authors', query: ['locale' => 'de']), 400, 'invalid_query', '/locale');

$db->setActor($users['sub']);
$invoked = $app->invoke('POST', '/comments', [], ['postId' => $seam['id'], 'name' => 'dispatch', 'body' => 'approved as editor'], new \Zero\Viewer($users['ed'], 'standalone'));
eq('operation invocation uses explicit authority and restores its caller actor', [$db->findFirst('comments', ['where' => ['id' => $invoked['id']]])['approved'], $db->actor()], [true, $users['sub']]);
problem('operation invocation throws access errors without serializing them', fn () => $app->invoke('POST', '/actions/approveComment', [], ['id' => $invoked['id']], new \Zero\Viewer($users['sub'], 'standalone')), 403, 'forbidden');
eq('throwing operation invocation also restores the caller actor', $db->actor(), $users['sub']);
$db->setActor(null);

\Zero\Extensions::schemaDescribe(static fn (array $d): array => $d + ['seam' => ['version' => 1]]);
eq('public schema description extensions reach HTTP', req('GET', '/_schema')[1]['seam'], ['version' => 1]);

\Zero\Extensions::aroundOperation(static function (string $scope, array $spec, string $raw, array $headers, ?\Zero\Viewer $viewer, callable $next) use ($db): \Zero\Response {
    if (!isset($headers['idempotency-key'])) {
        return $next();
    }
    $key = 'receipt:' . $scope . ':' . ($viewer?->user['id'] ?? 'anonymous') . ':' . $headers['idempotency-key'];
    $stored = $db->store()->run('SELECT extra FROM "__zero_seam" WHERE event = ?', [$key])->fetchColumn();
    if ($stored !== false) {
        $receipt = json_decode($stored, true);

        return \Zero\Response::json($receipt['data'], $receipt['status'], ['Idempotent-Replayed' => 'true']);
    }
    $result = $next();
    $db->store()->run('INSERT INTO "__zero_seam" (event, extra) VALUES (?, ?)', [$key, json_encode(['status' => $result->status, 'data' => $result->data])]);
    if ($headers['idempotency-key'] === 'fail') {
        throw new \Zero\JsError('Receipt persistence failed');
    }

    return $result;
});
$receiptHeaders = ['Authorization' => 'Bearer ' . $tokens['ed'], 'Idempotency-Key' => 'create'];
$firstReceipt = $app->handle('POST', '/posts', [], '{"title":"Replay seam"}', $receiptHeaders);
$replayReceipt = $app->handle('POST', '/posts', [], '{"title":"Replay seam"}', $receiptHeaders);
eq('operation wrapper can replay a create without repeating its pipeline', [
    $firstReceipt[0], $replayReceipt[0], $replayReceipt[1]['Idempotent-Replayed'], $firstReceipt[2] === $replayReceipt[2],
    count($db->findMany('posts', ['where' => ['title' => 'Replay seam']])),
], [201, 201, 'true', true, 1]);
eq('create authorization still runs before replay middleware', $app->handle('POST', '/posts', [], '{"title":"Replay seam"}', ['Idempotency-Key' => 'create'])[0], 401);
$failedReceipt = $app->handle('POST', '/posts', [], '{"title":"Rolled back receipt"}', ['Authorization' => 'Bearer ' . $tokens['ed'], 'Idempotency-Key' => 'fail']);
eq('failed operation wrapper rolls back both its result and receipt', [
    $failedReceipt[0], $db->findMany('posts', ['where' => ['title' => 'Rolled back receipt']]),
    $db->store()->run('SELECT COUNT(*) FROM "__zero_seam" WHERE event LIKE ?', ['receipt:%:fail'])->fetchColumn(),
], [422, [], 0]);

\Zero\Extensions::route('download-proof', static function () use ($db): \Zero\Response {
    $db->store()->run('INSERT INTO "__zero_seam" (event) VALUES (?)', ['download prepared']);
    \Zero\Extensions::afterCommit(static fn () => $db->store()->run('INSERT INTO "__zero_seam" (event) VALUES (?)', ['download committed']));

    return \Zero\Response::raw(static function () use ($db): void {
        echo "file\0bytes:" . $db->store()->run('SELECT event FROM "__zero_seam" ORDER BY id DESC LIMIT 1')->fetchColumn();
    }, 200, ['Content-Type' => 'application/octet-stream', 'Content-Disposition' => 'attachment; filename="proof.bin"', 'Cache-Control' => 'private, no-store']);
});
[$downloadStatus, $downloadHeaders, $downloadBody] = $app->handle('GET', '/download-proof', [], '');
ob_start();
\Zero\Response::emit($downloadBody);
$emitted = ob_get_clean();
eq('download response streams raw bytes and headers after commit', [
    $downloadStatus, $downloadHeaders['Content-Type'], $downloadHeaders['Content-Disposition'], $downloadHeaders['Cache-Control'], $emitted,
], [200, 'application/octet-stream', 'attachment; filename="proof.bin"', 'private, no-store', "file\0bytes:download committed"]);

\Zero\Extensions::route('posts', static function (string $method, array $segments, array $query, string $body, \Zero\Viewer $viewer, array $files, array $form): array {
    App::allow($method, ['POST']);

    return [202, [$segments, $query, $body, $viewer->user['name'] ?? null, $files, $form]];
});
eq('route extension owns a prefix before collections and receives all request parts',
    req('POST', '/posts/a%20b/c/d/e/f', ['raw' => true], 'ed', ['q' => 'value'], ['file' => ['name' => 'x']], ['alt' => 'y']),
    [202, [['posts', 'a b', 'c', 'd', 'e', 'f'], ['q' => 'value'], '{"raw":true}', 'ed', ['file' => ['name' => 'x']], ['alt' => 'y']]]);
isProblem('extension errors use the normal problem envelope', req('GET', '/posts'), 405, 'method_not_allowed');
isProblem('prefix dispatch matches complete segments', req('GET', '/postsExtra'), 404, 'not_found');

\Zero\Extensions::beforeAction(static function (array $spec, string $name, string $raw, array $headers, ?\Zero\Viewer $viewer): void {
    if ($name === 'approveComment' && ($headers['x-proof'] ?? '') !== hash('sha256', $raw)) {
        throw new \Zero\HttpError(403, 'forbidden', 'Bad raw-body proof');
    }
    if ($name === 'publishedCount' && $viewer === null && trim($raw) === '{"reject":true}') {
        throw new \Zero\JsError('CLI action extension');
    }
});
$seamComment = $db->findFirst('comments', ['where' => ['postId' => $seam['id']]]);
$raw = '{ "id": ' . $seamComment['id'] . ' }';
[$s, , $out] = $app->handle('POST', '/actions/approveComment', [], $raw, ['Authorization' => 'Bearer ' . $tokens['ed'], 'X-Proof' => hash('sha256', $raw)]);
eq('action invocation extension gets exact raw body and normalized headers', [$s, json_decode($out, true)['data']['id']], [200, $seamComment['id']]);
[$s, , $out] = $app->handle('POST', '/actions/approveComment', [], $raw, ['authorization' => 'Bearer ' . $tokens['ed']]);
eq('action extension may reject before handler execution', [$s, json_decode($out, true)['code']], [403, 'forbidden']);
$actionHeaders = ['authorization' => 'Bearer ' . $tokens['ed'], 'x-proof' => hash('sha256', $raw), 'idempotency-key' => 'action'];
$app->handle('POST', '/actions/approveComment', [], $raw, $actionHeaders);
[$s, $replayedHeaders, $out] = $app->handle('POST', '/actions/approveComment', [], $raw, $actionHeaders);
eq('action middleware receives result and can replay it with response metadata', [$s, $replayedHeaders['Idempotent-Replayed'], json_decode($out, true)['data']['id']], [200, 'true', $seamComment['id']]);
$actionHeaders['x-proof'] = 'invalid';
eq('action signature guard still runs before replay middleware', $app->handle('POST', '/actions/approveComment', [], $raw, $actionHeaders)[0], 403);
[$code, $out] = $app->cli(['action', 'publishedCount', '{"reject":true}']);
eq('trusted CLI actions share the invocation extension', [$code, json_decode($out, true)['error']['code']], [1, 'rejected']);
\Zero\Extensions::cli('seam', static function (array $args, array $flags) use ($db): array {
    $db->store()->run('INSERT INTO "__zero_seam" ("event") VALUES (?)', [$args[0]]);
    if (isset($flags['fail'])) {
        throw new \Zero\JsError('CLI extension rollback');
    }

    return ['args' => $args, 'flags' => $flags];
});
[$code, $out] = $app->cli(['seam', 'saved', '--mode=local']);
eq('CLI extension runs through the canonical envelope', [$code, json_decode($out, true)['data']], [0, ['args' => ['saved'], 'flags' => ['mode' => 'local']]]);
$app->cli(['seam', 'discarded', '--fail']);
eq('CLI extension effects join the command transaction', $db->store()->run('SELECT event FROM "__zero_seam" ORDER BY id DESC LIMIT 1')->fetchColumn(), 'saved');

\Zero\Extensions::route('auth', static function (string $method, array $segments, array $query, string $body): array {
    App::allow($method, ['POST']);

    return [200, ['grant' => json_decode($body, true)['grant_type'], 'path' => $segments]];
});
eq('auth module can replace token dispatch while unregistered routes retain built-in behavior', req('POST', '/auth/token', ['grant_type' => 'refresh_token']), [200, ['grant' => 'refresh_token', 'path' => ['auth', 'token']]]);

finish('blog_test');
