<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security};
$db  = Plugin::$db;
$uid = Plugin::$accounts->emailLogin( 'race-' . bin2hex( random_bytes( 5 ) ) . '@example.test' );
foreach ( array( 'email', 'password' ) as $effect ) {
	$session = Plugin::$sessions->create( $uid )['session'];
	$value   = 'email' === $effect ? 'claim-' . bin2hex( random_bytes( 5 ) ) . '@example.test' : Security::token();
	$old     = get_userdata( $uid )->user_pass;
	$db->transaction(
		function () use ( $db, $uid, $session, $effect, $value, &$process, &$pipes ) {
			$db->lock( $uid );
			$db->run( "UPDATE {$db->prefix}sessions SET revoked_at=%d WHERE id=%s", time(), $session['id'] );
			$process = proc_open( array( 'php', __DIR__ . '/credential-worker.php' ), array( array( 'pipe', 'r' ), array( 'pipe', 'w' ), array( 'pipe', 'w' ) ), $pipes );
			fwrite(
				$pipes[0],
				json_encode(
					array(
						'session' => $session,
						'effect'  => $effect,
						'value'   => $value,
					)
				)
			);
			fclose( $pipes[0] );
			if ( trim( fgets( $pipes[1] ) ) !== 'READY' ) {
				throw new RuntimeException( 'Worker not ready' );}
		}
	);
	$output = stream_get_contents( $pipes[1] );
	$err    = stream_get_contents( $pipes[2] );
	fclose( $pipes[1] );
	fclose( $pipes[2] );
	if ( proc_close( $process ) !== 0 || trim( $output ) !== 'reverification_required' ) {
		throw new RuntimeException( 'Revocation race failed: ' . $output . $err );}
	clean_user_cache( $uid );
	if ( 'email' === $effect ? Plugin::$accounts->owner( $value ) !== 0 : get_userdata( $uid )->user_pass !== $old ) {
		throw new RuntimeException( 'Revoked credential mutation committed' );
	}echo 'PASS account/session mutation boundary rejects revoked concurrent ' . $effect . " write\n";
}
$db->transaction(
	function () use ( $db, $uid ) {
		$db->lock( $uid );
		try {
			$db->transaction(
				function () use ( $db, $uid ) {
					$db->run( "UPDATE {$db->prefix}accounts SET status='suspended' WHERE wp_user_id=%d", $uid );
					throw new RuntimeException( 'rollback nested' );
				}
			);
		} catch ( RuntimeException $e ) {
		}$a = $db->row( "SELECT status FROM {$db->prefix}accounts WHERE wp_user_id=%d", $uid );
		if ( 'active' !== $a['status'] ) {
			throw new RuntimeException( 'Savepoint rollback failed' );
		}}
);
echo "PASS nested transaction savepoint preserves outer ownership\n";
