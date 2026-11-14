<?php
// Failed password attempts through WordPress's own sign-in (wp-login.php, XML-RPC where it is on, any
// caller of wp_authenticate) are limited per address and per login, with the limits of Identity's own
// password sign-in. Sign-ins that succeed count nothing.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use First\Identity\{Plugin, Security};

$tag = bin2hex(random_bytes(5));
$password = 'correct horse ' . $tag;
$login = 'throttle-' . $tag;
$uid = wp_insert_user(['user_login' => $login, 'user_pass' => $password, 'user_email' => "$login@example.test", 'role' => 'editor']);
check(is_int($uid), 'a WordPress user to sign in as');
$db = Plugin::$db;
$limits = static fn (): int => (int) $db->row("SELECT COUNT(*) AS n FROM {$db->prefix}limits")['n'];
$clear = static function () use ($db): void { $db->run("DELETE FROM {$db->prefix}limits"); };
$from = static function (string $address): void { $_SERVER['REMOTE_ADDR'] = $address; };
$code = static fn (mixed $result): string => is_wp_error($result) ? (string) $result->get_error_code() : ($result instanceof WP_User ? 'signed-in' : 'none');

// Ten wrong passwords for one login from one address are answered as core answers them; the next is
// refused before the password is checked, and so is the right password.
$clear();
$from('203.0.113.10');
$answers = [];
for ($i = 0; $i < 10; $i++) {
    $answers[] = $code(wp_authenticate($login, 'wrong ' . $i));
}
check(array_unique($answers) === ['incorrect_password'], 'ten wrong passwords are core\'s own refusals');
$eleventh = wp_authenticate($login, 'wrong 11');
check($code($eleventh) === 'rate_limited' && $eleventh->get_error_message() === 'Too many attempts. Try again later.', 'the eleventh attempt is refused as rate limited');
check(($eleventh->get_error_data()['status'] ?? null) === 429, 'with status 429');
check($code(wp_authenticate($login, $password)) === 'rate_limited', 'the right password is refused too while the limit holds');

// The same login from another address: the per-login limit holds wherever the attempts come from.
$from('203.0.113.11');
check($code(wp_authenticate($login, $password)) === 'rate_limited', 'another address doesn\'t get around the per-login limit');
check($code(wp_authenticate(strtoupper($login), $password)) === 'rate_limited', 'nor does another letter case of the login');

// One address trying many logins: the per-address limit holds across them.
$clear();
$from('203.0.113.20');
$answers = [];
for ($i = 0; $i < 10; $i++) {
    $answers[] = $code(wp_authenticate("nobody-$tag-$i", 'guess'));
}
check(array_unique($answers) === ['invalid_username'], 'ten logins nobody has are core\'s own refusals');
check($code(wp_authenticate("nobody-$tag-10", 'guess')) === 'rate_limited', 'the eleventh login from that address is refused');
check($code(wp_authenticate($login, $password)) === 'rate_limited', 'a real login from that address too');
$from('203.0.113.21');
check($code(wp_authenticate($login, $password)) === 'signed-in', 'from another address the real login signs in');

// A request with no password to check isn't an attempt: wp-login.php shown, a cookie checked, a
// sign-in with nothing typed.
$clear();
$from('203.0.113.30');
for ($i = 0; $i < 15; $i++) {
    wp_authenticate('', '');
    wp_authenticate($login, '');
}
check($limits() === 0, 'empty forms count nothing');
check($code(wp_authenticate($login, $password)) === 'signed-in', 'and the login still signs in');

// Sign-ins that succeed count nothing: an office behind one address, a person who signs in often.
$clear();
$signed = [];
for ($i = 0; $i < 25; $i++) {
    $signed[] = $code(wp_authenticate($login, $password));
}
check(array_unique($signed) === ['signed-in'] && $limits() === 0, 'twenty-five sign-ins with the right password, none counted');
// Nine wrong ones leave room; the tenth fills the counter, and then the right password waits too.
for ($i = 0; $i < 9; $i++) {
    wp_authenticate($login, 'wrong ' . $i);
}
check($code(wp_authenticate($login, $password)) === 'signed-in', 'after nine wrong passwords the right one signs in');
wp_authenticate($login, 'wrong 10');
check($code(wp_authenticate($login, $password)) === 'rate_limited', 'after ten it waits');

