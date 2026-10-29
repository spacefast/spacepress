<?php

declare(strict_types=1);

/*
 * Private file buckets on the standalone target (phase 2 §7.2), in-process through App::handle on a
 * real SQLite file: accept/maxBytes, the owner rule, signed download URLs, `file` columns.
 */

use Zero\App;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = sys_get_temp_dir() . '/zero-files-test-' . bin2hex(random_bytes(4));
copyRuntime($root);
@mkdir("$root/zero/app/migrations", 0777, true);
@mkdir("$root/public", 0777, true);
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));
ini_set('error_log', "$root/error.log");
putenv('ZERO_DB_PATH');
putenv('ZERO_SECRET=files-test-secret');
putenv('ZERO_NOW');
file_put_contents("$root/zero/app/schema.php", '<?php return ' . var_export([
    'version' => 3, 'runtime' => '0.2',
    'files' => [
        'decks' => ['accept' => ['application/pdf', 'text/*'], 'maxBytes' => 64,
            'access' => ['read' => ['owner' => true], 'create' => ['role' => 'author'], 'delete' => ['owner' => true]]],
        'shared' => ['accept' => ['text/plain'], 'maxBytes' => 64,
            'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'authenticated'], 'delete' => ['role' => 'editor']]],
    ],
    'collections' => ['talks' => [
        'primaryKey' => 'id',
        'columns' => [
            'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
            'title' => ['type' => 'text', 'notNull' => true],
            'deck' => ['type' => 'file', 'bucket' => 'decks'],
        ],
        'relations' => [],
        'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'author'], 'update' => ['role' => 'author'], 'delete' => ['role' => 'author']],
        'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
        'revisions' => false,
    ]],
], true) . ';');
file_put_contents("$root/zero/app/migrations/0001_init.sql", 'CREATE TABLE "talks" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" text NOT NULL, "deck" integer);');

require "$root/zero/runtime/bootstrap.php";
$app = App::boot($root);
$tokens = [];
foreach (['alice' => 'author', 'bob' => 'author', 'ed' => 'editor', 'sub' => 'subscriber'] as $name => $role) {
    $app->identity()->addUser($name, $role, null);
    $tokens[$name] = $app->identity()->createToken($name, null)['token'];
}

/** @return array{int, mixed, array<string, string>, string|\Closure} */
function call(string $method, string $path, ?string $as = null, mixed $body = null, array $query = [], array $files = []): array
{
    global $app, $tokens;
    $headers = $as === null ? [] : ['authorization' => 'Bearer ' . $tokens[$as]];
    [$status, $out, $payload] = $app->handle($method, $path, $query, $body === null ? '' : json_encode($body), $headers, $files);
    $json = is_string($payload) ? json_decode($payload, true) : null;

    return [$status, $status < 300 ? ($json['data'] ?? null) : $json, $out, $payload];
}

function isProblem(string $label, array $r, int $status, string $code, ?string $pointer = null): void
{
    check("$label → $status $code", $r[0] === $status && ($r[1]['code'] ?? null) === $code && ($r[1]['pointer'] ?? null) === $pointer, $r[1]);
}

$upload = static function (string $bucket, string $bytes, string $name, ?string $as): array {
    $tmp = tempnam(sys_get_temp_dir(), 'zf');
    file_put_contents($tmp, $bytes);

    return call('POST', "/files/$bucket", $as, files: ['file' => ['name' => $name, 'tmp_name' => $tmp, 'error' => UPLOAD_ERR_OK]]);
};
/** Follow a signed url in-process; returns [status, headers, body]. */
$download = static function (string $url): array {
    $parts = parse_url($url);
    parse_str($parts['query'] ?? '', $query);
    [$status, , $headers, $payload] = call('GET', substr($parts['path'], strlen(App::PREFIX)), query: $query);
    ob_start();
    \Zero\Response::emit($payload);

    return [$status, $headers, (string) ob_get_clean()];
};

// ================================================================ upload rules

isProblem('anonymous upload: create rule', $upload('decks', 'hello', 'a.txt', null), 401, 'unauthenticated');
isProblem('subscriber below the create role', $upload('decks', 'hello', 'a.txt', 'sub'), 403, 'forbidden');
isProblem('mime sniffed and checked against accept', $upload('decks', "\x89PNG\r\n\x1a\n" . str_repeat("\0", 16), 'fake.pdf', 'alice'), 422, 'invalid_input', '/file');
isProblem('maxBytes', $upload('decks', str_repeat('x', 65), 'big.txt', 'alice'), 413, 'payload_too_large');
isProblem('unknown bucket', $upload('nope', 'x', 'a.txt', 'alice'), 404, 'not_found');
[$s, $deck] = $upload('decks', "Slide one\n", "Q3 \"plan\"/é.txt", 'alice');
eq('201 row: sniffed mime, owner = uploader, no storage path', [$s, $deck['bucket'], $deck['filename'], $deck['mime'], $deck['size'], $deck['ownerId'], array_key_exists('path', $deck)],
    [201, 'decks', 'é.txt', 'text/plain', 10, $app->identity()->listUsers()[0]['id'], false]);
check('bytes live under <root>/private, never under public/', count(glob("$root/private/decks/*")) === 1 && glob("$root/public/**/*") === []);

// ================================================================ signed downloads

[$s, $headers, $body] = $download($deck['url']);
eq('a signed url streams the bytes with the security headers', [$s, $body, $headers['Content-Type'], $headers['X-Content-Type-Options'], $headers['Content-Security-Policy'], $headers['Cache-Control'],
    $headers['Content-Disposition']], [200, "Slide one\n", 'text/plain', 'nosniff', 'sandbox', 'private, no-store', "attachment; filename=\"__.txt\"; filename*=UTF-8''%C3%A9.txt"]);
parse_str(parse_url($deck['url'], PHP_URL_QUERY), $q);
check('url expires 300 s from now', (int) $q['exp'] - time() <= 300 && (int) $q['exp'] - time() >= 295, $q);
$path = "/files/decks/{$deck['id']}/download";
isProblem('forged signature', call('GET', $path, query: ['exp' => $q['exp'], 'sig' => str_repeat('0', 64)]), 403, 'forbidden');
isProblem('signature of another file', call('GET', "/files/decks/999/download", query: $q), 403, 'forbidden');
isProblem('an extended exp invalidates the signature', call('GET', $path, query: ['exp' => (string) ((int) $q['exp'] + 1), 'sig' => $q['sig']]), 403, 'forbidden');
putenv('ZERO_NOW=' . (((int) $q['exp'] + 1) * 1000));
isProblem('expired url', call('GET', $path, query: $q), 403, 'forbidden');
putenv('ZERO_NOW=' . (((int) $q['exp'] - 600) * 1000));
isProblem('exp more than 300 s ahead is refused even when signed', call('GET', $path, query: $q), 403, 'forbidden');
putenv('ZERO_NOW');

// ================================================================ owner rule

isProblem('owner rule: another author cannot read', call('GET', "/files/decks/{$deck['id']}", 'bob'), 403, 'forbidden');
isProblem('owner rule: anonymous', call('GET', "/files/decks/{$deck['id']}"), 401, 'unauthenticated');
[$s, $again] = call('GET', "/files/decks/{$deck['id']}", 'alice');
check('the owner gets the row with a fresh signed url', $s === 200 && $download($again['url'])[2] === "Slide one\n", $again);
isProblem('wrong bucket in the path', call('GET', "/files/shared/{$deck['id']}", 'alice'), 404, 'not_found');
isProblem('owner rule on delete', call('DELETE', "/files/decks/{$deck['id']}", 'ed'), 403, 'forbidden');

// ================================================================ file({ bucket }) columns

$shared = $upload('shared', 'everyone', 'pub.txt', 'bob')[1];
isProblem('file column: unknown id', call('POST', '/talks', 'alice', ['title' => 'x', 'deck' => 999999]), 422, 'invalid_input', '/deck');
isProblem('file column: id from another bucket', call('POST', '/talks', 'alice', ['title' => 'x', 'deck' => $shared['id']]), 422, 'invalid_input', '/deck');
$talk = call('POST', '/talks', 'alice', ['title' => 'Q3', 'deck' => $deck['id']])[1];
eq('without with: the id', call('GET', "/talks/{$talk['id']}", 'bob')[1]['deck'], $deck['id']);
$own = call('GET', "/talks/{$talk['id']}", 'alice', query: ['with' => 'deck'])[1]['deck'];
check('with: { deck: true } populates for a reader the bucket admits, with a working url', is_array($own) && $own['id'] === $deck['id'] && $download($own['url'])[0] === 200, $own);
eq('with: { deck: true } keeps the id for a reader the owner rule refuses', [call('GET', "/talks/{$talk['id']}", 'bob', query: ['with' => 'deck'])[1]['deck'], call('GET', '/talks', query: ['with' => 'deck'])[1][0]['deck']], [$deck['id'], $deck['id']]);

[$s, $gone] = call('DELETE', "/files/decks/{$deck['id']}", 'alice');
eq('owner deletes; referencing columns are nulled', [$s, $gone['id'], call('GET', "/talks/{$talk['id']}")[1]['deck']], [200, $deck['id'], null]);
check('bytes removed after commit', glob("$root/private/decks/*") === []);
[, $fresh] = $upload('decks', 'temp', 't.txt', 'alice');
call('DELETE', "/files/decks/{$fresh['id']}", 'alice');
[$s] = $download($fresh['url']);
eq('a still-valid signed url for a deleted file → 404', $s, 404);

eq('GET /_schema lists buckets without rules', call('GET', '/_schema')[1]['files'], ['decks' => ['accept' => ['application/pdf', 'text/*'], 'maxBytes' => 64], 'shared' => ['accept' => ['text/plain'], 'maxBytes' => 64]]);

finish('files_test');
