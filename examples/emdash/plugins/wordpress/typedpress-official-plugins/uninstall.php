<?php
if (!defined('WP_UNINSTALL_PLUGIN')) { exit; }
// Only this example's own records/options are removed. Published TypedPress stories are retained.
foreach (['zpl_event', 'zpl_delivery', 'zpl_form', 'zpl_submit'] as $type) {
    foreach (get_posts(['post_type' => $type, 'post_status' => 'any', 'numberposts' => -1]) as $post) { wp_delete_post($post->ID, true); }
}
global $wpdb;
$names = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like('tp_plugins_') . '%'));
foreach ($names as $name) { delete_option($name); }
if (function_exists('as_unschedule_all_actions')) {
    as_unschedule_all_actions('tp_plugins_deliver', [], 'typedpress-official-plugins');
    as_unschedule_all_actions('tp_plugins_diagnostic', [], 'typedpress-official-plugins');
}
