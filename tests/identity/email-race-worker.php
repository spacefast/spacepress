<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use TypedPress\Identity\{Plugin,Failure};
$input=json_decode(fgets(STDIN),true,16,JSON_THROW_ON_ERROR);
echo "READY\n";fflush(STDOUT);
try { Plugin::$db->transaction(fn()=>Plugin::$accounts->claim($input['uid'],$input['email'],'email_code')); echo "CLAIMED\n"; }
catch(Failure $e) { echo $e->kind."\n"; }
