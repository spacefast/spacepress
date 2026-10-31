<?php
// Two browsers upgrade the same guest at once (two connections, two workers). The upgrade that
// commits first wins; the other one, already past its role check, must not attach its email.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, Security};

$tag = bin2hex(random_bytes(4));
add_role('zero_guest', 'Guest', ['read' => true]);
$guest = wp_insert_user(['user_login' => 'zr_' . $tag, 'user_pass' => Security::token(), 'role' => 'zero_guest']);
Plugin::$accounts->ensure($guest);
$victim = Plugin::$sessions->create($guest)['session'];
$attacker = Plugin::$sessions->create($guest)['session'];
$db = Plugin::$db;
// Hold the guest's account lock, so the attacker's upgrade (past its role check) waits on it.
$db->run('START TRANSACTION');
$db->lock($guest);
$worker = worker('upgrade-worker.php', ['session' => $attacker, 'email' => "attacker-$tag@example.test"]);
$thread = (int) trim(fgets($worker[1][1]));
$deadline = microtime(true) + 10;
// A thread blocked on the guest's account row shows that statement in its own PROCESSLIST row.
while (!str_contains((string) ($db->row("SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread)['INFO'] ?? ''), $db->prefix . 'accounts')) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('FAIL the racing upgrade never waited on the account lock');
    }
}
echo "PASS the racing upgrade waits on the guest's account lock\n";
// The victim's upgrade commits first (it joins the transaction holding the lock).
check(Plugin::$accounts->verifiedSignIn("victim-$tag@example.test", $victim) === $guest, 'the first upgrade attaches its email');
$db->run('COMMIT');
[$output] = finish_worker($worker);
check($output === 'unauthenticated', "the racing upgrade is refused once it gets the lock ($output)");
check(Plugin::$accounts->owner("attacker-$tag@example.test") === 0 && Plugin::$accounts->owner("victim-$tag@example.test") === $guest, "only the winner's email belongs to the account");
