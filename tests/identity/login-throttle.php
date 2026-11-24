<?php
// Failed password attempts through WordPress's own sign-in (wp-login.php, XML-RPC unless turned off, any
// caller of wp_authenticate) are limited per address and per login, with the limits of Identity's own
// password sign-in. Sign-ins that succeed count nothing.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security};

$tag      = bin2hex( random_bytes( 5 ) );
$password = 'correct horse ' . $tag;
$login    = 'throttle-' . $tag;
$uid      = wp_insert_user(
	array(
		'user_login' => $login,
		'user_pass'  => $password,
		'user_email' => "$login@example.test",
		'role'       => 'editor',
	)
);
check( is_int( $uid ), 'a WordPress user to sign in as' );
$db     = Plugin::$db;
$limits = static fn (): int => (int) $db->row( "SELECT COUNT(*) AS n FROM {$db->prefix}limits" )['n'];
$clear  = static function () use ( $db ): void {
	$db->run( "DELETE FROM {$db->prefix}limits" );
};
$from   = static function ( string $address ): void {
	$_SERVER['REMOTE_ADDR'] = $address;
};
$code   = static fn ( mixed $result ): string => is_wp_error( $result ) ? (string) $result->get_error_code() : ( $result instanceof WP_User ? 'signed-in' : 'none' );
// Time is the limiter's own clock, set here, so nothing below depends on when the suite runs. The
// epoch is a multiple of the 300-second window: a limit that reset on the clock would reset at it.
$epoch = 2_000_000_100;
check( 0 === $epoch % 300, 'the test epoch is a multiple of the window' );
$at   = static function ( int $seconds ) use ( $epoch ): void {
	Security::$clock = static fn (): int => $epoch + $seconds;
};
$rows = static fn (): array => array_map( static fn ( array $r ): array => array( (int) $r['hits'], (int) $r['expires_at'] ), $db->rows( "SELECT hits, expires_at FROM {$db->prefix}limits ORDER BY id" ) );
$at( 100 );

// Ten wrong passwords for one login from one address are answered as core answers them; the next is
// refused before the password is checked, and so is the right password.
$clear();
$from( '203.0.113.10' );
$answers = array();
for ( $i = 0; $i < 10; $i++ ) {
	$answers[] = $code( wp_authenticate( $login, 'wrong ' . $i ) );
}
check( array_unique( $answers ) === array( 'incorrect_password' ), 'ten wrong passwords are core\'s own refusals' );
$eleventh = wp_authenticate( $login, 'wrong 11' );
check( $code( $eleventh ) === 'rate_limited' && $eleventh->get_error_message() === 'Too many attempts. Try again later.', 'the eleventh attempt is refused as rate limited' );
check( ( $eleventh->get_error_data()['status'] ?? null ) === 429, 'with status 429' );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'the right password is refused too while the limit holds' );

// The same login from another address: the per-login limit holds wherever the attempts come from.
$from( '203.0.113.11' );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'another address doesn\'t get around the per-login limit' );
check( $code( wp_authenticate( strtoupper( $login ), $password ) ) === 'rate_limited', 'nor does another letter case of the login' );

// One address trying many logins: the per-address limit holds across them.
$clear();
$from( '203.0.113.20' );
$answers = array();
for ( $i = 0; $i < 10; $i++ ) {
	$answers[] = $code( wp_authenticate( "nobody-$tag-$i", 'guess' ) );
}
check( array_unique( $answers ) === array( 'invalid_username' ), 'ten logins nobody has are core\'s own refusals' );
check( $code( wp_authenticate( "nobody-$tag-10", 'guess' ) ) === 'rate_limited', 'the eleventh login from that address is refused' );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'a real login from that address too' );
$from( '203.0.113.21' );
check( $code( wp_authenticate( $login, $password ) ) === 'signed-in', 'from another address the real login signs in' );

// A request with no password to check isn't an attempt: wp-login.php shown, a cookie checked, a
// sign-in with nothing typed.
$clear();
$from( '203.0.113.30' );
for ( $i = 0; $i < 15; $i++ ) {
	wp_authenticate( '', '' );
	wp_authenticate( $login, '' );
}
check( $limits() === 0, 'empty forms count nothing' );
check( $code( wp_authenticate( $login, $password ) ) === 'signed-in', 'and the login still signs in' );

// Sign-ins that succeed count nothing: an office behind one address, a person who signs in often.
$clear();
$signed = array();
for ( $i = 0; $i < 25; $i++ ) {
	$signed[] = $code( wp_authenticate( $login, $password ) );
}
check( array_unique( $signed ) === array( 'signed-in' ) && $limits() === 0, 'twenty-five sign-ins with the right password, none counted' );
// Nine wrong ones leave room; the tenth fills the counter, and then the right password waits too.
for ( $i = 0; $i < 9; $i++ ) {
	wp_authenticate( $login, 'wrong ' . $i );
}
check( $code( wp_authenticate( $login, $password ) ) === 'signed-in', 'after nine wrong passwords the right one signs in' );
wp_authenticate( $login, 'wrong 10' );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'after ten it waits' );

