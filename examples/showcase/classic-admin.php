<?php
/**
 * Plugin Name: SpacePress Showcase — Classic Pantry
 * Description: Edit the showcase pantry in the full WordPress admin.
 * Version: 1.0.0
 * Requires Plugins: spacepress-app-showcase
 * License: GPL-2.0-or-later
 */

defined('ABSPATH') || exit;

require_once __DIR__ . '/build-control.php';

function sp_showcase_classic_pantry_screen($section) {
    if (!current_user_can('edit_others_posts')) {
        wp_die(esc_html__('You cannot edit this pantry.', 'spacepress-showcase'));
    }
    $titles = ['items' => 'Pantry items', 'locations' => 'Pantry locations', 'shopping' => 'Shopping list'];
    ?>
    <div class="wrap" id="spacepress-classic-pantry"
        data-api-url="<?php echo esc_url(home_url('/wp-json/spacepress/v1')); ?>"
        data-nonce="<?php echo esc_attr(wp_create_nonce('wp_rest')); ?>"
        data-section="<?php echo esc_attr($section); ?>">
        <h1><?php echo esc_html($titles[$section]); ?></h1>
        <p>These are the same pantry records used by the showcase and SpacePress admin.</p>
        <p><a href="<?php echo esc_url(plugins_url('spacepress-app-showcase/public/#pantry')); ?>">Open the pantry tracker</a></p>
        <div id="spacepress-pantry-notice" role="status" aria-live="polite"></div>
        <p><button type="button" class="button" id="spacepress-pantry-refresh">Refresh records</button></p>
        <div id="spacepress-pantry-content"><p>Loading pantry records…</p></div>
        <noscript><p>This pantry editor needs JavaScript.</p></noscript>
    </div>
    <?php
}

add_action('admin_menu', function () {
    $capability = 'edit_others_posts';
    $parent = 'spacepress-showcase-pantry';
    $screens = [];
    $screens[] = add_menu_page('Pantry', 'Pantry', $capability, $parent, function () {
        sp_showcase_classic_pantry_screen('items');
    }, 'dashicons-carrot', 27);
    foreach ([
        [$parent, 'Items', 'items'],
        ['spacepress-showcase-pantry-locations', 'Locations', 'locations'],
        ['spacepress-showcase-pantry-shopping', 'Shopping List', 'shopping'],
    ] as [$slug, $title, $section]) {
        $callback = $slug === $parent ? '' : function () use ($section) {
            sp_showcase_classic_pantry_screen($section);
        };
        $screens[] = add_submenu_page($parent, $title, $title, $capability, $slug, $callback);
    }
    add_action('admin_enqueue_scripts', function ($hook) use ($screens) {
        if (!in_array($hook, $screens, true)) {
            return;
        }
        $script = WP_PLUGIN_DIR . '/spacepress-app-showcase/public/classic-pantry.js';
        wp_enqueue_script_module(
            'spacepress-showcase-classic-pantry',
            plugins_url('spacepress-app-showcase/public/classic-pantry.js'),
            [],
            is_readable($script) ? hash_file('sha256', $script) : '1.0.0'
        );
    });
});
