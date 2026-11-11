<?php
// Enroll TOTP for the user whose email is on stdin; prints one recovery code (flow.test.ts).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use First\Identity\{Plugin, Mfa};

ob_start();
$uid = Plugin::$accounts->owner(trim(stream_get_contents(STDIN)));
$mfa = new Mfa(Plugin::$db, Plugin::$security);
$setup = $mfa->setup($uid, 'Flow');
$mfa->verify($uid, \First\Identity\Vendor\OTPHP\TOTP::createFromSecret($setup['secret'])->now(), true);
$codes = $mfa->recoveryCodes($uid);
ob_end_clean();
echo $codes[0];
