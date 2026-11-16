<?php
/**
 * Plugin Name: TypedPress Showcase — Classic Pantry
 * Description: Edit the showcase pantry in the full WordPress admin.
 * Version: 1.0.0
 * Requires Plugins: typedpress-app-showcase
 * License: GPL-2.0-or-later
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/build-control.php';

function tp_showcase_classic_pantry_screen($section) {
    if (!current_user_can('edit_others_posts')) {
        wp_die(esc_html__('You cannot edit this pantry.', 'typedpress-showcase'));
    }
    $titles = ['items' => 'Pantry items', 'locations' => 'Pantry locations', 'shopping' => 'Shopping list'];
    ?>
    <div class="wrap" id="typedpress-classic-pantry"
        data-api-url="<?php echo esc_url(home_url('/__tp/api/v1')); ?>"
        data-nonce="<?php echo esc_attr(wp_create_nonce('wp_rest')); ?>"
        data-section="<?php echo esc_attr($section); ?>">
        <h1><?php echo esc_html($titles[$section]); ?></h1>
        <p>These are the same pantry records used by the showcase and TypedPress admin.</p>
        <p><a href="<?php echo esc_url(plugins_url('typedpress-app-showcase/public/#pantry')); ?>">Open the pantry tracker</a></p>
        <div id="typedpress-pantry-notice" role="status" aria-live="polite"></div>
        <p><button type="button" class="button" id="typedpress-pantry-refresh">Refresh records</button></p>
        <div id="typedpress-pantry-content"><p>Loading pantry records…</p></div>
        <noscript><p>This pantry editor needs JavaScript.</p></noscript>
    </div>
    <?php
}

add_action('admin_menu', function () {
    $capability = 'edit_others_posts';
    $parent = 'typedpress-showcase-pantry';
    $screens = [];
    $screens[] = add_menu_page('Pantry', 'Pantry', $capability, $parent, function () {
        tp_showcase_classic_pantry_screen('items');
    }, 'dashicons-carrot', 27);
    foreach ([
        [$parent, 'Items', 'items'],
        ['typedpress-showcase-pantry-locations', 'Locations', 'locations'],
        ['typedpress-showcase-pantry-shopping', 'Shopping List', 'shopping'],
    ] as [$slug, $title, $section]) {
        $callback = $slug === $parent ? '' : function () use ($section) {
            tp_showcase_classic_pantry_screen($section);
        };
        $screens[] = add_submenu_page($parent, $title, $title, $capability, $slug, $callback);
    }
    add_action('admin_enqueue_scripts', function ($hook) use ($screens) {
        if (!in_array($hook, $screens, true)) {
            return;
        }
        $script = WP_PLUGIN_DIR . '/typedpress-app-showcase/public/classic-pantry.js';
        wp_enqueue_script_module(
            'typedpress-showcase-classic-pantry',
            plugins_url('typedpress-app-showcase/public/classic-pantry.js'),
            [],
            is_readable($script) ? hash_file('sha256', $script) : '1.0.0'
        );
    });
});
