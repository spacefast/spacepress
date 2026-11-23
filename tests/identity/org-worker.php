<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Organizations, Failure};

$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
$db = Plugin::$db;
echo $GLOBALS['wpdb']->get_var('SELECT CONNECTION_ID()'), "\n";
fflush(STDOUT);
$r = new WP_REST_Request('POST');
$r->set_body_params(['organization_id' => $input['org'], 'user_id' => (string) $input['target'], 'role' => 'member']);
try {
    // As Api::sensitive runs it: one transaction whose membership check (a plain read) comes first.
    $db->transaction(fn () => (new Organizations($db, Plugin::$security, Plugin::$accounts))->handle('organizations/role', 'POST', $r, $input['actor']));
    echo "updated\n";
} catch (Failure $e) {
    echo $e->kind . "\n";
}
