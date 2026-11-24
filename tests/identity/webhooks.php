<?php
// Real HTTP webhook delivery: SpacePress-Signature/SpacePress-Event-Id, failure persisted with backoff, retry delivered.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Security, Maintenance};

$db    = Plugin::$db;
$saved = get_option( 'sp_identity_webhooks', array() );
$id    = 'test-' . bin2hex( random_bytes( 6 ) );
try {
	update_option(
		'sp_identity_webhooks',
		array(
			array(
				'id'     => $id,
				'url'    => 'http://webhook:8080/receive',
				'secret' => Security::seal( 'disposable-webhook-contract-secret' ),
			),
		),
		false
	);
	Plugin::$security->event( 0, 'test.delivery' );
	$worker = new Maintenance( $db, Plugin::$security );
	$worker->run();
	$row = $db->row( "SELECT * FROM {$db->prefix}deliveries WHERE endpoint_id=%s", $id );
	check( 1 === (int) $row['attempts'] && 503 === (int) $row['last_status'] && null === $row['delivered_at'] && (int) $row['next_at'] > time(), 'a signed delivery the receiver accepted as authentic but failed is scheduled for retry' );
	$worker->run();
	check( 1 === (int) $db->row( "SELECT attempts FROM {$db->prefix}deliveries WHERE id=%d", $row['id'] )['attempts'], 'backoff holds the retry' );
	$db->run( "UPDATE {$db->prefix}deliveries SET next_at=%d WHERE id=%d", time() - 1, $row['id'] );
	$worker->run();
	$row = $db->row( "SELECT * FROM {$db->prefix}deliveries WHERE id=%d", $row['id'] );
	check( 2 === (int) $row['attempts'] && 204 === (int) $row['last_status'] && $row['delivered_at'], 'the due retry is delivered and marked' );
} finally {
	update_option( 'sp_identity_webhooks', $saved, false );
}
