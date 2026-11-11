<?php
/** Original Zero counterpart of the pinned EmDash publishing examples; see ../README.md. */
declare(strict_types=1);

function zp_mode(): string { return (string) get_option('first_publication_mode', 'starter'); }
function zp_type(string $kind): string {
    return zp_mode() === 'blank' ? ($kind === 'posts' ? 'post' : 'page') : 'first_' . $kind;
}
function zp_url(WP_Post $post): string {
    $prefix = in_array($post->post_type, ['first_pages', 'page'], true)
        ? (zp_mode() === 'blog' ? '/pages/' : '/') : '/posts/';
    return home_url($prefix . $post->post_name);
}
function zp_excerpt(WP_Post $post): string {
    if (post_password_required($post)) return '';
    return zp_mode() === 'blank' ? $post->post_excerpt : (string) get_post_meta($post->ID, 'first_excerpt', true);
}
function zp_cover(WP_Post $post): int {
    if (post_password_required($post)) return 0;
    return zp_mode() === 'blank' ? (int) get_post_thumbnail_id($post) : (int) get_post_meta($post->ID, 'first_cover', true);
}
function zp_query(array $args = []): WP_Query {
    return new WP_Query(array_merge([
        'post_type' => zp_type('posts'), 'post_status' => 'publish',
        'posts_per_page' => 20, 'orderby' => ['date' => 'DESC', 'ID' => 'DESC'],
        'ignore_sticky_posts' => true, 'has_password' => false,
    ], $args));
}
function zp_terms(WP_Post $post, string $taxonomy): void {
    $terms = get_the_terms($post, $taxonomy);
    if (!$terms || is_wp_error($terms)) return;
    echo '<div class="terms" aria-label="' . esc_attr($taxonomy === 'category' ? 'Categories' : 'Tags') . '">';
    foreach ($terms as $term) {
        $prefix = $taxonomy === 'category' ? '/category/' : '/tag/';
        echo '<a href="' . esc_url(home_url($prefix . $term->slug)) . '">' . esc_html($term->name) . '</a>';
    }
    echo '</div>';
}
function zp_card(WP_Post $post): void {
    echo '<article class="card"><a href="' . esc_url(zp_url($post)) . '">';
    if (zp_cover($post)) echo wp_get_attachment_image(zp_cover($post), 'large', false, ['loading' => 'lazy']);
    echo '<h2>' . esc_html(get_the_title($post)) . '</h2></a>';
    echo '<p class="byline">' . esc_html(get_the_author_meta('display_name', (int) $post->post_author)) . ' · <time datetime="' . esc_attr(get_post_time('c', true, $post)) . '">' . esc_html(get_the_date('', $post)) . '</time></p>';
    if (zp_excerpt($post) !== '') echo '<p>' . esc_html(zp_excerpt($post)) . '</p>';
    zp_terms($post, 'category'); zp_terms($post, 'post_tag');
    echo '</article>';
}
function zp_sidebar(): void {
    echo '<aside aria-label="Publication sidebar"><h2>Explore</h2>';
    foreach (['category' => 'Categories', 'post_tag' => 'Tags'] as $taxonomy => $label) {
        echo '<h3>' . esc_html($label) . '</h3><ul>';
        $terms = get_terms(['taxonomy' => $taxonomy, 'hide_empty' => true, 'object_ids' => zp_query(['posts_per_page' => -1, 'fields' => 'ids', 'no_found_rows' => true])->posts]);
        if (!is_wp_error($terms)) foreach ($terms as $term) {
            $prefix = $taxonomy === 'category' ? '/category/' : '/tag/';
            echo '<li><a href="' . esc_url(home_url($prefix . $term->slug)) . '">' . esc_html($term->name) . '</a></li>';
        }
        echo '</ul>';
    }
    echo '<h3>Recent posts</h3><ul>';
    foreach (zp_query(['posts_per_page' => 5, 'no_found_rows' => true])->posts as $post) {
        echo '<li><a href="' . esc_url(zp_url($post)) . '">' . esc_html(get_the_title($post)) . '</a></li>';
    }
    echo '</ul></aside>';
}
add_action('after_setup_theme', static function (): void {
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form', 'comment-form', 'comment-list']);
    register_nav_menu('primary', 'Primary navigation');
});
add_action('init', static function (): void {
    foreach (['category', 'post_tag'] as $taxonomy) register_taxonomy_for_object_type($taxonomy, zp_type('posts'));
    if (zp_mode() === 'blog') add_post_type_support(zp_type('posts'), 'comments');
}, 30);
add_filter('post_type_link', static function (string $url, WP_Post $post): string {
    return in_array($post->post_type, ['first_posts', 'first_pages'], true) ? zp_url($post) : $url;
}, 10, 2);
// Our public routes query published CPTs directly. Admin, REST, plugins and uploads
// retain WordPress's routing; the theme does not change First's content registration.
add_filter('redirect_canonical', static function ($url) {
    $path = wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return preg_match('~^/(posts|pages|category|tag|search|rss\.xml)(/|$)~', (string) $path) ? false : $url;
});
add_action('wp_enqueue_scripts', static function (): void {
    wp_enqueue_style('first-publication', get_stylesheet_uri(), [], '1');
    wp_enqueue_script('first-publication-theme', get_template_directory_uri() . '/theme.js', [], '1', true);
});
add_action('customize_register', static function (WP_Customize_Manager $customizer): void {
    $customizer->add_section('first_publication', ['title' => 'Publication appearance']);
    $customizer->add_setting('first_accent', ['default' => '#355e42', 'sanitize_callback' => 'sanitize_hex_color']);
    $customizer->add_control(new WP_Customize_Color_Control($customizer, 'first_accent', ['label' => 'Accent color', 'section' => 'first_publication']));
    $customizer->add_setting('first_footer', ['default' => 'Made with First. Published with care.', 'sanitize_callback' => 'sanitize_text_field']);
    $customizer->add_control('first_footer', ['label' => 'Footer text', 'section' => 'first_publication']);
});
