<?php
/** Commerce installation policy. Loaded before Woo, including its first activation. */
declare(strict_types=1);
defined('ABSPATH') || exit;
global $wpdb;
if (strlen($wpdb->prefix) > 20) {
    throw new RuntimeException('WooCommerce requires a WordPress table prefix of at most 20 characters');
}
add_filter('woocommerce_create_pages', '__return_empty_array', PHP_INT_MAX);
add_filter('woocommerce_enable_hpos_by_default_for_new_shops', '__return_false', PHP_INT_MAX);
// Never switch an existing store's authoritative order storage on its behalf.
foreach (wp_installing() ? [] : ['woocommerce_custom_orders_table_enabled', 'woocommerce_custom_orders_table_data_sync_enabled'] as $option) {
    $value = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $option));
    if ($wpdb->last_error !== '') {
        throw new RuntimeException('Unable to verify WooCommerce order storage');
    }
    if ($value === 'yes') {
        throw new RuntimeException('TypedPress commerce requires legacy order storage with HPOS synchronization disabled. Change storage in WooCommerce after completing synchronization.');
    }
}
