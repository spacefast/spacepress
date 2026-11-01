<?php

declare(strict_types=1);

/*
 * `auth: true` collections on WordPress (§6.2), in-process (tests/php/wp.php): members are WordPress
 * users, the row is the user plus usermeta, hidden columns (passwordHash, suspendedAt, guest) never
 * leave the runtime, "self" rules, role is admin-only, passwords are WordPress's. Sign-in, tokens,
 * guests and suspension belong to zero-identity and are proven in tests/wp/auth.test.ts and
 * tests/identity; here the viewer is the WordPress user, as a cookie or application password gives it.
 */

use Zero\Viewer;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = json_decode(file_get_contents(dirname(__DIR__) . '/fixtures/auth/schema.json'), true, 512, JSON_THROW_ON_ERROR);
$wp = wpSite('auth', ['schema' => $schema, 'functions' => '']);
$app = $wp->app();
$db = $app->db;

/** @return array{int, mixed} [status, decoded body] as the WordPress user $as (an id or test user name; null anonymous) */
$call = static function (string $method, string $path, mixed $body = null, string|int|null $as = null, array $query = []) use ($wp): array {
    [$status, , , $payload] = $wp->call($method, $path, $body, $as, $query);

    return [$status, json_decode($payload, true)];
};
$hidden = ['passwordHash', 'suspendedAt', 'guest'];
$leaks = static function (mixed $data) use ($hidden): bool {
    $json = json_encode($data);
    foreach ($hidden as $col) {
        if (str_contains($json, "\"$col\":")) {
            return true;
        }
    }

    return str_contains($json, '$2y$') || str_contains($json, '$wp$') || str_contains($json, '$P$');
};

// ================================================================ members are WordPress users

// Members read "self", so a public create would answer whether an email is taken (#72): sign-up is
// zero-identity's; here the trusted pipeline creates members.
$ana = ['data' => $db->insert('members', ['email' => 'ana@example.test', 'name' => 'Ana', 'password' => 'correct horse battery'], true)[0]];
check('trusted creation hashes a write-only password and strips hidden columns', $ana['data']['role'] === 'subscriber' && !$leaks($ana) && !array_key_exists('password', $ana['data']), $ana);
$anaId = (int) $ana['data']['id'];
$user = get_userdata($anaId);
check('the row is a WordPress user: id, email, display name, role', $user instanceof WP_User && $user->user_email === 'ana@example.test' && $user->display_name === 'Ana' && in_array('subscriber', $user->roles, true), $user?->to_array());
check('the password is stored as a WordPress hash that checks out', str_starts_with($user->user_pass, '$') && wp_check_password('correct horse battery', $user->user_pass, $anaId) && !wp_check_password('wrong', $user->user_pass, $anaId));
eq('WordPress authenticates the member with it', wp_authenticate('ana@example.test', 'correct horse battery')->ID ?? null, $anaId);
eq('member columns live in usermeta with the collection\'s defaults', get_user_meta($anaId, 'zero_plan', true), 'free');
problem('a short password is refused', fn () => $db->insert('members', ['email' => 'x@example.test', 'name' => 'X', 'password' => 'short'], true, new Viewer(null)), 422, 'invalid_input', '/password');
problem('a password with NUL is refused before hashing', fn () => $db->insert('members', ['email' => 'nul@example.test', 'name' => 'N', 'password' => "long password\0with nul"], true, new Viewer(null)), 422, 'invalid_input', '/password');
problem('a taken email is a unique violation', fn () => $db->insert('members', ['email' => 'ana@example.test', 'name' => 'Ana 2', 'password' => 'another long one']), 409, 'unique_violation', '/email');

// ================================================================ /me and "self"

