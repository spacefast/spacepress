<?php
/**
 * Plugin Name: Official examples — Zero plugin lab
 * Description: Native WordPress counterparts of the pinned EmDash plugin examples. No admin replacement.
 * Version: 1.0.0
 * License: MIT
 */
declare(strict_types=1);

namespace ZeroOfficialPlugins;

if (!defined('ABSPATH')) { exit; }

const VERSION = '1.0.0';
const ENTRY_TYPE = 'zero_entries';
const NS = 'zero-plugins/v1';

require __DIR__ . '/storage.php';
require __DIR__ . '/hooks.php';
require __DIR__ . '/embeds.php';
require __DIR__ . '/forms.php';
require __DIR__ . '/admin.php';
require __DIR__ . '/routes.php';

register_activation_hook(__FILE__, function (): void {
    register_types();
    if (get_option('zero_plugins_installed') === false) {
        update_option('zero_plugins_installed', VERSION, false);
        record('lifecycle.install', ['version' => VERSION]);
    }
    record('lifecycle.activate', ['version' => VERSION]);
});
register_deactivation_hook(__FILE__, function (): void {
    record('lifecycle.deactivate', ['version' => VERSION]);
    // Data is deliberately retained when deactivated; uninstall is explicit.
});
add_action('init', __NAMESPACE__ . '\\register_types');
add_action('rest_api_init', __NAMESPACE__ . '\\register_routes');
add_action('admin_menu', __NAMESPACE__ . '\\admin_menu');
add_action('acf/init', __NAMESPACE__ . '\\field_controls', 30);
add_action('template_redirect', __NAMESPACE__ . '\\public_page');
add_action('zero_plugins_deliver', __NAMESPACE__ . '\\deliver', 10, 1);
