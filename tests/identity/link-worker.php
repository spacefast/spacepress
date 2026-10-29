<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
$input = json_decode(stream_get_contents(STDIN), true);
echo "READY\n";
flush();
try {
    \Zero\Identity\Plugin::$accounts->provider('https://issuer.test', $input['subject'], null, '', $input['uid'], $input['session']);
    echo "LINKED\n";
    exit(1);
} catch (\Zero\Identity\Failure $e) {
    echo $e->kind . "\n";
}
