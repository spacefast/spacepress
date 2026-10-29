<?php
// The identity half of guests (§3.5): issueForUser is the runtime's only, status() reports what
// the runtime enforces, and verifying an email upgrades a guest in place or leaves it alone.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, OAuth, Security};

$tag = bin2hex(random_bytes(4));
add_role('zero_guest', 'Guest', ['read' => true]);
$guest = wp_insert_user(['user_login' => 'zg_' . $tag, 'user_pass' => Security::token(), 'role' => 'zero_guest']);
Plugin::$db->insert('applications', ['id' => 'app_guests_' . $tag, 'name' => 'Guests', 'redirects' => '[]', 'origins' => '[]']);
$oauth = new OAuth(Plugin::$db, Plugin::$accounts);
try {
    Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag);
    throw new RuntimeException('FAIL issueForUser ran without the runtime');
} catch (LogicException) {
    echo "PASS issueForUser refuses callers before zero_runtime_loaded\n";
}
do_action('zero_runtime_loaded');
$tokens = Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag);
check($oauth->userinfo($tokens['access_token'])['sub'] === (string) $guest, 'issueForUser mints a working access token for the user');
check($oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $tokens['refresh_token']])['token_type'] === 'Bearer', 'and a refresh token that rotates');
check(Plugin::$accounts->status($guest) === 'active' && Plugin::$accounts->status(PHP_INT_MAX) === 'none', 'status() reports active and none');
Plugin::$accounts->suspend($guest, true);
check(Plugin::$accounts->status($guest) === 'suspended', 'status() reports suspension');
Plugin::$accounts->suspend($guest, false);

$upgraded = [];
add_action('zero_identity_guest_upgraded', static function (int $id) use (&$upgraded): void { $upgraded[] = $id; });
$email = 'guest-' . $tag . '@example.test';
check(Plugin::$accounts->verifiedSignIn($email, $guest) === $guest, 'a verified email signs the guest into its own account');
clean_user_cache($guest);
check(get_userdata($guest)->roles === ['subscriber'] && Plugin::$accounts->owner($email) === $guest && get_userdata($guest)->user_email === $email, 'the guest is now a subscriber owning that email, same user id');
check($upgraded === [$guest], 'zero_identity_guest_upgraded fired once with the id');

$second = wp_insert_user(['user_login' => 'zg2_' . $tag, 'user_pass' => Security::token(), 'role' => 'zero_guest']);
$owner = Plugin::$accounts->verifiedSignIn($email, $second);
clean_user_cache($second);
check($owner === $guest && get_userdata($second)->roles === ['zero_guest'], 'an email that belongs to someone signs into that account and leaves the guest as is');
$member = Plugin::$accounts->emailLogin('member-' . $tag . '@example.test');
$other = 'other-' . $tag . '@example.test';
check(Plugin::$accounts->verifiedSignIn($other, $member) !== $member, 'a non-guest session never absorbs a newly verified email');

$handoffGuest = wp_insert_user(['user_login' => 'zg3_' . $tag, 'user_pass' => Security::token(), 'role' => 'zero_guest']);
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
$fixed = wp_insert_user(['user_login' => 'zg4_' . $tag, 'user_pass' => Security::token(), 'role' => 'zero_guest']);
$attacker = Plugin::$accounts->issueForUser($fixed, 'app_guests_' . $tag);
check(Plugin::$accounts->verifiedSignIn('victim-' . $tag . '@example.test', $fixed) === $fixed, 'the victim browser upgrades the guest it was handed');
rejects(fn () => $oauth->userinfo($attacker['access_token']), 'invalid_token', 'the upgrade ends every earlier guest access token');
rejects(fn () => $oauth->token(['grant_type' => 'refresh_token', 'client_id' => 'app_guests_' . $tag, 'refresh_token' => $attacker['refresh_token']]), 'invalid_grant', 'and every earlier guest refresh token');
rejects(fn () => $oauth->handoff(Plugin::$accounts->issueForUser($guest, 'app_guests_' . $tag)['access_token']), 'not_guest', 'only guests can hand off');
