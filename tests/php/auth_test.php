<?php

declare(strict_types=1);

/*
 * Standalone identity (§5.2, §6.2): users and tokens minted through the real CLI (zero/bin/zero.php), bearer
 * resolution, revocation, role changes, password and refresh grants with rotation, sign-out,
 * suspension, guests and their upgrade, hashing at rest.
 */

use Zero\App;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = blogApp(sys_get_temp_dir() . '/zero-auth-test-' . bin2hex(random_bytes(4)));
putenv('ZERO_DB_PATH');
putenv('ZERO_AUTO_MIGRATE');
ini_set('error_log', "$root/error.log");
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));

function cli2(string $root, string ...$args): array
{
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/zero/bin/zero.php") . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>/dev/null', $out, $code);

    return [$code, json_decode(implode("\n", $out), true)];
}

function cli(string ...$args): array
{
    global $root;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/zero/bin/zero.php") . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>/dev/null', $out, $code);

    return [$code, json_decode(implode("\n", $out), true)];
}

[$code, $out] = cli('user', 'add', 'maria', '--role', 'editor', '--password', 's3cret pass');
eq('user add', [$code, $out], [0, ['data' => ['id' => 1, 'name' => 'maria', 'role' => 'editor']]]);
eq('duplicate user name', [cli('user', 'add', 'maria', '--role', 'author')[1]['error']['code'] ?? null], ['unique_violation']);
eq('bad role', cli('user', 'add', 'x', '--role', 'owner')[1]['error']['pointer'] ?? null, '/role');
cli('user', 'add', 'sam', '--role', 'subscriber');
[$code, $out] = cli('token', 'create', 'maria', '--name', 'laptop');
$token = $out['data']['token'] ?? '';
check('token create: zt_ + 40 base62, shown once', $code === 0 && preg_match('/^zt_[0-9A-Za-z]{40}$/D', $token) === 1 && is_int($out['data']['id'] ?? null), $out);
$listed = cli('token', 'list', 'maria')[1]['data'] ?? [];
check('token list never shows the token or its hash', count($listed) === 1 && $listed[0]['name'] === 'laptop' && !str_contains(json_encode($listed), $token) && !array_key_exists('hash', $listed[0]), $listed);
eq('user list', array_column(cli('user', 'list')[1]['data'], 'role', 'name'), ['maria' => 'editor', 'sam' => 'subscriber']);

require "$root/zero/runtime/bootstrap.php";
$app = App::boot($root);
$pdo = $app->store->pdo();
eq('hashed at rest (sha256 hex)', $pdo->query('SELECT "hash" FROM "__zero_tokens"')->fetchColumn(), hash('sha256', $token));
check('password hashed at rest', password_verify('s3cret pass', (string) $pdo->query('SELECT "passwordHash" FROM "__zero_users" WHERE "name" = \'maria\'')->fetchColumn()));

/** [status, problem code] of GET /me with this Authorization header. */
$meStatus = static function (string $auth) use ($app): array {
    [$status, , $body] = $app->handle('GET', '/me', [], '', ['Authorization' => $auth]);

    return [$status, json_decode($body, true)['code'] ?? null];
};
$me = static function (?string $auth) use ($app): mixed {
    [, , $body] = $app->handle('GET', '/me', [], '', $auth === null ? [] : ['Authorization' => $auth]);

    return json_decode($body, true)['data'] ?? null;
};
eq('bearer resolves the user and role', $me("Bearer $token"), ['id' => 1, 'name' => 'maria', 'role' => 'editor']);
check('lastUsedAt recorded', $pdo->query('SELECT "lastUsedAt" FROM "__zero_tokens"')->fetchColumn() !== null);
eq('unknown CLI token is anonymous', $me('Bearer zt_' . str_repeat('A', 40)), null);
eq('an unknown sign-in token → 401, never anonymous', $meStatus('Bearer za_' . str_repeat('A', 43)), [401, 'unauthenticated']);
eq('malformed header is anonymous', $me("Basic $token"), null);

cli('user', 'role', 'maria', 'author');
eq('role change applies to existing tokens', $me("Bearer $token")['role'] ?? null, 'author');
eq('token revoke', cli('token', 'revoke', (string) $listed[0]['id'])[0], 0);
eq('revoked token is anonymous', $me("Bearer $token"), null);

