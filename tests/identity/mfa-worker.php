<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use First\Identity\Plugin;

$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
echo $GLOBALS['wpdb']->get_var('SELECT CONNECTION_ID()'), "\n";
fflush(STDOUT);
ob_start();
$_COOKIE['zi_factor'] = $input['binding'];
header_remove(); // the worker is a browser response; cookies go nowhere
$r = new WP_REST_Request('POST');
$r->set_url_params(['operation' => 'sign-in/mfa']);
$r->set_header('Origin', untrailingslashit(home_url()));
$r->set_body_params(['challenge_id' => $input['challenge'], 'code' => $input['code']]);
$data = Plugin::$api->dispatch($r)->get_data();
ob_end_clean();
echo ($data['error']['code'] ?? $data['data']['kind'] ?? 'unknown'), "\n";
