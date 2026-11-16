<?php

declare(strict_types=1);

/*
 * `auth: true` collections on WordPress (§6.2), in-process (tests/php/wp.php): members are WordPress
 * users, the row is the user plus usermeta, hidden columns (passwordHash, suspendedAt, guest) never
 * leave the runtime, "self" rules, role is admin-only, passwords are WordPress's. Sign-in, tokens,
 * guests and suspension belong to typedpress-identity and are proven in tests/wp/auth.test.ts and
 * tests/identity; here the viewer is the WordPress user, as a cookie or application password gives it.
 */

use TypedPress\Viewer;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = json_decode(file_get_contents(dirname(__DIR__) . '/fixtures/auth/schema.json'), true, 512, JSON_THROW_ON_ERROR);
// Two unique columns beside the email: one the viewer may read, one hidden from everyone.
$schema['collections']['members']['columns']['handle'] = ['type' => 'text', 'unique' => true];
$schema['collections']['members']['columns']['secret'] = ['type' => 'text', 'unique' => true, 'access' => ['read' => ['allow' => false]]];
$wp = wpSite('auth', ['schema' => $schema, 'functions' => '', 'identity' => true, 'server' => true]);
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
// typedpress-identity's; here the trusted pipeline creates members.
$ana = ['data' => $db->insert('members', ['email' => 'ana@example.test', 'name' => 'Ana', 'password' => 'correct horse battery'], true)[0]];
check('trusted creation hashes a write-only password and strips hidden columns', $ana['data']['role'] === 'subscriber' && !$leaks($ana) && !array_key_exists('password', $ana['data']), $ana);
$anaId = (int) $ana['data']['id'];
$user = get_userdata($anaId);
check('the row is a WordPress user: id, email, display name, role', $user instanceof WP_User && $user->user_email === 'ana@example.test' && $user->display_name === 'Ana' && in_array('subscriber', $user->roles, true), $user?->to_array());
check('the password is stored as a WordPress hash that checks out', str_starts_with($user->user_pass, '$') && wp_check_password('correct horse battery', $user->user_pass, $anaId) && !wp_check_password('wrong', $user->user_pass, $anaId));
eq('WordPress authenticates the member with it', wp_authenticate('ana@example.test', 'correct horse battery')->ID ?? null, $anaId);
eq('member columns live in usermeta with the collection\'s defaults', get_user_meta($anaId, 'tp_plan', true), 'free');
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
// WordPress's Users screen shows every email to whoever may list users, so for them a unique write
// of `email` answers plainly. Everyone else, and every other unique column, is refused as before.
$probe = static fn (array $more, string|int $as): array => $call('POST', '/members', $more + ['name' => 'Probe', 'password' => 'another long one'], $as);
[$takenStatus, $taken] = $probe(['email' => 'ana@example.test'], 'admin');
eq('an administrator is told an email is taken', [$takenStatus, $taken['code'] ?? null, $taken['pointer'] ?? null], [409, 'unique_violation', '/email']);
eq('an administrator creates a member with an email', $probe(['email' => 'made-by-admin@example.test'], 'admin')[0], 201);
$madeId = (int) (get_user_by('email', 'made-by-admin@example.test')->ID ?? 0);
check('and the member is a WordPress user', $madeId > 0);
$db->delete('members', ['id' => $madeId]);
foreach (['bo@example.test', 'free@example.test'] as $email) {
    [$status, $refused] = $probe(['email' => $email], 'editor');
    eq('an editor, who lists no users, is refused for a taken and a free email alike', [$status, $refused['pointer'] ?? null, $refused['detail'] ?? null], [403, '/email', "You can't set email"]);
}
// A scoped application password of the administrator: it creates no user and changes none of its
// own sign-in fields, through TypedPress's abilities as through core's users route.
[$scopedPassword, $scopedItem] = \WP_Application_Passwords::create_new_application_password($wp->userId('admin'), ['name' => 'scoped agent']);
\TypedPress\Wp\AgentScope::store($wp->userId('admin'), $scopedItem['uuid'], ['write' => true, 'personal' => true, 'abilities' => null]);
$ability = static function (string $name, array $input, string $credential) use ($wp): array {
    $ch = curl_init($wp->url() . "/wp-json/wp-abilities/v1/abilities/club/$name/run");
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => 'POST', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Basic ' . base64_encode($credential)], CURLOPT_POSTFIELDS => json_encode(['input' => $input])]);
    $out = curl_exec($ch);

    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), is_string($out) ? json_decode($out, true) : null];
};
$scoped = 'admin:' . $scopedPassword;
$adminHash = get_userdata($wp->userId('admin'))->user_pass;
foreach ([['email' => 'ana@example.test'], ['email' => 'by-scope@example.test'], ['email' => 'by-scope-admin@example.test', 'role' => 'admin']] as $more) {
    [$status, $refused] = $ability('members-create', $more + ['name' => 'Scoped', 'password' => 'another long one'], $scoped);
    // The email is refused first, for a taken and a free value alike: the exception is not for a scope.
    eq('a scoped credential creates no user through an ability', [$status, $refused['code'] ?? null, $refused['data']['pointer'] ?? null], [403, 'tp_forbidden', '/email']);
}
[$status, $refused] = $ability('members-update', ['id' => $wp->userId('admin'), 'patch' => ['email' => 'moved@example.test']], $scoped);
eq('nor changes its own email', [$status, $refused['code'] ?? null, $refused['data']['pointer'] ?? null], [403, 'tp_forbidden', '/email']);
foreach ([['password' => 'a brand new password'], ['role' => 'editor']] as $field) {
    [$status, $refused] = $ability('members-update', ['id' => $wp->userId('admin'), 'patch' => $field], $scoped);
    eq('nor its ' . key($field), [$status, $refused['code'] ?? null], [403, 'tp_scope']);
}
eq('it still edits the rest of its profile', $ability('members-update', ['id' => $wp->userId('admin'), 'patch' => ['name' => 'Renamed by scope']], $scoped)[0], 200);
wp_cache_flush();
eq('and nothing was written', [get_user_by('email', 'by-scope@example.test'), get_user_by('email', 'by-scope-admin@example.test'), get_userdata($wp->userId('admin'))->user_pass === $adminHash], [false, false, true]);
eq('the same ability with the unscoped credential still creates the member', $ability('members-create', ['email' => 'by-unscoped@example.test', 'name' => 'Unscoped', 'password' => 'another long one'], $wp->appPassword('admin'))[0], 200);
wp_cache_flush();
$db->delete('members', ['id' => (int) (get_user_by('email', 'by-unscoped@example.test')->ID ?? 0)]);
foreach (['ana-handle', 'free-handle'] as $handle) {
    [$status, $refused] = $call('PATCH', "/members/{$wp->userId('admin')}", ['handle' => $handle], 'admin');
    eq('a unique column the Users screen does not show stays refused to an administrator', [$status, $refused['pointer'] ?? null], [403, '/handle']);
    [$status, $refused] = $call('PATCH', "/members/{$wp->userId('admin')}", ['secret' => $handle], 'admin');
    eq('and so does a unique column hidden from them', [$status, $refused['pointer'] ?? null], [403, '/secret']);
}
eq('existing WordPress users became members with the collection\'s defaults when the app activated', $call('GET', "/members/{$wp->userId('admin')}", null, 'admin')[1]['data']['plan'] ?? null, 'free');