$login = static function (array $body) use ($app): array {
    [$status, , $out] = $app->handle('POST', '/auth/token', [], json_encode($body));

    return [$status, json_decode($out, true)];
};
[$s, $out] = $login(['grant_type' => 'password', 'name' => 'maria', 'password' => 's3cret pass']);
check('password grant signs in: access + refresh tokens and the user', $s === 200 && $out['data']['user'] === ['id' => 1, 'name' => 'maria', 'role' => 'author']
    && preg_match('/^za_/', $out['data']['accessToken']) === 1 && preg_match('/^zr_/', $out['data']['refreshToken']) === 1 && $out['data']['expiresIn'] === 300
    && $me('Bearer ' . $out['data']['accessToken'])['name'] === 'maria', $out);
eq('wrong password → 401', [$login(['name' => 'maria', 'password' => 'nope'])[0], $login(['name' => 'maria', 'password' => 'nope'])[1]['code']], [401, 'unauthenticated']);
eq('user without a password can\'t log in', $login(['name' => 'sam', 'password' => ''])[0], 401);
eq('missing fields → 422', $login(['name' => 'maria'])[1]['pointer'] ?? null, '/password');

// Refresh rotation (§6.2): a refresh yields a new pair; reusing the old refresh token fails and
// revokes the whole family, the newest pair included.
$rotated = $login(['grant_type' => 'refresh_token', 'refreshToken' => $out['data']['refreshToken']]);
check('refresh rotates the pair and the new access token works', $rotated[0] === 200 && $rotated[1]['data']['refreshToken'] !== $out['data']['refreshToken']
    && $me('Bearer ' . $rotated[1]['data']['accessToken'])['name'] === 'maria', $rotated);
$reuse = $login(['grant_type' => 'refresh_token', 'refreshToken' => $out['data']['refreshToken']]);
eq('reusing a rotated refresh token → HTTP 400 invalid_grant (§3.5)', [$reuse[0], $reuse[1]['status'] ?? null, $reuse[1]['code'] ?? null], [400, 400, 'invalid_grant']);
eq('reuse revokes the family: the newest access token → 401 (so a client refreshes, then fails)', $meStatus('Bearer ' . $rotated[1]['data']['accessToken']), [401, 'unauthenticated']);
eq('reuse revokes the family: the newest refresh token fails', $login(['grant_type' => 'refresh_token', 'refreshToken' => $rotated[1]['data']['refreshToken']])[0], 400);

// Sign-out ends the session's family; other sessions keep working.
$a = $login(['name' => 'maria', 'password' => 's3cret pass'])[1]['data'];
$b = $login(['name' => 'maria', 'password' => 's3cret pass'])[1]['data'];
[$s] = $app->handle('DELETE', '/auth/session', [], '', ['Authorization' => 'Bearer ' . $a['accessToken']]);
check('sign-out answers 200 and ends that session only', $s === 200 && $meStatus('Bearer ' . $a['accessToken'])[0] === 401 && $me('Bearer ' . $b['accessToken'])['name'] === 'maria');

// Suspension (§6.2) blocks every credential with 403 suspended and ends sign-in sessions.
eq('users suspend', cli('user', 'suspend', 'maria')[0], 0);
eq('a suspended user\'s sign-in session → 403 suspended', $meStatus('Bearer ' . $b['accessToken']), [403, 'suspended']);
$t2 = cli('token', 'create', 'maria')[1]['data']['token'];
[$s, , $body] = $app->handle('GET', '/me', [], '', ['Authorization' => "Bearer $t2"]);
eq('a suspended user\'s CLI token → 403 suspended', [$s, json_decode($body, true)['code'] ?? null], [403, 'suspended']);
eq('a suspended user can\'t sign in', [$login(['name' => 'maria', 'password' => 's3cret pass'])[1]['code'] ?? null], ['suspended']);
eq('users reactivate', [cli('user', 'reactivate', 'maria')[0], $me("Bearer $t2")['name'] ?? null], [0, 'maria']);

// Guests: a guest signs in without credentials, holds the bottom role, and upgrades in place.
[$s, , $body] = $app->handle('POST', '/auth/guest', [], '{}');
$guest = json_decode($body, true)['data'];
check('POST /auth/guest → 201 with a guest user and tokens', $s === 201 && $guest['user']['role'] === 'guest' && $me('Bearer ' . $guest['accessToken'])['role'] === 'guest', $guest);
[$s, , $body] = $app->handle('POST', '/auth/guest/upgrade', [], json_encode(['name' => 'gina', 'password' => 'guest no more 1']), ['Authorization' => 'Bearer ' . $guest['accessToken']]);
$up = json_decode($body, true)['data']['user'] ?? null;
check('upgrade keeps the user id and makes a subscriber', $s === 200 && $up['id'] === $guest['user']['id'] && $up['role'] === 'subscriber' && $up['name'] === 'gina', $up);
eq('the upgraded account signs in with its password', $login(['name' => 'gina', 'password' => 'guest no more 1'])[1]['data']['user']['id'] ?? null, $guest['user']['id']);
[$s, , $body] = $app->handle('POST', '/auth/guest/upgrade', [], json_encode(['name' => 'again', 'password' => 'guest no more 1']), ['Authorization' => 'Bearer ' . $guest['accessToken']]);
eq('only a guest can be upgraded', [$s, json_decode($body, true)['code'] ?? null], [409, 'not_guest']);

