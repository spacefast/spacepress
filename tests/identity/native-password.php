<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use Zero\Identity\{Plugin,Security,Mfa};
$tag=bin2hex(random_bytes(5));$uid=Plugin::$accounts->emailLogin('native-'.$tag.'@example.test');$alias='alias-'.$tag.'@example.test';Plugin::$db->transaction(fn()=>Plugin::$accounts->claim($uid,$alias,'email_code'));$password=Security::token();wp_set_password($password,$uid);$user=new WP_User($uid);$user->set_role('editor');
$authenticated=wp_authenticate(strtoupper($alias),$password);if(!$authenticated instanceof WP_User||$authenticated->ID!==$uid||$authenticated->roles!==['editor']){throw new RuntimeException('Native secondary-email password did not preserve account/roles');}
$mfa=new Mfa(Plugin::$db,Plugin::$security);$setup=$mfa->setup($uid,'Native test');$otp=\Zero\Identity\Vendor\OTPHP\TOTP::createFromSecret($setup['secret']);$mfa->verify($uid,$otp->now(),true);$blocked=wp_authenticate($alias,$password);if(!is_wp_error($blocked)||$blocked->get_error_code()!=='identity_mfa_required'){throw new RuntimeException('Native secondary-email login bypassed MFA');}
echo "PASS native WordPress password sign-in accepts any verified email, preserves account/roles and enforces MFA\n";

require __DIR__.'/native-auth-storage.php';

// Real process death rolls back only the interrupted page; concurrent workers share a row lock.
$inventory = 'zero_identity_password_inventory';
update_option($inventory, ['after' => 0, 'complete' => false], false);
$worker = worker('password-inventory-worker.php', ['crash' => true]);
fgets($worker[1][1]);
[$out, $err, $code] = finish_worker($worker);
wp_cache_delete($inventory, 'options');
check($code === 9 && $err === '' && get_option($inventory) === ['after' => 0, 'complete' => false], 'process death leaves the inventory cursor uncommitted');
$db = Plugin::$db;
$db->run('START TRANSACTION');
$db->row("SELECT option_value FROM {$db->wp->options} WHERE option_name=%s FOR UPDATE", $inventory);
$worker = worker('password-inventory-worker.php', []);
$thread = (int) trim(fgets($worker[1][1]));
$deadline = microtime(true) + 10;
while (!str_contains((string) ($db->row("SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=%d AND COMMAND='Query'", $thread)['INFO'] ?? ''), $db->wp->options)) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('Inventory worker never waited on the progress row lock');
    }
}
echo "PASS concurrent inventory worker waits on the progress row lock\n";
do_action('zero_identity_password_inventory');
$committed = get_option($inventory);
$db->run('COMMIT');
[$out, $err, $code] = finish_worker($worker);
wp_cache_delete($inventory, 'options');
check($code === 0 && $err === '' && $out === 'completed' && get_option($inventory)['after'] >= $committed['after'], 'waiting worker resumes from the committed page after a process crash');
