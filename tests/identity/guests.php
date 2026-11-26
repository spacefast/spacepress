<?php
// The identity half of guests (§3.5): issueForUser is the runtime's only, status() reports what
// the runtime enforces, and verifying an email upgrades a guest in place or leaves it alone.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, OAuth, Security};

$tag = bin2hex(random_bytes(4));
add_role('sp_guest', 'Guest', ['read' => true]);
$guest = wp_insert_user(['user_login' => 'zg_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
Plugin::$db->insert('applications', ['id' => 'app_guests_' . $tag, 'name' => 'Guests', 'redirects' => '[]', 'origins' => '[]']);
$oauth = new OAuth(Plugin::$db, Plugin::$accounts);
function session_for(int $uid): array
{
    Plugin::$accounts->ensure($uid);
    return Plugin::$sessions->create($uid);
}
try {
    Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag);
    throw new RuntimeException('FAIL issueForUser ran without the runtime');
} catch (LogicException) {
    echo "PASS issueForUser refuses callers before sp_runtime_loaded\n";
}
do_action('sp_runtime_loaded');
$tokens = Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag);
check($oauth->userinfo($tokens['access_token'])['sub'] === (string) $guest, 'issueForUser mints a working access token for the user');
check($oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $tokens['refresh_token']])['token_type'] === 'Bearer', 'and a refresh token that rotates');
check(Plugin::$accounts->status($guest) === 'active' && Plugin::$accounts->status(PHP_INT_MAX) === 'none', 'status() reports active and none');
Plugin::$accounts->suspend($guest, true);
check(Plugin::$accounts->status($guest) === 'suspended', 'status() reports suspension');
Plugin::$accounts->suspend($guest, false);

$upgraded = [];
add_action('sp_identity_guest_upgraded', static function (int $id) use (&$upgraded): void { $upgraded[] = $id; });
$email = 'guest-' . $tag . '@example.test';
check(Plugin::$accounts->verifiedSignIn($email, session_for($guest)['session']) === $guest, 'a verified email signs the guest into its own account');
clean_user_cache($guest);
check(get_userdata($guest)->roles === ['subscriber'] && Plugin::$accounts->owner($email) === $guest && get_userdata($guest)->user_email === $email, 'the guest is now a subscriber owning that email, same user id');
check($upgraded === [$guest], 'sp_identity_guest_upgraded fired once with the id');