// Application passwords are not password attempts: they authenticate on another path, and an agent or
// a script makes many requests.
$clear();
$from( '203.0.113.40' );
[$secret]                 = WP_Application_Passwords::create_new_application_password( $uid, array( 'name' => 'throttle ' . $tag ) );
$_SERVER['PHP_AUTH_USER'] = $login;
$_SERVER['PHP_AUTH_PW']   = $secret;
add_filter( 'application_password_is_api_request', '__return_true' );
for ( $i = 0; $i < 15; $i++ ) {
	check( wp_validate_application_password( false ) === $uid, 'application password request ' . ( $i + 1 ) );
}
unset( $_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'] );
check( $limits() === 0, 'application password requests count nothing' );
// The same through wp_authenticate (how XML-RPC signs in): an application
// password that authenticates isn't counted, and a wrong one is a password attempt like any other.
$through = array();
for ( $i = 0; $i < 15; $i++ ) {
	$through[] = $code( wp_authenticate( $login, $secret ) );
}
check( array_unique( $through ) === array( 'signed-in' ) && $limits() === 0, 'fifteen application-password sign-ins through wp_authenticate count nothing' );
$wrong = array();
for ( $i = 0; $i < 11; $i++ ) {
	$wrong[] = $code( wp_authenticate( $login, 'abcd efgh ijkl mnop qrst uvw' . $i ) );
}
check( end( $wrong ) === 'rate_limited' && 'rate_limited' !== $wrong[0] && 'signed-in' !== $wrong[0], 'wrong ones are limited (' . $wrong[0] . ', then ' . end( $wrong ) . ')' );
// A refusal that isn't a wrong guess isn't counted: a limited attempt doesn't refill its own counter.
$clear();
$from( '203.0.113.41' );
for ( $i = 0; $i < 30; $i++ ) {
	wp_authenticate( $login, 'wrong' );
}
$hits = array_map( 'intval', array_column( $db->rows( "SELECT hits FROM {$db->prefix}limits" ), 'hits' ) );
check( $hits === array( 10, 10 ), 'thirty wrong passwords count ten, in each of the two counters (' . implode( ',', $hits ) . ')' );
remove_filter( 'application_password_is_api_request', '__return_true' );

// When Identity's storage can't count, sign-in is refused, as every other Identity gate is.
$clear();
$table    = $db->prefix . 'limits';
$suppress = $db->wp->suppress_errors( true );
check( $db->wp->query( "ALTER TABLE $table RENAME TO {$table}_unavailable" ) !== false, 'limits table made unreadable' );
try {
	$failed = wp_authenticate( $login, $password );
} finally {
	check( $db->wp->query( "ALTER TABLE {$table}_unavailable RENAME TO $table" ) !== false, 'limits table restored' );
	$db->wp->suppress_errors( $suppress );
}
check( $code( $failed ) === 'storage_unavailable', 'when the counters can\'t be read, no sign-in (' . $code( $failed ) . ')' );

// A window starts at the first failure, not on the clock. Ten failures one second before a multiple of
// the window, then an attempt two seconds later, on the other side of it, are one window.
$clear();
$from( '203.0.113.50' );
$at( 299 );
for ( $i = 0; $i < 10; $i++ ) {
	wp_authenticate( $login, 'wrong' );
}
check( $rows() === array( array( 10, $epoch + 599 ), array( 10, $epoch + 599 ) ), 'ten failures at 299 seconds: both counters full until 599' );
$at( 301 );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'at 301 seconds, across the multiple of the window, still limited' );
check( $code( wp_authenticate( $login, 'wrong' ) ) === 'rate_limited', 'a wrong password too' );
// Later failures in the window don't move its end: it began at the first one.
$clear();
$at( 299 );
wp_authenticate( $login, 'wrong' );
$at( 450 );
for ( $i = 0; $i < 9; $i++ ) {
	wp_authenticate( $login, 'wrong' );
}
check( $rows() === array( array( 10, $epoch + 599 ), array( 10, $epoch + 599 ) ), 'nine more failures at 450 seconds leave the end at 599' );
$at( 599 );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'limited through the last second of the window' );

