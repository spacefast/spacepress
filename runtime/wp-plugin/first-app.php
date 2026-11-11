<?php
/**
 * Plugin Name: {{label}} (First app)
 * Version: {{firstVersion}}+{{schemaHash}}
 * Requires at least: {{wpVersion}}
 * Requires PHP: {{phpVersion}}
 * Requires Plugins: {{requires}}
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);
defined('ABSPATH') || exit;
register_activation_hook(__FILE__, static function (): void {
    $plugin = class_exists(\First\Wp\Runtime::class) ? \First\Wp\Runtime::app(__DIR__, __FILE__) : null;
    if ($plugin === null) {
        wp_die(esc_html('First: activate a compatible First Runtime and the required plugins first.'), 'First', ['back_link' => true]);
    }
    $plugin->activate();
});
register_deactivation_hook(__FILE__, static function (): void {
    class_exists(\First\Wp\Hardening::class) && \First\Wp\Hardening::deactivate();
});
add_action('plugins_loaded', static function (): void {
    if (!class_exists(\First\Wp\Runtime::class)) {
        add_action('admin_notices', static fn () => printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('First: the first-runtime plugin is not active; {{name}} is not running.')));
        return;
    }
    \First\Wp\Runtime::app(__DIR__, __FILE__);
}, 1);