// Application passwords are not password attempts: they authenticate on another path, and an agent or
// a script makes many requests.
$clear();
$from('203.0.113.40');
[$secret] = WP_Application_Passwords::create_new_application_password($uid, ['name' => 'throttle ' . $tag]);
$_SERVER['PHP_AUTH_USER'] = $login;
$_SERVER['PHP_AUTH_PW'] = $secret;
add_filter('application_password_is_api_request', '__return_true');
for ($i = 0; $i < 15; $i++) {
    check(wp_validate_application_password(false) === $uid, 'application password request ' . ($i + 1));
}
unset($_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW']);
check($limits() === 0, 'application password requests count nothing');
// The same through wp_authenticate (how XML-RPC signs in, where a site turns it on): an application
// password that authenticates isn't counted, and a wrong one is a password attempt like any other.
$through = [];
for ($i = 0; $i < 15; $i++) {
    $through[] = $code(wp_authenticate($login, $secret));
}
check(array_unique($through) === ['signed-in'] && $limits() === 0, 'fifteen application-password sign-ins through wp_authenticate count nothing');
$wrong = [];
for ($i = 0; $i < 11; $i++) {
    $wrong[] = $code(wp_authenticate($login, 'abcd efgh ijkl mnop qrst uvw' . $i));
}
check(end($wrong) === 'rate_limited' && $wrong[0] !== 'rate_limited' && $wrong[0] !== 'signed-in', 'wrong ones are limited (' . $wrong[0] . ', then ' . end($wrong) . ')');
// A refusal that isn't a wrong guess isn't counted: a limited attempt doesn't refill its own counter.
$clear();
$from('203.0.113.41');
for ($i = 0; $i < 30; $i++) {
    wp_authenticate($login, 'wrong');
}
$hits = array_map('intval', array_column($db->rows("SELECT hits FROM {$db->prefix}limits"), 'hits'));
check($hits === [10, 10], 'thirty wrong passwords count ten, in each of the two counters (' . implode(',', $hits) . ')');
remove_filter('application_password_is_api_request', '__return_true');

// When Identity's storage can't count, sign-in is refused, as every other Identity gate is.
$clear();
$table = $db->prefix . 'limits';
$suppress = $db->wp->suppress_errors(true);
check($db->wp->query("ALTER TABLE $table RENAME TO {$table}_unavailable") !== false, 'limits table made unreadable');
try {
    $failed = wp_authenticate($login, $password);
} finally {
    check($db->wp->query("ALTER TABLE {$table}_unavailable RENAME TO $table") !== false, 'limits table restored');
    $db->wp->suppress_errors($suppress);
}
check($code($failed) === 'storage_unavailable', 'when the counters can\'t be read, no sign-in (' . $code($failed) . ')');

// The limit is by window: a new window starts fresh.
$clear();
$from('203.0.113.50');
for ($i = 0; $i < 11; $i++) {
    wp_authenticate($login, 'wrong');
}
check($code(wp_authenticate($login, $password)) === 'rate_limited', 'limited in this window');
$db->run("DELETE FROM {$db->prefix}limits WHERE id IN (%s,%s)", Security::hash('wp-password:203.0.113.50:' . intdiv(time(), 300)), Security::hash('wp-password-account:' . $login . ':' . intdiv(time(), 300)));
check($code(wp_authenticate($login, $password)) === 'signed-in', 'and not once those two counters are gone');

// Identity's own password sign-in keeps its own two counters: filling WordPress's doesn't close it,
// and it doesn't go through WordPress's filter, so it isn't counted twice.
$clear();
$from('203.0.113.60');
for ($i = 0; $i < 11; $i++) {
    wp_authenticate($login, 'wrong');
}
check($code(wp_authenticate($login, $password)) === 'rate_limited', "WordPress's sign-in is limited");
$before = $limits();
ob_start(); // sign-in sets cookies as a browser response would
$request = new WP_REST_Request('POST');
$request->set_url_params(['operation' => 'sign-in/password']);
$request->set_header('Origin', untrailingslashit(home_url()));
$request->set_body_params(['login' => $login, 'password' => $password]);
$own = Plugin::$api->dispatch($request);
ob_end_clean();
check($own->get_status() === 200 && ($own->get_data()['error'] ?? null) === null, "Identity's own sign-in still answers (" . $own->get_status() . ')');
check($limits() === $before + 2, 'and counts its own two counters, once');
check($db->rows("SELECT hits FROM {$db->prefix}limits WHERE hits > 10") === [], 'nothing WordPress counted went past its limit');

$clear();
require_once ABSPATH . 'wp-admin/includes/user.php';
wp_delete_user($uid);
echo "PASS failed WordPress password sign-ins are limited per address and per login, like Identity's own\n";
