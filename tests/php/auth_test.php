<?php

declare(strict_types=1);

/*
 * Standalone identity (§5.2): users and tokens minted through the real CLI (zero/bin/zero.php), bearer
 * resolution, revocation, role changes, password login, hashing at rest.
 */

use Zero\App;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = blogApp(sys_get_temp_dir() . '/zero-auth-test-' . bin2hex(random_bytes(4)));
putenv('ZERO_DB_PATH');
putenv('ZERO_AUTO_MIGRATE');
ini_set('error_log', "$root/error.log");
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));

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

$me = static function (?string $auth) use ($app): mixed {
    [, , $body] = $app->handle('GET', '/me', [], '', $auth === null ? [] : ['Authorization' => $auth]);

    return json_decode($body, true)['data'] ?? null;
};
eq('bearer resolves the user and role', $me("Bearer $token"), ['id' => 1, 'name' => 'maria', 'role' => 'editor']);
check('lastUsedAt recorded', $pdo->query('SELECT "lastUsedAt" FROM "__zero_tokens"')->fetchColumn() !== null);
eq('unknown token is anonymous', $me('Bearer zt_' . str_repeat('A', 40)), null);
eq('malformed header is anonymous', $me("Basic $token"), null);

cli('user', 'role', 'maria', 'author');
eq('role change applies to existing tokens', $me("Bearer $token")['role'] ?? null, 'author');
eq('token revoke', cli('token', 'revoke', (string) $listed[0]['id'])[0], 0);
eq('revoked token is anonymous', $me("Bearer $token"), null);

$login = static function (array $body) use ($app): array {
    [$status, , $out] = $app->handle('POST', '/auth/token', [], json_encode($body));

    return [$status, json_decode($out, true)];
};
[$s, $out] = $login(['name' => 'maria', 'password' => 's3cret pass']);
check('POST /auth/token mints a working token', $s === 200 && $out['data']['user'] === ['id' => 1, 'name' => 'maria', 'role' => 'author'] && $me('Bearer ' . $out['data']['token'])['name'] === 'maria', $out);
eq('wrong password → 401', [$login(['name' => 'maria', 'password' => 'nope'])[0], $login(['name' => 'maria', 'password' => 'nope'])[1]['code']], [401, 'unauthenticated']);
eq('user without a password can\'t log in', $login(['name' => 'sam', 'password' => ''])[0], 401);
eq('missing fields → 422', $login(['name' => 'maria'])[1]['pointer'] ?? null, '/password');

eq('user remove drops their tokens', [cli('user', 'remove', 'maria')[0], (int) $pdo->query('SELECT COUNT(*) FROM "__zero_tokens"')->fetchColumn()], [0, 0]);
eq('publish-due via CLI (nothing due)', cli('publish-due'), [0, ['data' => ['promoted' => []]]]);

finish('auth_test');