$second = wp_insert_user(['user_login' => 'zg2_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
$owner = Plugin::$accounts->verifiedSignIn($email, session_for($second)['session']);
clean_user_cache($second);
check($owner === $guest && get_userdata($second)->roles === ['sp_guest'], 'an email that belongs to someone signs into that account and leaves the guest as is');
$member = Plugin::$accounts->emailLogin('member-' . $tag . '@example.test');
$other = 'other-' . $tag . '@example.test';
check(Plugin::$accounts->verifiedSignIn($other, session_for($member)['session']) !== $member, 'a non-guest session never absorbs a newly verified email');

$handoffGuest = wp_insert_user(['user_login' => 'zg3_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
$guestTokens = Plugin::$accounts->issueForUser($handoffGuest, 'app_guests_' . $tag);
$handoff = $oauth->handoff($guestTokens['access_token']);
check((int) $oauth->redeemHandoff($handoff)['session']['wp_user_id'] === $handoffGuest, 'a guest access token hands its browser an identity session');
rejects(fn () => $oauth->redeemHandoff($handoff), 'invalid_challenge', 'a handoff is single use');
$pending = $oauth->handoff($guestTokens['access_token']);
$oauth->revoke($guestTokens['refresh_token'], 'app_guests_' . $tag);
rejects(fn () => $oauth->redeemHandoff($pending), 'invalid_challenge', 'revoking the guest family first voids an outstanding handoff');
$guestTokens = Plugin::$accounts->issueForUser($handoffGuest, 'app_guests_' . $tag);
$pending = $oauth->handoff($guestTokens['access_token']);
Plugin::$sessions->revoke($handoffGuest);
rejects(fn () => $oauth->redeemHandoff($pending), 'invalid_challenge', 'revoking the guest sessions first voids an outstanding handoff');

// Fixation: an attacker keeps a guest's tokens and lures another browser into upgrading it.
$fixed = wp_insert_user(['user_login' => 'zg4_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
$attacker = Plugin::$accounts->issueForUser($fixed, 'app_guests_' . $tag);
check(Plugin::$accounts->verifiedSignIn('victim-' . $tag . '@example.test', session_for($fixed)['session']) === $fixed, 'the victim browser upgrades the guest it was handed');
rejects(fn () => $oauth->userinfo($attacker['access_token']), 'invalid_token', 'the upgrade ends every earlier guest access token');
rejects(fn () => $oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $attacker['refresh_token']]), 'invalid_grant', 'and every earlier guest refresh token');
rejects(fn () => $oauth->handoff(Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag)['access_token']), 'not_guest', 'only guests can hand off');

// Durable credentials: whatever a former holder planted on the guest dies with the upgrade, and a
// guest can't enroll such credentials in the first place.
$planted = wp_insert_user(['user_login' => 'zg5_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
Plugin::$accounts->ensure($planted);
$plantedSession = session_for($planted);
$_COOKIE['zi_session'] = $plantedSession['secret'];
$request = new WP_REST_Request('POST');
$request->set_url_params(['operation' => 'passkeys/options']);
$request->set_header('Origin', untrailingslashit(home_url()));
$request->set_header('X-Identity-CSRF', $plantedSession['session']['csrf']);
check((Plugin::$api->dispatch($request)->get_data()['error']['code'] ?? '') === 'guest_account', 'a guest session cannot enroll a passkey or other credential');
unset($_COOKIE['zi_session']);
Plugin::$db->insert('passkeys', ['id' => hash('sha256', $tag), 'wp_user_id' => $planted, 'record' => '{}', 'name' => 'planted', 'created_at' => time()]);
Plugin::$accounts->verifiedSignIn('planted-' . $tag . '@example.test', session_for($planted)['session']);
check(!Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'passkeys WHERE wp_user_id=%d', $planted), 'an upgrade removes every credential planted before it');

// A disabled application voids its outstanding handoffs.
$appGuest = wp_insert_user(['user_login' => 'zg6_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
$appTokens = Plugin::$accounts->issueForUser($appGuest, 'app_guests_' . $tag);
$pending = $oauth->handoff($appTokens['access_token']);
Plugin::$db->run('UPDATE ' . Plugin::$db->prefix . 'applications SET enabled=0 WHERE id=%s', 'app_guests_' . $tag);
rejects(fn () => $oauth->redeemHandoff($pending), 'invalid_challenge', 'disabling the application first voids an outstanding handoff');
Plugin::$db->run('UPDATE ' . Plugin::$db->prefix . 'applications SET enabled=1 WHERE id=%s', 'app_guests_' . $tag);

// A password changed through WordPress itself (profile, reset) ends identity sign-ins too.
$member = Plugin::$accounts->emailLogin('reset-' . $tag . '@example.test');
$memberTokens = Plugin::$accounts->issueForUser($member, 'app_guests_' . $tag);
wp_set_password(Security::token(), $member);
rejects(fn () => $oauth->userinfo($memberTokens['access_token']), 'invalid_token', 'a core password change ends identity access tokens');
rejects(fn () => $oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $memberTokens['refresh_token']]), 'invalid_grant', 'and identity refresh tokens');

// A rolled-back upgrade leaves no cached trace in WordPress.
$rolled = wp_insert_user(['user_login' => 'zg7_' . $tag, 'user_pass' => Security::token(), 'role' => 'sp_guest']);
$session = session_for($rolled)['session'];
get_userdata($rolled); // warm the cache
$boom = static function (): never { throw new RuntimeException('hook failed'); };
add_action('sp_identity_guest_upgraded', $boom);
try {
    Plugin::$accounts->verifiedSignIn('rolled-' . $tag . '@example.test', $session);
} catch (RuntimeException) {
}
remove_action('sp_identity_guest_upgraded', $boom);
$after = get_userdata($rolled);
check($after->roles === ['sp_guest'] && $after->user_email === '', 'a failed upgrade rolls back, cached user included');

// The upgrade also resets core WordPress credentials a former holder could have created.
$core = wp_insert_user(['user_login' => 'zg8_' . $tag, 'user_pass' => 'planted-password-123', 'role' => 'sp_guest']);
WP_Application_Passwords::create_new_application_password($core, ['name' => 'planted']);
Plugin::$accounts->verifiedSignIn('core-' . $tag . '@example.test', session_for($core)['session']);
clean_user_cache($core);
check(!wp_check_password('planted-password-123', get_userdata($core)->user_pass, $core) && WP_Application_Passwords::get_user_application_passwords($core) === [], 'the upgrade resets the WordPress password and deletes application passwords');

// Deleting a WordPress user deletes its identity: credentials, emails, account. A new user with the
// same email starts clean, and nothing of the old one signs anyone in.
require_once ABSPATH . 'wp-admin/includes/user.php';
$doomed = Plugin::$accounts->emailLogin("doomed-$tag@example.test");
$doomedTokens = Plugin::$accounts->issueForUser($doomed, 'app_guests_' . $tag);
wp_delete_user($doomed);
rejects(fn () => $oauth->userinfo($doomedTokens['access_token']), 'invalid_token', 'a deleted user\'s access token is dead');
rejects(fn () => $oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $doomedTokens['refresh_token']]), 'invalid_grant', 'and its refresh token');
check(Plugin::$accounts->owner("doomed-$tag@example.test") === 0 && Plugin::$accounts->status($doomed) === 'none', 'its verified email and account are gone');
$reborn = Plugin::$accounts->emailLogin("doomed-$tag@example.test");
check($reborn !== $doomed && Plugin::$accounts->owner("doomed-$tag@example.test") === $reborn, 'the email signs a fresh account in, not the deleted one');
