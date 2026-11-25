<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
ob_start(); // sign-in sets cookies as a browser response would
use SpacePress\Identity\{Plugin,Security,Mfa};
$db=Plugin::$db;$email='mfa-entry-'.bin2hex(random_bytes(6)).'@example.test';$uid=Plugin::$accounts->emailLogin($email);$password=Security::token();wp_set_password($password,$uid);
$mfa=new Mfa($db,Plugin::$security);$setup=$mfa->setup($uid,'Entrypoints');$otp=\SpacePress\Identity\Vendor\OTPHP\TOTP::createFromSecret($setup['secret']);if(!$mfa->verify($uid,$otp->now(),true)){throw new RuntimeException('MFA setup failed');}
function call(string $op,array $body):array{$r=new WP_REST_Request('POST');$r->set_url_params(['operation'=>$op]);$r->set_header('Origin',untrailingslashit(home_url()));$r->set_body_params($body);return Plugin::$api->dispatch($r)->get_data();}
$challenge=Plugin::$security->challenge('login',0,'',['email'=>$email],'123456');
foreach([call('sign-in/password',['login'=>$email,'password'=>$password]),call('sign-in/verify',['challenge_id'=>$challenge,'code'=>'123456']),['data'=>Plugin::$api->providerLogin($uid)]] as $result){if(($result['data']['kind']??null)!=='mfa_required'){throw new RuntimeException('Primary factor bypassed MFA: '.json_encode($result));}}
if($db->row("SELECT id FROM {$db->prefix}sessions WHERE wp_user_id=%d",$uid)){throw new RuntimeException('Primary factor created session before MFA');}
$user=wp_authenticate($email,$password);if(!is_wp_error($user)||$user->get_error_code()!=='identity_mfa_required'){throw new RuntimeException('Native WordPress password bypassed MFA');}
echo "PASS password, email and external-provider primary factors require MFA before session issuance; WordPress native password cannot bypass it\n";

// A pending second factor doesn't outlive a password reset made before it completes.
$pending = call('sign-in/password', ['login' => $email, 'password' => $password]);
check(($pending['data']['kind'] ?? null) === 'mfa_required', 'a password sign-in waits for the second factor');
$cid = $pending['data']['challenge_id'];
$binding = Security::token();
$db->run("UPDATE {$db->prefix}challenges SET secret_hash=%s WHERE id=%s", Security::hash($binding), $cid);
wp_set_password(Security::token(), $uid); // reset in between
$_COOKIE['zi_factor'] = $binding;
$codes = $mfa->recoveryCodes($uid);
$done = call('sign-in/mfa', ['challenge_id' => $cid, 'code' => $codes[0]]);
check(($done['error']['code'] ?? null) === 'invalid_challenge' && !$db->row("SELECT id FROM {$db->prefix}sessions WHERE wp_user_id=%d AND revoked_at IS NULL", $uid), 'a reset expires the pending factor: no session is created');
