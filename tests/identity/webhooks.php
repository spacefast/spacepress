<?php
// Real HTTP webhook delivery: First-Signature/First-Event-Id, failure persisted with backoff, retry delivered.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use First\Identity\{Plugin, Security, Maintenance};

$db = Plugin::$db;
$saved = get_option('first_identity_webhooks', []);
$id = 'test-' . bin2hex(random_bytes(6));
try {
    update_option('first_identity_webhooks', [['id' => $id, 'url' => 'http://webhook:8080/receive', 'secret' => Security::seal('disposable-webhook-contract-secret')]], false);
    Plugin::$security->event(0, 'test.delivery');
    $worker = new Maintenance($db, Plugin::$security);
    $worker->run();
    $row = $db->row("SELECT * FROM {$db->prefix}deliveries WHERE endpoint_id=%s", $id);
    check((int) $row['attempts'] === 1 && (int) $row['last_status'] === 503 && $row['delivered_at'] === null && (int) $row['next_at'] > time(), 'a signed delivery the receiver accepted as authentic but failed is scheduled for retry');
    $worker->run();
    check((int) $db->row("SELECT attempts FROM {$db->prefix}deliveries WHERE id=%d", $row['id'])['attempts'] === 1, 'backoff holds the retry');
    $db->run("UPDATE {$db->prefix}deliveries SET next_at=%d WHERE id=%d", time() - 1, $row['id']);
    $worker->run();
    $row = $db->row("SELECT * FROM {$db->prefix}deliveries WHERE id=%d", $row['id']);
    check((int) $row['attempts'] === 2 && (int) $row['last_status'] === 204 && $row['delivered_at'], 'the due retry is delivered and marked');
} finally {
    update_option('first_identity_webhooks', $saved, false);
}
