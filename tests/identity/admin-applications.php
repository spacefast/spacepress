<?php
declare(strict_types=1);
require __DIR__.'/bootstrap.php';
use SpacePress\Identity\{Plugin,Security};
$admin=get_user_by('login','identity-admin');wp_set_current_user($admin->ID);$nonce=wp_create_nonce('wp_rest');
function mutate(array $body):array{global $nonce;$r=new WP_REST_Request('POST');$r->set_url_params(['operation'=>'admin/applications']);$r->set_header('Origin',untrailingslashit(home_url()));$r->set_header('X-WP-Nonce',$nonce);$r->set_body_params($body);return Plugin::$api->dispatch($r)->get_data();}
$body=['name'=>'Application mutation test','redirect_uri'=>'http://127.0.0.1:18181/api/identity/callback','origin'=>'http://127.0.0.1:18181','idempotency_key'=>Security::token()];$a=mutate($body);$b=mutate($body);if(!isset($a['data']['id'])||$a!==$b){throw new RuntimeException('Application retry duplicated or failed');}
$changed=mutate([...$body,'name'=>'Conflicting mutation']);if(($changed['error']['code']??'')!=='idempotency_conflict'){throw new RuntimeException('Reused creation key changed payload');}
foreach([['redirect_uri'=>'https://app.example/*','origin'=>'https://app.example'],['redirect_uri'=>'https://app.example/callback#fragment','origin'=>'https://app.example'],['redirect_uri'=>'https://app.example/callback','origin'=>'https://other.example']] as $invalid){$result=mutate([...$body,...$invalid,'idempotency_key'=>Security::token()]);if(($result['error']['code']??'')!=='invalid_redirect'){throw new RuntimeException('Unsafe callback registered');}}
echo "PASS application creation retry returns same ID; changed payload, wildcard, fragment and origin mismatch rejected\n";
// Registered application origins may call account routes, never administration.
Plugin::$db->insert('applications', ['id' => 'app_admin_origin_' . bin2hex(random_bytes(3)), 'name' => 'Origin app', 'redirects' => json_encode(['http://127.0.0.1:18187/cb']), 'origins' => json_encode(['http://127.0.0.1:18187'])]);
$r = new WP_REST_Request('POST');
$r->set_url_params(['operation' => 'admin/applications']);
$r->set_header('Origin', 'http://127.0.0.1:18187');
$r->set_header('X-WP-Nonce', $nonce);
$r->set_body_params([...$body, 'idempotency_key' => Security::token()]);
check((Plugin::$api->dispatch($r)->get_data()['error']['code'] ?? '') === 'invalid_origin', 'administrator writes refuse a registered application origin');
