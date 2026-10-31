<?php
// A guest with Bearer tokens for app_identity_flow, as the Zero runtime would mint (flow.test.ts).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, Security};

ob_start();
add_role('zero_guest', 'Guest', ['read' => true]);
$guest = wp_insert_user(['user_login' => 'zf_' . bin2hex(random_bytes(4)), 'user_pass' => Security::token(), 'role' => 'zero_guest']);
do_action('zero_runtime_loaded');
$tokens = Plugin::$accounts->issueForUser($guest, 'app_identity_flow');
ob_end_clean();
echo json_encode($tokens + ['uid' => $guest]);