eq('user remove drops their tokens', [cli('user', 'remove', 'maria')[0], (int) $pdo->query('SELECT COUNT(*) FROM "__zero_tokens"')->fetchColumn()], [0, 0]);
eq('publish-due via CLI (nothing due)', cli('publish-due'), [0, ['data' => ['promoted' => []]]]);

// ================================================================ auth: true collections (§6.2)

$club = authApp(sys_get_temp_dir() . '/zero-auth-club-' . bin2hex(random_bytes(4)));
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($club)));
$clubApp = App::boot($club);
$call = static function (string $method, string $path, mixed $body = null, ?string $token = null, array $query = []) use ($clubApp): array {
    [$status, , $out] = $clubApp->handle($method, $path, $query, $body === null ? '' : json_encode($body), $token === null ? [] : ['Authorization' => "Bearer $token"]);

    return [$status, json_decode($out, true)];
};
$hidden = ['passwordHash', 'suspendedAt', 'guest'];
$leaks = static function (mixed $data) use ($hidden): bool {
    $json = json_encode($data);
    foreach ($hidden as $col) {
        if (str_contains($json, "\"$col\":")) {
            return true;
        }
    }

    return str_contains($json, '$2y$');
};

[$s, $ana] = $call('POST', '/members', ['email' => 'ana@example.test', 'name' => 'Ana', 'password' => 'correct horse battery']);
check('create a member with a write-only password: 201, row has no password or hidden column', $s === 201 && $ana['data']['role'] === 'subscriber' && !$leaks($ana) && !array_key_exists('password', $ana['data']), $ana);
problem('a short password is refused', fn () => $clubApp->db->insert('members', ['email' => 'x@example.test', 'name' => 'X', 'password' => 'short'], true, new \Zero\Viewer(null, 'standalone')), 422, 'invalid_input', '/password');
[$s, $signed] = $call('POST', '/auth/token', ['name' => 'ana@example.test', 'password' => 'correct horse battery']);
$token = $signed['data']['accessToken'] ?? '';
check('the member signs in with email + password; ctx.user.id is the member row id', $s === 200 && $signed['data']['user']['id'] === $ana['data']['id'] && $signed['data']['user']['member']['email'] === 'ana@example.test' && !$leaks($signed), $signed);
eq('/me carries the member row', $call('GET', '/me', null, $token)[1]['data']['member']['plan'] ?? null, 'free');
$call('POST', '/members', ['email' => 'bo@example.test', 'name' => 'Bo', 'password' => 'another long one']);
[$s, $list] = $call('GET', '/members', null, $token);
check('"self" read: a member lists only their own row', $s === 200 && array_column($list['data'], 'email') === ['ana@example.test'] && !$leaks($list), $list);
eq('"self" read: anonymous → 401', $call('GET', '/members')[0], 401);
eq('"self" update: another member\'s row is not found', $call('PATCH', '/members/2', ['name' => 'Hacked'], $token)[0], 404);
[$s, $note] = $call('POST', '/notes', ['body' => 'hi', 'memberId' => $ana['data']['id']], $token);
[$s, $with] = $call('GET', '/notes', null, $token, ['with' => 'member']);
check('with: a related member never exposes hidden columns', $s === 200 && ($with['data'][0]['member']['email'] ?? null) === 'ana@example.test' && !$leaks($with), $with);
[$s, $revs] = $call('PATCH', '/notes/' . $note['data']['id'], ['body' => 'edited'], $token);
check('write results never expose hidden columns', $s === 200 && !$leaks($revs), $revs);
$probe = static fn (array $query, ?string $tok = null): array => $call('GET', str_contains(json_encode($query), 'member') && !isset($query['orderBy']) ? '/notes' : '/members', null, $tok, $query);
eq('filtering on a hidden column is refused (403, §4.3)', array_intersect_key($probe(['where' => json_encode(['passwordHash' => ['like' => '$2y%']])], $token)[1], ['status' => 1, 'code' => 1, 'pointer' => 1]), ['status' => 403, 'code' => 'forbidden', 'pointer' => '/where/passwordHash']);
eq('filtering through a relation onto a hidden column is refused', $probe(['where' => json_encode(['member' => ['passwordHash' => ['isNotNull' => true]]])])[1]['pointer'] ?? null, '/where/member/passwordHash');
eq('nested OR/NOT filters are checked too', $probe(['where' => json_encode(['OR' => [['NOT' => ['suspendedAt' => null]]]])], $token)[1]['pointer'] ?? null, '/where/OR/0/NOT/suspendedAt');
eq('ordering on a hidden column is refused', $probe(['orderBy' => 'guest'], $token)[1]['pointer'] ?? null, '/orderBy/guest');
problem('selecting a hidden column is refused (403, §4.3)', fn () => $clubApp->db->findMany('members', ['columns' => ['passwordHash' => true]], new \Zero\Viewer(['id' => 1, 'name' => 'Ana', 'role' => 'subscriber'], 'standalone')), 403, 'forbidden', '/columns/passwordHash');
eq('hidden columns are unknown to direct writes', $call('PATCH', '/members/1', ['passwordHash' => 'x'], $token)[1]['pointer'] ?? null, '/passwordHash');
eq('role is admin-only: a member can\'t promote themself', $call('PATCH', '/members/1', ['role' => 'admin'], $token)[0], 403);
[$s, $renamed] = $call('PATCH', '/members/1', ['name' => 'Ana B', 'password' => 'a brand new password'], $token);
check('a member updates their own row and password', $s === 200 && $renamed['data']['name'] === 'Ana B' && !$leaks($renamed), $renamed);
eq('a new password ends the old sessions', $call('GET', '/me', null, $token)[0], 401);
eq('the new password signs in', $call('POST', '/auth/token', ['name' => 'ana@example.test', 'password' => 'a brand new password'])[0], 200);
$cliToken = cli2($club, 'token', 'create', 'bo@example.test');
eq('CLI tokens work for auth-collection users', $call('GET', '/me', null, $cliToken[1]['data']['token'] ?? '')[1]['data']['name'] ?? null, 'Bo');
problem('a mutation filtered on a hidden column is refused too', fn () => $clubApp->db->update('members', ['name' => 'x'], ['passwordHash' => ['isNotNull' => true]], true, new \Zero\Viewer(['id' => 1, 'name' => 'Ana', 'role' => 'subscriber'], 'standalone')), 403, 'forbidden', '/where/passwordHash');
problem('… also through a relation', fn () => $clubApp->db->delete('notes', ['member' => ['passwordHash' => ['isNotNull' => true]]], true, new \Zero\Viewer(['id' => 1, 'name' => 'Ana', 'role' => 'admin'], 'standalone')), 403, 'forbidden', '/where/member/passwordHash');
$trusted = $clubApp->db->findMany('members');
check('trusted reads (hooks, CLI) never carry the auth secrets either', !$leaks($trusted) && count($trusted) >= 2, $trusted);
$fresh = $call('POST', '/auth/token', ['name' => 'ana@example.test', 'password' => 'a brand new password'])[1]['data']['accessToken'];
$revisions = $call('GET', '/notes/' . $note['data']['id'] . '/revisions/' . ($call('GET', '/notes/' . $note['data']['id'] . '/revisions', null, $fresh)[1]['data'][0]['id'] ?? 0), null, $fresh);
check('revision reads never expose hidden columns', $revisions[0] === 200 && !$leaks($revisions), $revisions);
$describe = json_encode($call('GET', '/_schema')[1]);
check('/_schema never names hidden columns', !str_contains($describe, 'passwordHash') && !str_contains($describe, 'suspendedAt'), $describe);
[$s, $guest] = $call('POST', '/auth/guest', []);
$gtok = $guest['data']['accessToken'];
check('a guest is a member row with role guest', $s === 201 && $guest['data']['user']['member']['role'] === 'guest' && !$leaks($guest), $guest);
[$s, $up] = $call('POST', '/auth/guest/upgrade', ['name' => 'gina@example.test', 'password' => 'guest no more 1'], $gtok);
check('a guest member upgrades in place: same id, email set, subscriber', $s === 200 && $up['data']['user']['id'] === $guest['data']['user']['id']
    && $up['data']['user']['member']['email'] === 'gina@example.test' && $up['data']['user']['role'] === 'subscriber', $up);
eq('upgrading onto a taken email is a unique violation on /name', $call('POST', '/auth/guest/upgrade', ['name' => 'bo@example.test', 'password' => 'guest no more 1'], $call('POST', '/auth/guest', [])[1]['data']['accessToken'])[1]['pointer'] ?? null, '/name');

finish('auth_test');
