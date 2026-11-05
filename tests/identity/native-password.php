<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use Zero\Identity\{Plugin,Security,Mfa};
$tag=bin2hex(random_bytes(5));$uid=Plugin::$accounts->emailLogin('native-'.$tag.'@example.test');$alias='alias-'.$tag.'@example.test';Plugin::$db->transaction(fn()=>Plugin::$accounts->claim($uid,$alias,'email_code'));$password=Security::token();wp_set_password($password,$uid);$user=new WP_User($uid);$user->set_role('editor');
$authenticated=wp_authenticate(strtoupper($alias),$password);if(!$authenticated instanceof WP_User||$authenticated->ID!==$uid||$authenticated->roles!==['editor']){throw new RuntimeException('Native secondary-email password did not preserve account/roles');}
$mfa=new Mfa(Plugin::$db,Plugin::$security);$setup=$mfa->setup($uid,'Native test');$otp=\Zero\Identity\Vendor\OTPHP\TOTP::createFromSecret($setup['secret']);$mfa->verify($uid,$otp->now(),true);$blocked=wp_authenticate($alias,$password);if(!is_wp_error($blocked)||$blocked->get_error_code()!=='identity_mfa_required'){throw new RuntimeException('Native secondary-email login bypassed MFA');}
echo "PASS native WordPress password sign-in accepts any verified email, preserves account/roles and enforces MFA\n";

require __DIR__.'/native-auth-storage.php';