// The window restarts once it has ended: the right password signs in, and the next failure is the
// first of a new window.
$at( 600 );
check( $code( wp_authenticate( $login, $password ) ) === 'signed-in', 'at 600 seconds the window is over' );
wp_authenticate( $login, 'wrong' );
check( $rows() === array( array( 1, $epoch + 900 ), array( 1, $epoch + 900 ) ), 'the next failure starts a window of its own, counted from one' );
for ( $i = 0; $i < 9; $i++ ) {
	wp_authenticate( $login, 'wrong' );
}
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'which fills like the first' );
$at( 900 );
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', 'and holds through its own last second' );
$at( 901 );
check( $code( wp_authenticate( $login, $password ) ) === 'signed-in', 'and ends' );
check( count( $rows() ) === 2, 'one row per counter, reused across windows' );

// The same for the limiter that counts every attempt and refuses (Identity's own endpoints use it).
$clear();
$limit = static function () use ( $tag ): string {
	try {
		Plugin::$security->limit( "probe-$tag", 3 );
		return 'ok';
	} catch ( \SpacePress\Identity\Failure $e ) {
		return $e->kind;
	}
};
$at( 299 );
check( array( $limit(), $limit(), $limit(), $limit() ) === array( 'ok', 'ok', 'ok', 'rate_limited' ), 'three attempts, then a refusal' );
$at( 301 );
check( $limit() === 'rate_limited', 'not reset by the clock passing a multiple of the window' );
$at( 599 );
check( $limit() === 'rate_limited', 'nor before the window that began at 299 ends' );
$at( 600 );
check( array( $limit(), $rows() ) === array( 'ok', array( array( 1, $epoch + 900 ) ) ), 'the first attempt after it starts the next window' );

// An attempt is judged by the count it wrote. Between its write and its read, another request can't
// restart the window and hand it the new window's count: the row is held until the count is read.
// Here a second connection tries exactly that, the moment the limiter reads.
$clear();
$at( 299 );
check( array( $limit(), $limit(), $limit() ) === array( 'ok', 'ok', 'ok' ), 'a bucket at its limit, in the last second of nothing in particular' );
$other = new wpdb( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
$other->suppress_errors( true );
$table   = $db->prefix . 'limits';
$id      = Security::hash( "probe-$tag" );
$held    = null;
$intrude = static function ( string $query ) use ( $other, $table, $id, $epoch, &$held ): string {
	if ( null === $held && str_starts_with( $query, "SELECT hits FROM $table WHERE id=" ) && ! str_contains( $query, 'expires_at' ) ) {
		// NOWAIT: answers at once, with an error when another connection holds the row.
		$other->query( $other->prepare( "SELECT id FROM $table WHERE id=%s FOR UPDATE NOWAIT", $id ) );
		$held = '' !== $other->last_error;
		if ( ! $held ) {
			// The row is free: do what a request a second later would, and restart the window.
			$other->query( $other->prepare( "UPDATE $table SET hits=1, expires_at=%d WHERE id=%s", $epoch + 900, $id ) );
		}
	}
	return $query;
};
add_filter( 'query', $intrude );
$fourth = $limit();
remove_filter( 'query', $intrude );
$other->close();
check( true === $held, 'the limiter holds the row from its write to its read' );
check( 'rate_limited' === $fourth, 'so the fourth attempt is refused, whatever arrives meanwhile' );
check( $rows() === array( array( 4, $epoch + 599 ) ), 'and stays counted in its own window' );
$at( 100 );

// Identity's own password sign-in keeps its own two counters: filling WordPress's doesn't close it,
// and it doesn't go through WordPress's filter, so it isn't counted twice.
$clear();
$from( '203.0.113.60' );
for ( $i = 0; $i < 11; $i++ ) {
	wp_authenticate( $login, 'wrong' );
}
check( $code( wp_authenticate( $login, $password ) ) === 'rate_limited', "WordPress's sign-in is limited" );
$before = $limits();
ob_start(); // sign-in sets cookies as a browser response would
$request = new WP_REST_Request( 'POST' );
$request->set_url_params( array( 'operation' => 'sign-in/password' ) );
$request->set_header( 'Origin', untrailingslashit( home_url() ) );
$request->set_body_params(
	array(
		'login'    => $login,
		'password' => $password,
	)
);
$own = Plugin::$api->dispatch( $request );
ob_end_clean();
check( $own->get_status() === 200 && ( $own->get_data()['error'] ?? null ) === null, "Identity's own sign-in still answers (" . $own->get_status() . ')' );
check( $limits() === $before + 2, 'and counts its own two counters, once' );
check( $db->rows( "SELECT hits FROM {$db->prefix}limits WHERE hits > 10" ) === array(), 'nothing WordPress counted went past its limit' );

$clear();
Security::$clock = null;
require_once ABSPATH . 'wp-admin/includes/user.php';
wp_delete_user( $uid );
echo "PASS failed WordPress password sign-ins are limited per address and per login, like Identity's own\n";
