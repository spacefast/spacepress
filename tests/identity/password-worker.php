<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use SpacePress\Identity\{Plugin, Failure};

$input = json_decode(stream_get_contents(STDIN), true, 32, JSON_THROW_ON_ERROR);
echo $GLOBALS['wpdb']->get_var('SELECT CONNECTION_ID()'), "\n";
fflush(STDOUT);
ob_start();
$r = new WP_REST_Request('POST');
$r->set_url_params(['operation' => 'sign-in/password']);
$r->set_header('Origin', untrailingslashit(home_url()));
$r->set_body_params(['login' => $input['login'], 'password' => $input['password']]);
$data = Plugin::$api->dispatch($r)->get_data();
ob_end_clean();
echo ($data['error']['code'] ?? $data['data']['kind'] ?? 'unknown'), "\n";