eq('/me carries the member row, as the user\'s WordPress identity', [$call('GET', '/me', null, $anaId)[1]['data']['id'] ?? null, $call('GET', '/me', null, $anaId)[1]['data']['member']['plan'] ?? null], [$anaId, 'free']);
check('/me never exposes hidden columns', !$leaks($call('GET', '/me', null, $anaId)[1]));
$boId = (int) $db->insert('members', ['email' => 'bo@example.test', 'name' => 'Bo', 'password' => 'another long one'], true)[0]['id'];
[$s, $list] = $call('GET', '/members', null, $anaId);

// A public create on a collection whose read rule is "self" would reveal whether an email is taken: it
// is refused before any lookup, whatever the email.
foreach (['ana@example.test', 'free@example.test'] as $email) {
    eq('self-read cannot expose uniqueness through anonymous creation', $call('POST', '/members', ['email' => $email, 'name' => 'Probe', 'password' => 'another long one'])[0], 401);
}
check('"self" read: a member lists only their own row', $s === 200 && array_column($list['data'], 'email') === ['ana@example.test'] && !$leaks($list), $list);
eq('"self" read: anonymous → 401', $call('GET', '/members')[0], 401);
eq('"self" update: another member\'s row is not found', $call('PATCH', "/members/$boId", ['name' => 'Hacked'], $anaId)[0], 404);
eq('"self" read: another member\'s row is not found', $call('GET', "/members/$boId", null, $anaId)[0], 404);
eq('"self" is a filter, not a ladder: an administrator lists their own row only', array_column($call('GET', '/members', null, 'admin')[1]['data'], 'id'), [$wp->userId('admin')]);
eq('existing WordPress users became members with the collection\'s defaults when the app activated', $call('GET', "/members/{$wp->userId('admin')}", null, 'admin')[1]['data']['plan'] ?? null, 'free');

// ================================================================ hidden columns never leave the runtime

[$s, $note] = $call('POST', '/notes', ['body' => 'hi', 'memberId' => $anaId], $anaId);
[$s, $with] = $call('GET', '/notes', null, $anaId, ['with' => 'member']);
check('with: a related member never exposes hidden columns', $s === 200 && ($with['data'][0]['member']['email'] ?? null) === 'ana@example.test' && !$leaks($with), $with);
[$s, $revs] = $call('PATCH', '/notes/' . $note['data']['id'], ['body' => 'edited'], $anaId);
check('write results never expose hidden columns', $s === 200 && !$leaks($revs), $revs);
$probe = static fn (array $query, string|int|null $as = null): array => $call('GET', str_contains(json_encode($query), 'member') && !isset($query['orderBy']) ? '/notes' : '/members', null, $as, $query);
eq('filtering on a hidden column is refused (403, §4.3)', array_intersect_key($probe(['where' => json_encode(['passwordHash' => ['like' => '$2y%']])], $anaId)[1], ['status' => 1, 'code' => 1, 'pointer' => 1]),
    ['status' => 403, 'code' => 'forbidden', 'pointer' => '/where/passwordHash']);
