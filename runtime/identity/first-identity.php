<?php
/**
 * Plugin Name: First Identity
 * Description: Accounts, verified emails, passkeys, MFA and an OpenID Connect issuer for WordPress.
 * Version: 0.3.0
 * Requires at least: 7.1
 * Requires PHP: 8.2
 * License: GPL-2.0-or-later
 * Text Domain: first-identity
 */
declare(strict_types=1);
defined("ABSPATH") || exit();
require_once __DIR__ . "/vendor-prefixed/autoload.php";
spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, "First\\Identity\\") && !str_starts_with($class, "First\\Identity\\Vendor\\")) {
        $file = __DIR__ . "/src/" . str_replace("\\", "/", substr($class, strlen("First\\Identity\\"))) . ".php";
        if (is_file($file)) {
            require $file;
        }
    }
});
register_activation_hook(__FILE__, static function (): void {
    global $wpdb;
    \First\Identity\Schema::migrate(new \First\Identity\DB($wpdb));
    \First\Identity\Keys::current();
    if (!wp_next_scheduled("first_identity_maintenance")) {
        wp_schedule_event(time() + 60, "hourly", "first_identity_maintenance");
    }
});
register_deactivation_hook(__FILE__, static function (): void {
    wp_clear_scheduled_hook("first_identity_maintenance");
    wp_clear_scheduled_hook("first_identity_password_inventory");
});
\First\Identity\Plugin::boot(__FILE__);