// ================================================================ hidden columns never leave the runtime

[$s, $note] = $call('POST', '/notes', ['body' => 'hi', 'memberId' => $anaId], $anaId);
[$s, $with] = $call('GET', '/notes', null, $anaId, ['with' => 'memberId']);
check('with: a related member never exposes hidden columns', $s === 200 && ($with['data'][0]['memberId']['email'] ?? null) === 'ana@example.test' && !$leaks($with), $with);
[$s, $revs] = $call('PATCH', '/notes/' . $note['data']['id'], ['body' => 'edited'], $anaId);
check('write results never expose hidden columns', $s === 200 && !$leaks($revs), $revs);
$probe = static fn (array $query, string|int|null $as = null): array => $call('GET', str_contains(json_encode($query), 'member') && !isset($query['orderBy']) ? '/notes' : '/members', null, $as, $query);
eq('filtering on a hidden column is refused (403, §4.3)', array_intersect_key($probe(['where' => json_encode(['passwordHash' => ['like' => '$2y%']])], $anaId)[1], ['status' => 1, 'code' => 1, 'pointer' => 1]),
    ['status' => 403, 'code' => 'forbidden', 'pointer' => '/where/passwordHash']);
eq('filtering through a relation onto a hidden column is refused', $probe(['where' => json_encode(['memberId' => ['passwordHash' => ['isNotNull' => true]]])])[1]['pointer'] ?? null, '/where/memberId/passwordHash');
eq('nested OR/NOT filters are checked too', $probe(['where' => json_encode(['OR' => [['NOT' => ['suspendedAt' => null]]]])], $anaId)[1]['pointer'] ?? null, '/where/OR/0/NOT/suspendedAt');
eq('ordering on a hidden column is refused', $probe(['orderBy' => 'guest'], $anaId)[1]['pointer'] ?? null, '/orderBy/guest');
problem('selecting a hidden column is refused (403, §4.3)', fn () => $db->findMany('members', ['columns' => ['passwordHash' => true]], new Viewer($wp->user('admin'))), 403, 'forbidden', '/columns/passwordHash');
eq('hidden columns are unknown to direct writes', $call('PATCH', "/members/$anaId", ['passwordHash' => 'x'], $anaId)[1]['pointer'] ?? null, '/passwordHash');
problem('a mutation filtered on a hidden column is refused too', fn () => $db->update('members', ['name' => 'x'], ['passwordHash' => ['isNotNull' => true]], true, new Viewer($wp->user('admin'))), 403, 'forbidden', '/where/passwordHash');
problem('… also through a relation', fn () => $db->delete('notes', ['memberId' => ['passwordHash' => ['isNotNull' => true]]], true, new Viewer($wp->user('admin'))), 403, 'forbidden', '/where/memberId/passwordHash');
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
eq('a role change is the WordPress role, and the one TypedPress authenticates with', [$promoted['role'], (new WP_User($boId))->roles, \TypedPress\Wp\WpAuth::map(new WP_User($boId))['role']], ['editor', ['editor'], 'editor']);
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
        get_user_meta($anaId, 'tp_plan', true); // a hook reads the new value
        throw new RuntimeException('rollback');
    });
} catch (RuntimeException) {
}
eq('a rolled-back member update leaves no usermeta in WordPress\'s cache', [get_user_meta($anaId, 'tp_plan', true), $db->findFirst('members', ['where' => ['id' => $anaId]])['plan']], ['free', 'free']);
$gone = $db->insert('members', ['email' => 'gone@example.test', 'name' => 'Gone', 'password' => 'gone password 1'], true)[0];
$db->delete('members', ['id' => $gone['id']]);
eq('deleting a member deletes the WordPress user', [get_userdata((int) $gone['id']), $db->findFirst('members', ['where' => ['id' => $gone['id']]])], [false, null]);