eq('filtering through a relation onto a hidden column is refused', $probe(['where' => json_encode(['member' => ['passwordHash' => ['isNotNull' => true]]])])[1]['pointer'] ?? null, '/where/member/passwordHash');
eq('nested OR/NOT filters are checked too', $probe(['where' => json_encode(['OR' => [['NOT' => ['suspendedAt' => null]]]])], $anaId)[1]['pointer'] ?? null, '/where/OR/0/NOT/suspendedAt');
eq('ordering on a hidden column is refused', $probe(['orderBy' => 'guest'], $anaId)[1]['pointer'] ?? null, '/orderBy/guest');
problem('selecting a hidden column is refused (403, §4.3)', fn () => $db->findMany('members', ['columns' => ['passwordHash' => true]], new Viewer($wp->user('admin'))), 403, 'forbidden', '/columns/passwordHash');
eq('hidden columns are unknown to direct writes', $call('PATCH', "/members/$anaId", ['passwordHash' => 'x'], $anaId)[1]['pointer'] ?? null, '/passwordHash');
problem('a mutation filtered on a hidden column is refused too', fn () => $db->update('members', ['name' => 'x'], ['passwordHash' => ['isNotNull' => true]], true, new Viewer($wp->user('admin'))), 403, 'forbidden', '/where/passwordHash');
problem('… also through a relation', fn () => $db->delete('notes', ['member' => ['passwordHash' => ['isNotNull' => true]]], true, new Viewer($wp->user('admin'))), 403, 'forbidden', '/where/member/passwordHash');
$trusted = $db->findMany('members');
check('trusted reads (hooks, CLI) never carry the auth secrets either', !$leaks($trusted) && count($trusted) >= 2, $trusted);
$revisionList = $call('GET', '/notes/' . $note['data']['id'] . '/revisions', null, $anaId)[1]['data'] ?? [];
$revision = $call('GET', '/notes/' . $note['data']['id'] . '/revisions/' . ($revisionList[0]['id'] ?? 0), null, $anaId);
check('revision reads never expose hidden columns', $revision[0] === 200 && !$leaks($revision), $revision);
$describe = json_encode($call('GET', '/_schema')[1]);
check('/_schema never names hidden columns', !str_contains($describe, 'passwordHash') && !str_contains($describe, 'suspendedAt'), $describe);

// ================================================================ role and password

eq('role is admin-only: a member can\'t promote themself', $call('PATCH', "/members/$anaId", ['role' => 'admin'], $anaId)[0], 403);
problem('… and even an admin can\'t clear it: role is never null', fn () => $db->update('members', ['role' => null], ['id' => $wp->userId('admin')], false, new Viewer($wp->user('admin'))), 422, 'invalid_input', '/role');
$promoted = $db->update('members', ['role' => 'editor'], ['id' => $boId], true)[0];
eq('a role change is the WordPress role, and the one Zero authenticates with', [$promoted['role'], (new WP_User($boId))->roles, \Zero\Wp\WpAuth::map(new WP_User($boId))['role']], ['editor', ['editor'], 'editor']);
(new WP_User($boId))->set_role('administrator');
eq('a role given by WordPress is the member\'s role', [$db->findFirst('members', ['where' => ['id' => $boId]])['role'], $call('GET', '/me', null, $boId)[1]['data']['member']['role'] ?? null], ['admin', 'admin']);
[$s, $renamed] = $call('PATCH', "/members/$anaId", ['name' => 'Ana B', 'password' => 'a brand new password'], $anaId);
check('a member updates their own row and password', $s === 200 && $renamed['data']['name'] === 'Ana B' && !$leaks($renamed), $renamed);
eq('the new password is the one WordPress checks', [wp_check_password('a brand new password', get_userdata($anaId)->user_pass, $anaId), wp_check_password('correct horse battery', get_userdata($anaId)->user_pass, $anaId)], [true, false]);
eq('the display name followed', get_userdata($anaId)->display_name, 'Ana B');

// ================================================================ rollback and delete

try {
    $db->transaction(static function () use ($db, $anaId): void {
        $db->update('members', ['plan' => 'pro'], ['id' => $anaId]);
        get_user_meta($anaId, 'zero_plan', true); // a hook reads the new value
        throw new RuntimeException('rollback');
    });
} catch (RuntimeException) {
}
eq('a rolled-back member update leaves no usermeta in WordPress\'s cache', [get_user_meta($anaId, 'zero_plan', true), $db->findFirst('members', ['where' => ['id' => $anaId]])['plan']], ['free', 'free']);
$gone = $db->insert('members', ['email' => 'gone@example.test', 'name' => 'Gone', 'password' => 'gone password 1'], true)[0];
$db->delete('members', ['id' => $gone['id']]);
eq('deleting a member deletes the WordPress user', [get_userdata((int) $gone['id']), $db->findFirst('members', ['where' => ['id' => $gone['id']]])], [false, null]);

finish('auth_test');
