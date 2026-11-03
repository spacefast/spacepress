<?php
/** Seeds only a freshly provisioned disposable example site; never resets existing content. */
[$mode, $site] = $args;
if (!in_array($mode, ['blank', 'starter', 'blog'], true) || realpath(ABSPATH) !== realpath($site)) {
    WP_CLI::error('Example site ownership does not match.');
}
$previous = get_option('zero_publication_mode');
if ($previous && $previous !== $mode) WP_CLI::error('This project already belongs to another example.');
update_option('zero_publication_mode', $mode);
switch_theme('zero-publication');
if (get_option('zero_publication_seeded')) {
    WP_CLI::success('Existing example content, settings and credentials preserved.');
    return;
}
update_option('blogname', $mode === 'blog' ? 'Field Notes' : ($mode === 'starter' ? 'A Place to Begin' : 'My Site'));
update_option('blogdescription', $mode === 'blog' ? 'Small observations on making things for the web.' : 'A little room for your next idea.');
set_theme_mod('zero_accent', '#355e42');
set_theme_mod('zero_footer', 'Made with Zero. Published with care.');
if ($mode !== 'blank') {
    foreach (['category', 'post_tag'] as $taxonomy) register_taxonomy_for_object_type($taxonomy, 'zero_posts');
    $category = wp_insert_term('Fieldwork', 'category', ['slug' => 'fieldwork']);
    $tag = wp_insert_term('Making', 'post_tag', ['slug' => 'making']);
    if (is_wp_error($category) || is_wp_error($tag)) WP_CLI::error('Unable to seed publication terms.');
    $titles = ['The pleasure of a small beginning', 'Notes from the workbench', 'A slower kind of web', 'Making room for useful things', 'What a good question can do', 'In praise of the first draft', 'Walking without a destination', 'An unfinished field guide'];
    foreach ($titles as $index => $title) {
        $id = wp_insert_post([
            'post_type' => 'zero_posts', 'post_status' => 'publish', 'post_title' => $title,
            'post_name' => sanitize_title($title), 'post_author' => get_current_user_id() ?: 1,
            'post_date' => gmdate('Y-m-d H:i:s', time() - ($index + 1) * DAY_IN_SECONDS),
            'post_content' => '<!-- wp:paragraph --><p>' . esc_html($title) . ' starts with paying attention. This is an original sample story, ready to replace in the WordPress block editor.</p><!-- /wp:paragraph --><!-- wp:heading --><h2 class="wp-block-heading">Leave a little space</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Publish a thought, revise it tomorrow, and let the work grow in public. The content here lives in WordPress, alongside its revisions and media.</p><!-- /wp:paragraph -->',
            'comment_status' => $mode === 'blog' ? 'open' : 'closed',
            'meta_input' => ['zero_excerpt' => 'An original field note about paying attention, making things, and leaving room to grow.'],
        ], true);
        if (is_wp_error($id)) WP_CLI::error($id->get_error_message());
        wp_set_object_terms($id, [(int) $category['term_id']], 'category');
        wp_set_object_terms($id, [(int) $tag['term_id']], 'post_tag');
    }
    $about = wp_insert_post([
        'post_type' => 'zero_pages', 'post_status' => 'publish', 'post_title' => 'About this publication', 'post_name' => 'about',
        'post_content' => '<!-- wp:paragraph --><p>A small publication with an open door. Edit this page in WordPress; your next reload shows the saved blocks.</p><!-- /wp:paragraph -->',
    ], true);
    if (is_wp_error($about)) WP_CLI::error($about->get_error_message());
    $menu = wp_create_nav_menu('Publication navigation');
    if (is_wp_error($menu)) WP_CLI::error($menu->get_error_message());
    foreach (['Home' => '/', 'Posts' => '/posts', 'About' => $mode === 'blog' ? '/pages/about' : '/about'] as $label => $url) {
        wp_update_nav_menu_item($menu, 0, ['menu-item-title' => $label, 'menu-item-url' => home_url($url), 'menu-item-status' => 'publish', 'menu-item-type' => 'custom']);
    }
    set_theme_mod('nav_menu_locations', ['primary' => $menu]);
}
update_option('zero_publication_seeded', true);
flush_rewrite_rules(false);
WP_CLI::success('Original publication content and native theme installed.');