// ================================================================ search over members

$prefix = $wp->connection()->prefix();
$entries = static fn (int $id): array => array_column($wp->sql("SELECT `field`, `body` FROM `{$prefix}tp__search` WHERE `kind` = ? AND `item` = ?", [new \TypedPress\Wp\Bytes('members'), new \TypedPress\Wp\Bytes((string) $id)]), 'body', 'field');
/** @return array{list<int>|int, string} the ids core's users route returns for a search and its X-WP-Total, or the error's status and code */
$coreUsers = static function (array $params, string|int $as) use ($wp): array {
    $wp->actAs($as);
    try {
        $request = new WP_REST_Request('GET', '/wp/v2/users');
        $request->set_query_params($params);
        $response = rest_do_request($request);
    } finally {
        wp_set_current_user(0);
    }
    if ($response->is_error()) {
        return [$response->get_status(), (string) ($response->as_error()->get_error_code())];
    }
    $ids = array_map(static fn (array $u): int => (int) $u['id'], (array) $response->get_data());
    sort($ids);

    return [$ids, (string) ($response->get_headers()['X-WP-Total'] ?? '')];
};
// A user changed by WordPress itself (wp-admin's user screen, another plugin) is re-indexed: core's
// user hooks report it, as TypedPress's own writes do.
wp_update_user(['ID' => $boId, 'display_name' => 'Bo Zephyr']);
eq('a core user update re-indexes the member', $entries($boId)['name'] ?? null, 'Bo Zephyr');
eq('the member finds themself by the new name', array_column($call('GET', '/members', null, $boId, ['search' => 'zephyr'])[1]['data'] ?? [], 'id'), [$boId]);
// Core's users route searches through TypedPress as the reader: the read rule ("self") decides, not core's
// `list_users`, and core's own search over login and email (fields no reader is matched on) is off.
eq('core /wp/v2/users?search= finds the reader\'s own row', $coreUsers(['search' => 'zephyr'], $boId), [[$boId], '1']);
eq('an administrator, whom "self" limits too, finds nobody else and counts nobody', $coreUsers(['search' => 'zephyr'], 'admin'), [[], '0']);
eq('nor by email, which is not a searchable field', $coreUsers(['search' => 'bo@example.test'], 'admin'), [[], '0']);
eq('search_columns=name searches the name', $coreUsers(['search' => 'zephyr', 'search_columns' => ['name']], $boId), [[$boId], '1']);
eq('search_columns=email matches nothing: email is not a searchable field', $coreUsers(['search' => 'bo', 'search_columns' => ['email']], $boId), [[], '0']);
$late = wp_insert_user(['user_login' => 'late', 'user_email' => 'late@example.test', 'user_pass' => 'late password 1', 'display_name' => 'Late Quokka']);
eq('a user created by WordPress is indexed', $entries($late)['name'] ?? null, 'Late Quokka');
require_once ABSPATH . 'wp-admin/includes/user.php';
wp_delete_user($late);
eq('a user deleted by WordPress leaves no entries', $entries($late), []);

