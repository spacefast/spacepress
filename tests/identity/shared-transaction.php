<?php
// Identity shares $wpdb with its host. When the host owns an open transaction on that connection,
// identity work joins it instead of committing it: the host's rollback undoes both. No host hook.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
use First\Identity\{Plugin, Security};

global $wpdb;
$tag = bin2hex(random_bytes(4));
add_role('first_guest', 'Guest', ['read' => true]);
do_action('first_runtime_loaded');
Plugin::$db->insert('applications', ['id' => "app_tx_$tag", 'name' => 'Tx', 'redirects' => '[]', 'origins' => '[]']);
$guest = wp_insert_user(['user_login' => "ztx_$tag", 'user_pass' => Security::token(), 'role' => 'first_guest']);

$wpdb->query('START TRANSACTION');
update_option("first_tx_marker_$tag", 'host write', false);
Plugin::$accounts->issueForUser($guest, "app_tx_$tag");
$wpdb->query('ROLLBACK');
wp_cache_delete("first_tx_marker_$tag", 'options');
wp_cache_delete('notoptions', 'options');
check(get_option("first_tx_marker_$tag") === false, "identity work inside the host's transaction does not commit the host's earlier writes");
check(!Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'tokens WHERE wp_user_id=%d', $guest), "the host's rollback undoes the identity rows too");
check(Plugin::$accounts->issueForUser($guest, "app_tx_$tag")['token_type'] === 'Bearer', 'outside a host transaction identity commits on its own');

// A successful identity write inside the host's transaction leaves no cached trace the host's
// rollback would have to undo: reads after the rollback see the database, not the upgrade.
$touched = [];
add_action('first_identity_touched_user', static function (int $uid) use (&$touched): void { $touched[] = $uid; });
$guest2 = wp_insert_user(['user_login' => "ztx2_$tag", 'user_pass' => Security::token(), 'role' => 'first_guest']);
Plugin::$accounts->ensure($guest2);
$session = Plugin::$sessions->create($guest2)['session'];
$wpdb->query('START TRANSACTION');
Plugin::$accounts->verifiedSignIn("tx-$tag@example.test", $session);
get_userdata($guest2); // the host reads the upgraded user inside its transaction
$wpdb->query('ROLLBACK');
foreach ($touched as $uid) {
    clean_user_cache($uid); // what the host's rollback handler does with the hook's ids
}
$after = get_userdata($guest2);
check(in_array($guest2, $touched, true) && $after->roles === ['first_guest'] && $after->user_email === '', "the host learns which users identity touched and its rollback restores them");

// A caught nested failure must not drop the enclosing transaction's cleanup list.
$nested = Plugin::$accounts->emailLogin("nested-$tag@example.test");
try {
    Plugin::$db->transaction(function () use ($nested, $tag): void {
        Plugin::$db->transaction(fn () => Plugin::$accounts->claim($nested, "nested-two-$tag@example.test", 'test'));
        Plugin::$accounts->primary($nested, (int) Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . 'emails WHERE normalized=%s', "nested-two-$tag@example.test")['id']);
        try {
            Plugin::$db->transaction(static function (): never { throw new RuntimeException('unrelated'); });
        } catch (RuntimeException) {
        }
        get_userdata($nested); // re-cache the uncommitted primary email
        throw new RuntimeException('abort outer');
    });
} catch (RuntimeException) {
}
check(get_userdata($nested)->user_email === "nested-$tag@example.test", 'an outer rollback after a caught nested failure still clears the user cache');

// Every WordPress user write inside the host's transaction is announced, not only identity's own.
$touched = [];
$wpdb->query('START TRANSACTION');
Plugin::$db->transaction(static function () use ($nested): void {
    wp_update_user(['ID' => $nested, 'display_name' => 'Renamed inside']);
});
$wpdb->query('ROLLBACK');
foreach ($touched as $uid) {
    clean_user_cache($uid);
}
check(in_array($nested, $touched, true) && get_userdata($nested)->display_name !== 'Renamed inside', 'core user writes inside identity work are announced for the host rollback');
