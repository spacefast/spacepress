<?php
// Identity shares $wpdb with its host. When the host owns an open transaction on that connection,
// identity work joins it instead of committing it: the host's rollback undoes both. No host hook.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use Zero\Identity\{Plugin, Security};

global $wpdb;
$tag = bin2hex(random_bytes(4));
add_role('zero_guest', 'Guest', ['read' => true]);
do_action('zero_runtime_loaded');
Plugin::$db->insert('applications', ['id' => "app_tx_$tag", 'name' => 'Tx', 'redirects' => '[]', 'origins' => '[]']);
$guest = wp_insert_user(['user_login' => "ztx_$tag", 'user_pass' => Security::token(), 'role' => 'zero_guest']);

$wpdb->query('START TRANSACTION');
update_option("zero_tx_marker_$tag", 'host write', false);
Plugin::$accounts->issueForUser($guest, "app_tx_$tag");
$wpdb->query('ROLLBACK');
wp_cache_delete("zero_tx_marker_$tag", 'options');
wp_cache_delete('notoptions', 'options');
check(get_option("zero_tx_marker_$tag") === false, "identity work inside the host's transaction does not commit the host's earlier writes");
check(!Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'tokens WHERE wp_user_id=%d', $guest), "the host's rollback undoes the identity rows too");
check(Plugin::$accounts->issueForUser($guest, "app_tx_$tag")['token_type'] === 'Bearer', 'outside a host transaction identity commits on its own');
