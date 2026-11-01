<?php

declare(strict_types=1);

/*
 * Private file buckets on WordPress (phase 2 §7.2), in-process through App::handle (tests/php/wp.php):
 * accept/maxBytes, the owner rule, signed download URLs, `file` columns, rollback. The site's php -S
 * answers the private-files probe (the router denies /wp-content/uploads/zero-private/, as the
 * .htaccess does under Apache), so uploads are open.
 */

use Zero\App;
use Zero\Wp\WpFiles;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = [
    'name' => 'talks',
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
            'backup' => ['type' => 'file', 'bucket' => 'decks'],
            'extra' => ['type' => 'group', 'fields' => ['handout' => ['type' => 'file', 'bucket' => 'decks']]],
        ],
        'relations' => [],
        'hooks' => ['beforeCreate' => 'talks__beforeCreate', 'beforeUpdate' => 'talks__beforeUpdate'],
        'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'author'], 'update' => ['role' => 'author'], 'delete' => ['role' => 'author']],
        'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
        'revisions' => false,
    ]],
];
// A before-hook that swaps in a file id: the column check must see the final value.
$functions = <<<'PHP'
    <?php
    namespace ZeroApp;
    function talks__beforeCreate(array $data): array
    {
        return ($data['title'] ?? '') === 'hooked' ? ['deck' => 999999] + $data : $data;
    }
    /** A hook that pins the deck: deleting the file must not leave it dangling. */
    function talks__beforeUpdate(array $patch, array $existing): array
    {
        // 'pinned' keeps deck on every update; 'restore' puts deck back while backup is being nulled.
        return match (true) {
            $existing['title'] === 'pinned' => ['deck' => $existing['deck']] + $patch,
            $existing['title'] === 'restore' && array_key_exists('backup', $patch) => ['deck' => $existing['backup']] + $patch,
            default => $patch,
        };
    }
    PHP;

$wp = wpSite('files', ['schema' => $schema, 'functions' => $functions, 'users' => ['alice' => 'author', 'bob' => 'author', 'ed' => 'editor', 'sub' => 'subscriber'], 'server' => true]);
$app = $wp->app();
eq('the activation probe passed: uploads are open', (new WpFiles($wp->connection(), 'talks'))->unavailable(), null);
$private = WpFiles::root() . '/talks/decks';

