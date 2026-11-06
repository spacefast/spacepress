<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
echo Zero\Identity\Plugin::$db->row('SELECT CONNECTION_ID() AS id')['id'] . "\n";
flush();
if ($input['crash'] ?? false) {
    add_filter('pre_update_option_zero_identity_password_inventory', static function () { exit(9); });
}
do_action('zero_identity_password_inventory');
echo "completed\n";