// ================================================================ sign-in doesn't reveal which accounts exist

// The loginErrors switch (Hardening::loginErrors), with typedpress-identity active. wp-login.php itself
// (the form, lost password, "check your email") is proven over HTTP in tests/wp/hardening.
$generic = __('<strong>Error:</strong> Invalid username, email address or incorrect password.');
$loginErrors = static function (string ...$codes): string {
    $GLOBALS['errors'] = new WP_Error();
    foreach ($codes as $code) {
        $GLOBALS['errors']->add($code, "core's $code message");
    }
    try {
        return apply_filters('login_errors', "core's message");
    } finally {
        unset($GLOBALS['errors']);
    }
};
eq('wp-login.php: an unknown username, an unknown email, a wrong password and an unknown lost-password account read the same',
    array_map($loginErrors, ['invalid_username', 'invalid_email', 'incorrect_password', 'invalidcombo']), array_fill(0, 4, $generic));
eq('… while errors that say nothing about the account stay core\'s', $loginErrors('empty_password'), "core's message");
$_GET['checkemail'] = 'confirm';
$confirm = apply_filters('wp_login_errors', new WP_Error('confirm', 'Check your email for the confirmation link', 'message'), '');
unset($_GET['checkemail']);
check('"check your email" says the email goes out only if the account exists', str_starts_with($confirm->get_error_message('confirm'), 'If there is an account associated') && $confirm->get_error_data('confirm') === 'message', $confirm->get_error_messages());

/** What wp_authenticate() costs: password checks and hashes, by core's own filters. */
$cost = static function (string $login, string $password): array {
    $checks = 0;
    $hashes = 0;
    $check = static function (mixed $ok) use (&$checks): mixed {
        $checks++;
        return $ok;
    };
    $hash = static function (mixed $algorithm) use (&$hashes): mixed {
        $hashes++;
        return $algorithm;
    };
    add_filter('check_password', $check);
    add_filter('wp_hash_password_algorithm', $hash);
    try {
        $result = wp_authenticate($login, $password);
    } finally {
        remove_filter('check_password', $check);
        remove_filter('wp_hash_password_algorithm', $hash);
    }

    return [is_wp_error($result) ? $result->get_error_code() : 'signed in', $checks + $hashes];
};
$pass = 'correct horse battery stapler';
$known = $wp->addUser('known', 'subscriber', $pass);
eq('an unknown username is a wrong password, and costs one password hash like one', [$cost('nobody', 'guess'), $cost('known', 'guess')], [['incorrect_password', 1], ['incorrect_password', 1]]);
eq('so is an unknown email, and a wrong password for a known email is checked once (not again by typedpress-identity)',
    [$cost('nobody@example.test', 'guess'), $cost('known@example.test', 'guess')], [['incorrect_password', 1], ['incorrect_password', 1]]);
$twin = wp_insert_user(['user_login' => 'twin@example.test', 'user_email' => 'twin@example.test', 'user_pass' => $pass, 'role' => 'subscriber']);
eq('a login that is also the same user\'s email is checked once, not by both of core\'s checks', [$cost('twin@example.test', 'guess'), $cost('twin@example.test', $pass)[0]], [['incorrect_password', 1], 'signed in']);
eq('the right password still signs in, by username or email', [$cost('known@example.test', $pass)[0], $cost('known', $pass)[0]], ['signed in', 'signed in']);