/** @return array{int, mixed, array<string, string>, string|\Closure} */
function call(string $method, string $path, ?string $as = null, mixed $body = null, array $query = [], array $files = []): array
{
    global $wp;
    [$status, $data, $headers, $payload] = $wp->call($method, $path, $body, $as, $query, $files);

    return [$status, $data, $headers, $payload];
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
/** Follow a signed url in-process (its path below the REST namespace); returns [status, headers as sent, body]. */
$download = static function (string $url) use ($wp): array {
    $parts = parse_url($url);
    parse_str($parts['query'] ?? '', $query);
    [$status, $headers, $payload] = $wp->handle('GET', (string) preg_replace('#^.*?/zero/v1#', '', $parts['path']), '', null, [], $query);
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
    [201, 'decks', 'é.txt', 'text/plain', 10, $wp->userId('alice'), false]);
check('bytes live under uploads/zero-private/<app>/<bucket>, behind the deny rules, never in the media library',
    count(glob("$private/*")) === 1 && is_file(WpFiles::root() . '/.htaccess') && array_diff(scandir($wp->uploads()), ['.', '..', 'zero-private']) === [], glob("$private/*"));
$deckFile = glob("$private/*")[0];

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

isProblem('a before-hook cannot slip in an unchecked file id', call('POST', '/talks', 'alice', ['title' => 'hooked']), 422, 'invalid_input', '/deck');
eq('… and the rejected create left no row', in_array('hooked', array_column(call('GET', '/talks')[1], 'title'), true), false);

// Rollback: an upload inside a failing transaction leaves no row and no bytes; a failed delete keeps both.
$before = glob("$private/*");
$tmp = tempnam(sys_get_temp_dir(), 'zf');
file_put_contents($tmp, 'rolled back');
try {
    \Zero\db()->transaction(static function () use ($tmp): void {
        \Zero\Media\Files::upload('decks', $tmp, 'r.txt', null);
        throw new \RuntimeException('roll back');
    });
} catch (\RuntimeException) {
}
eq('a rolled-back upload leaves no bytes behind', glob("$private/*"), $before);
try {
    \Zero\db()->transaction(static function () use ($deck): void {
        \Zero\Media\Files::delete('decks', $deck['id'], null);
        throw new \RuntimeException('roll back');
    });
} catch (\RuntimeException) {
}
eq('a rolled-back delete keeps the row, the reference and the bytes', [call('GET', "/files/decks/{$deck['id']}", 'alice')[0], call('GET', "/talks/{$talk['id']}")[1]['deck'], glob("$private/*")],
    [200, $deck['id'], $before]);

// Nested file fields: checked on write; a delete is refused while one still holds the id.
isProblem('a nested file field is checked too', call('POST', '/talks', 'alice', ['title' => 'n', 'extra' => ['handout' => 999999]]), 422, 'invalid_input', '/extra/handout');
[, $handout] = $upload('decks', 'handout', 'h.txt', 'alice');
$nested = call('POST', '/talks', 'alice', ['title' => 'n', 'extra' => ['handout' => $handout['id']]])[1];
isProblem('deleting a file a nested field holds is refused', call('DELETE', "/files/decks/{$handout['id']}", 'alice'), 409, 'reference_violation');
call('PATCH', "/talks/{$nested['id']}", 'alice', ['extra' => ['handout' => null]]);
eq('cleared, it deletes', call('DELETE', "/files/decks/{$handout['id']}", 'alice')[0], 200);

// A before-update hook that pins the reference cannot leave a dangling id: the delete rolls back.
[, $pinnedDeck] = $upload('decks', 'pinned', 'p.txt', 'alice');
$pinned = call('POST', '/talks', 'alice', ['title' => 'pinned', 'deck' => $pinnedDeck['id']])[1];
isProblem('a hook that keeps the reference blocks the delete', call('DELETE', "/files/decks/{$pinnedDeck['id']}", 'alice'), 409, 'reference_violation', '/deck');
eq('… and the file and reference are intact', [call('GET', "/files/decks/{$pinnedDeck['id']}", 'alice')[0], call('GET', "/talks/{$pinned['id']}")[1]['deck']], [200, $pinnedDeck['id']]);
call('DELETE', "/talks/{$pinned['id']}", 'alice');

// Two columns hold the file; nulling the second puts it back in the first: still refused.
[, $twice] = $upload('decks', 'twice', 'tw.txt', 'alice');
$restore = call('POST', '/talks', 'alice', ['title' => 'restore', 'deck' => $twice['id'], 'backup' => $twice['id']])[1];
isProblem('a hook on a later column cannot restore an already nulled one', call('DELETE', "/files/decks/{$twice['id']}", 'alice'), 409, 'reference_violation', '/deck');
eq('… and nothing changed', [call('GET', "/files/decks/{$twice['id']}", 'alice')[0], call('GET', "/talks/{$restore['id']}")[1]['deck']], [200, $twice['id']]);
call('DELETE', "/talks/{$restore['id']}", 'alice');

[$s, $gone] = call('DELETE', "/files/decks/{$deck['id']}", 'alice');
eq('owner deletes; referencing columns are nulled', [$s, $gone['id'], call('GET', "/talks/{$talk['id']}")[1]['deck']], [200, $deck['id'], null]);
check('bytes removed after commit', !is_file($deckFile));
[, $fresh] = $upload('decks', 'temp', 't.txt', 'alice');
call('DELETE', "/files/decks/{$fresh['id']}", 'alice');
[$s] = $download($fresh['url']);
eq('a still-valid signed url for a deleted file → 404', $s, 404);

eq('GET /_schema lists buckets without rules', call('GET', '/_schema')[1]['files'], ['decks' => ['accept' => ['application/pdf', 'text/*'], 'maxBytes' => 64], 'shared' => ['accept' => ['text/plain'], 'maxBytes' => 64]]);

finish('files_test');
