<?php
// Runs with the ORIGINAL identity plugin (spacefast-identity, from the original runtime) active and
// the new app's plugin inactive (so nothing of the new app touches these users before migration): signs app users in the way the original Space did (an email-code login
// creates the account and verifies its email; joining the Space stamps _spacefast_app_user), then
// prints the rows that produced as JSON (users.json; replay-users.php loads it where the original
// plugin isn't available).
declare(strict_types=1);

global $wpdb;
$space = 'legacy-space';
$join = static function (int $uid) use ($space): void {
    add_option('spacefast_app_subject_' . $uid . '_' . $space, 'usr_' . bin2hex(random_bytes(32)), '', false);
    add_user_meta($uid, '_spacefast_space_id', $space);
    update_user_meta($uid, '_spacefast_app_user', $space);
};
$ada = Spacefast\Identity\Plugin::$accounts->emailLogin('ada@example.test');
wp_update_user(['ID' => $ada, 'display_name' => 'Ada']);
$join($ada);
$bo = Spacefast\Identity\Plugin::$accounts->emailLogin('bo@example.test');
$join($bo);
// Suspended by the Space's owner on the original platform.
$cy = Spacefast\Identity\Plugin::$accounts->emailLogin('cy@example.test');
$join($cy);
$wpdb->update("{$wpdb->prefix}sfi_accounts", ['status' => 'suspended'], ['wp_user_id' => $cy]);
// An app user of another Space on the same installation stays where it is.
$other = Spacefast\Identity\Plugin::$accounts->emailLogin('other@example.test');
update_user_meta($other, '_spacefast_app_user', 'other-space');

$ids = [$ada, $bo, $cy, $other];
$in = implode(',', $ids);
$p = $wpdb->prefix;
echo wp_json_encode([
    'ids' => compact('ada', 'bo', 'cy', 'other'),
    'users' => $wpdb->get_results("SELECT * FROM {$p}users WHERE ID IN ($in) ORDER BY ID", ARRAY_A),
    'usermeta' => $wpdb->get_results("SELECT user_id, meta_key, meta_value FROM {$p}usermeta WHERE user_id IN ($in) ORDER BY umeta_id", ARRAY_A),
    'accounts' => $wpdb->get_results("SELECT * FROM {$p}sfi_accounts WHERE wp_user_id IN ($in) ORDER BY wp_user_id", ARRAY_A),
    'emails' => $wpdb->get_results("SELECT id, wp_user_id, HEX(normalized) AS normalized, verified_at, method FROM {$p}sfi_emails WHERE wp_user_id IN ($in) ORDER BY id", ARRAY_A),
    'options' => $wpdb->get_results("SELECT option_name, option_value FROM {$p}options WHERE option_name LIKE 'spacefast\\_app\\_subject\\_%' ORDER BY option_id", ARRAY_A),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