// typedpress-identity's second factor: wp-login.php sends an account with one to the identity sign-in, but
// only after the password checks out, so a wrong password doesn't reveal the account or its factor.
\TypedPress\Identity\Plugin::$accounts->ensure($known);
$mfa = new \TypedPress\Identity\Mfa(\TypedPress\Identity\Plugin::$db, \TypedPress\Identity\Plugin::$security);
$totp = \TypedPress\Identity\Vendor\OTPHP\TOTP::createFromSecret($mfa->setup($known, 'Login errors')['secret']);
check('the account has a second factor', $mfa->verify($known, $totp->now(), true));
eq('with a second factor, a wrong password is a wrong password (one check), and the right one asks for the factor',
    [$cost('known@example.test', 'guess'), $cost('known', $pass)[0]], [['incorrect_password', 1], 'identity_mfa_required']);

// Application passwords: core answers REST with the error's code, which said "unknown user" apart from "wrong password".
$appPassword = static function (string $login): string {
    add_filter('application_password_is_api_request', '__return_true');
    try {
        $result = wp_authenticate_application_password(null, $login, 'abcd efgh ijkl mnop qrst uvwx');
    } finally {
        remove_filter('application_password_is_api_request', '__return_true');
    }

    return is_wp_error($result) ? implode(',', $result->get_error_codes()) : 'signed in';
};
$guestId = wp_insert_user(['user_login' => 'zg_probe', 'user_pass' => wp_generate_password(32), 'role' => 'tp_guest']);
eq('an application password for an unknown user or email, or for a guest who may not use one, gets the wrong-password error',
    array_map($appPassword, ['nobody', 'nobody@example.test', 'zg_probe', 'admin']), array_fill(0, 4, 'incorrect_password'));
add_filter('wp_is_application_passwords_available', '__return_false');
eq('with application passwords off, every user gets "not available"', array_map($appPassword, ['nobody', 'admin']), ['application_passwords_disabled', 'application_passwords_disabled']);
remove_filter('wp_is_application_passwords_available', '__return_false');

// The limiter on this harness's database (SQLite, through WordPress's MySQL translation): one row per
// bucket, a window that starts at the first attempt and restarts once it has ended. tests/identity
// proves the same on MariaDB.
$security = \TypedPress\Identity\Plugin::$security;
$identityDb = \TypedPress\Identity\Plugin::$db;
$epoch = 2_000_000_100;
$at = static function (int $seconds) use ($epoch): void { \TypedPress\Identity\Security::$clock = static fn (): int => $epoch + $seconds; };
$attempt = static function (string $bucket, int $max) use ($security): string {
    try {
        $security->limit($bucket, $max);
        return 'ok';
    } catch (\TypedPress\Identity\Failure $e) {
        return $e->kind;
    }
};
$stored = static fn (): array => array_map(static fn (array $r): array => [(int) $r['hits'], (int) $r['expires_at']], $identityDb->rows("SELECT hits, expires_at FROM {$identityDb->prefix}limits WHERE id=%s", \TypedPress\Identity\Security::hash('corpus-probe')));
$identityDb->run("DELETE FROM {$identityDb->prefix}limits");
$at(299);
eq('limiter: three attempts pass and the fourth is refused', [$attempt('corpus-probe', 3), $attempt('corpus-probe', 3), $attempt('corpus-probe', 3), $attempt('corpus-probe', 3)], ['ok', 'ok', 'ok', 'rate_limited']);
eq('limiter: one row, counted, ending a window after the first attempt', $stored(), [[4, $epoch + 599]]);
eq('limiter: reading it counts nothing', [$security->limited('corpus-probe', 3), $security->limited('corpus-probe', 5), $stored()], [true, false, [[4, $epoch + 599]]]);
$at(301);
eq('limiter: not reset by the clock passing a multiple of the window', [$attempt('corpus-probe', 3), $stored()], ['rate_limited', [[5, $epoch + 599]]]);
$at(599);
eq('limiter: full through the last second of its window', $security->limited('corpus-probe', 3), true);
$at(600);
eq('limiter: an ended window holds nothing', $security->limited('corpus-probe', 3), false);
eq('limiter: the next attempt starts a new window from one', [$attempt('corpus-probe', 3), $stored()], ['ok', [[1, $epoch + 900]]]);
\TypedPress\Identity\Security::$clock = null;
$identityDb->run("DELETE FROM {$identityDb->prefix}limits");

require dirname(__DIR__) . '/identity/native-auth-storage.php';
finish('auth_test');
