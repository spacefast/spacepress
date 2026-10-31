<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, Failure};

$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
echo $GLOBALS['wpdb']->get_var('SELECT CONNECTION_ID()'), "\n";
fflush(STDOUT);
try {
    Plugin::$accounts->verifiedSignIn($input['email'], $input['session']);
    echo "UPGRADED\n";
} catch (Failure $e) {
    echo $e->kind . "\n";
}
