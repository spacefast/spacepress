<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use SpacePress\Identity\Plugin;
$db=Plugin::$db;$tag=bin2hex(random_bytes(6));
$a=Plugin::$accounts->emailLogin('owner-a-'.$tag.'@example.test');$b=Plugin::$accounts->emailLogin('owner-b-'.$tag.'@example.test');$email='contended-'.$tag.'@example.test';
$db->transaction(function()use($a,$b,$email,&$process,&$pipes){
    Plugin::$accounts->claim($a,$email,'email_code');
    $process=proc_open(['php',__DIR__.'/email-race-worker.php'],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
    fwrite($pipes[0],json_encode(['uid'=>$b,'email'=>strtoupper($email)])."\n");fclose($pipes[0]);
    if(trim(fgets($pipes[1]))!=='READY'){throw new RuntimeException('Concurrent claimant did not start');}
});
$output=trim(stream_get_contents($pipes[1]));$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
if(proc_close($process)!==0||!in_array($output,['ownership_conflict','email_in_use','link_required'],true)){throw new RuntimeException('Concurrent claim accepted: '.$output.$errors);}
if(Plugin::$accounts->owner($email)!==$a||count($db->rows("SELECT id FROM {$db->prefix}emails WHERE normalized=%s",$email))!==1){throw new RuntimeException('Unique ownership violated');}
foreach([$a,$b] as $uid){$profile=Plugin::$accounts->profile($uid);if(count(array_filter($profile['emails'],fn($e)=>$e['primary']))!==1){throw new RuntimeException('Primary invariant violated');}}
echo "PASS concurrent normalized email claims preserve exactly one owner and each account primary\n";
