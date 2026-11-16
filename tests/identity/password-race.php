<?php
// A sign-in that verified the old password, then waited on the account lock while a reset
// committed, must not leave a live session behind (two connections).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use TypedPress\Identity\{Plugin, Security};

$tag = bin2hex(random_bytes(4));
$email = "race-pw-$tag@example.test";
$uid = Plugin::$accounts->emailLogin($email);
wp_set_password('old-password-123', $uid);
$db = Plugin::$db;
$db->run('START TRANSACTION');
$db->lock($uid); // the reset holds the account while it changes the password
$worker = worker('password-worker.php', ['login' => $email, 'password' => 'old-password-123']);
$thread = (int) trim(fgets($worker[1][1]));
$deadline = microtime(true) + 10;
while (!str_contains((string) ($db->row("SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread)['INFO'] ?? ''), $db->prefix . 'accounts')) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('FAIL the sign-in never waited on the account lock');
    }
}
wp_set_password('new-password-456', $uid);
$db->run('COMMIT');
[$output] = finish_worker($worker);
check($output === 'invalid_credentials', "the waiting sign-in rechecks the password under the lock ($output)");
check(!$db->row("SELECT id FROM {$db->prefix}sessions WHERE wp_user_id=%d AND revoked_at IS NULL", $uid), 'no session survives the reset');
