<?php
// A second-factor completion whose challenge is consumed, then waits on the account lock while a
// password reset commits, must not create a session (two connections).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security, Mfa};

ob_start();
$tag   = bin2hex( random_bytes( 4 ) );
$email = "race-mfa-$tag@example.test";
$uid   = Plugin::$accounts->emailLogin( $email );
$db    = Plugin::$db;
$mfa   = new Mfa( $db, Plugin::$security );
$setup = $mfa->setup( $uid, 'Race' );
$mfa->verify( $uid, \SpacePress\Identity\Vendor\OTPHP\TOTP::createFromSecret( $setup['secret'] )->now(), true );
$recovery  = $mfa->recoveryCodes( $uid )[0];
$binding   = Security::token();
$challenge = Plugin::$security->challenge( 'mfa', $uid, '', array(), $binding );
// The worker runs from the CLI (no REMOTE_ADDR): start its rate-limit bucket empty, so earlier
// runs can't stop it before it reaches the lock.
$db->run( "DELETE FROM {$db->prefix}limits WHERE id=%s", Security::hash( 'mfa:' ) );
$db->run( 'START TRANSACTION' );
$db->lock( $uid ); // the reset holds the account
$worker   = worker(
	'mfa-worker.php',
	array(
		'challenge' => $challenge,
		'binding'   => $binding,
		'code'      => $recovery,
	)
);
$thread   = (int) trim( fgets( $worker[1][1] ) );
$deadline = microtime( true ) + 10;
while ( ! str_contains( (string) ( $db->row( "SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread )['INFO'] ?? '' ), $db->prefix . 'accounts' ) ) {
	if ( microtime( true ) > $deadline ) {
		throw new RuntimeException( 'FAIL the completion never waited on the account lock' );
	}
}
check( null !== $db->row( "SELECT consumed_at FROM {$db->prefix}challenges WHERE id=%s", $challenge )['consumed_at'], 'the waiting completion already consumed its challenge' );
wp_set_password( 'reset-' . $tag, $uid ); // revokes sessions and expires factors, inside the lock holder's transaction
$db->run( 'COMMIT' );
[$output] = finish_worker( $worker );
check( 'invalid_challenge' === $output, "the completion fails once it gets the lock ($output)" );
check( ! $db->row( "SELECT id FROM {$db->prefix}sessions WHERE wp_user_id=%d AND revoked_at IS NULL", $uid ), 'no session survives the reset' );
