<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use TypedPress\Identity\{Plugin,Failure};
$input=json_decode(stream_get_contents(STDIN),true);echo "READY\n";flush();
try{Plugin::$db->credentialMutation($input['session'],function()use($input){if($input['effect']==='email'){Plugin::$accounts->claim((int)$input['session']['wp_user_id'],$input['value'],'email_code');}else{wp_set_password($input['value'],(int)$input['session']['wp_user_id']);}});echo "MUTATED\n";}catch(Failure $e){echo $e->kind."\n";}
