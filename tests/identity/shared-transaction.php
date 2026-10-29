<?php
// Identity shares $wpdb with its host. When the host owns an open transaction (and says so through
// zero_identity_outer_transaction), identity work joins it: the host's rollback undoes both.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, Security};

global $wpdb;
$tag = bin2hex(random_bytes(4));
$open = false;
add_filter('zero_identity_outer_transaction', static function (bool $outer) use (&$open): bool { return $outer || $open; });
add_role('zero_guest', 'Guest', ['read' => true]);
do_action('zero_runtime_loaded');
Plugin::$db->insert('applications', ['id' => "app_tx_$tag", 'name' => 'Tx', 'redirects' => '[]', 'origins' => '[]']);
$guest = wp_insert_user(['user_login' => "ztx_$tag", 'user_pass' => Security::token(), 'role' => 'zero_guest']);

$wpdb->query('START TRANSACTION');
$open = true;
update_option("zero_tx_marker_$tag", 'host write', false);
Plugin::$accounts->issueForUser($guest, "app_tx_$tag");
$wpdb->query('ROLLBACK');
$open = false;
wp_cache_delete("zero_tx_marker_$tag", 'options');
wp_cache_delete('notoptions', 'options');
check(get_option("zero_tx_marker_$tag") === false, "identity work inside the host's transaction does not commit the host's earlier writes");
check(!Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'tokens WHERE wp_user_id=%d', $guest), "the host's rollback undoes the identity rows too");
check(Plugin::$accounts->issueForUser($guest, "app_tx_$tag")['token_type'] === 'Bearer', 'outside a host transaction identity commits on its own');
