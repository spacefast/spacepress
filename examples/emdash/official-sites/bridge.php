<?php
/** Native read adapter for the pinned official Astro templates. */
add_action('init', function () {
    register_nav_menu('primary', 'Primary navigation');
    add_theme_support('custom-logo');
    foreach (['category', 'post_tag'] as $taxonomy) register_taxonomy_for_object_type($taxonomy, 'first_posts');
    add_post_type_support('first_posts', 'comments');
    register_taxonomy('first_credit', ['first_posts'], ['label' => 'Byline credits', 'public' => false, 'show_ui' => true, 'show_in_rest' => true]);
});
function zof_content($html) {
    $blocks = [];
    foreach (parse_blocks($html) as $index => $block) {
        $rendered = render_block($block);
        if (trim($rendered) === '') continue;
        $style = preg_match('/<h([1-6])\b/i', $rendered, $match) ? 'h' . $match[1] : 'normal';
        $blocks[] = ['_type' => 'block', '_key' => (string) $index, 'style' => $style,
            'children' => [['_type' => 'span', 'text' => html_entity_decode(wp_strip_all_tags($rendered), ENT_QUOTES | ENT_HTML5, 'UTF-8')]], '_html' => $rendered];
    }
    return $blocks;
}
function zof_terms($id, $taxonomy) {
    $terms = wp_get_object_terms($id, $taxonomy);
    return is_wp_error($terms) ? [] : array_map(fn($t) => ['id' => (string)$t->term_id, 'slug' => $t->slug, 'label' => $t->name], $terms);
}
function zof_entry($post) {
    $modified = get_post_datetime($post, 'modified', 'local') ?: get_post_datetime($post, 'date', 'local');
    $image_id = get_post_meta($post->ID, 'first_cover', true);
    $image_url = $image_id ? wp_get_attachment_image_url((int)$image_id, 'full') : false;
    $bylines = [];
    foreach (zof_terms($post->ID, 'first_credit') as $term) {
        $bylines[] = ['byline' => ['displayName' => $term['label']], 'roleLabel' => get_term_meta((int)$term['id'], 'first_role', true) ?: null];
    }
    if (!$bylines) $bylines[] = ['byline' => ['displayName' => get_the_author_meta('display_name', $post->post_author)], 'roleLabel' => null];
    return ['id' => $post->post_name, 'data' => [
        'id' => (string)$post->ID, 'title' => $post->post_title, 'content' => zof_content($post->post_content),
        'excerpt' => get_post_meta($post->ID, 'first_excerpt', true) ?: '',
        'featured_image' => $image_url ? ['src' => $image_url, 'alt' => get_post_meta((int)$image_id, '_wp_attachment_image_alt', true) ?: ''] : null,
        'publishedAt' => $post->post_status === 'publish' ? get_post_time('c', true, $post) : null,
        'updatedAt' => $modified ? $modified->format('c') : gmdate('c'),
        'seoTitle' => get_post_meta($post->ID, 'first_seoTitle', true) ?: '',
        'seoDescription' => get_post_meta($post->ID, 'first_seoDescription', true) ?: '',
        'terms' => ['tag' => zof_terms($post->ID, 'post_tag'), 'category' => zof_terms($post->ID, 'category')],
        'bylines' => $bylines,
    ], 'edit' => ['title' => (object)[], 'excerpt' => (object)[], 'content' => (object)[], 'featured_image' => (object)[]]];
}
function zof_preview_valid($token, $id) {
    $parts = explode(':', (string)$token);
    return count($parts) === 3 && (int)$parts[0] === $id && (int)$parts[1] > time()
        && hash_equals(hash_hmac('sha256', $parts[0] . ':' . $parts[1], wp_salt('auth')), $parts[2]);
}
add_filter('preview_post_link', function ($url, $post) {
    $frontend = get_option('first_official_frontend');
    if (!$frontend || !in_array($post->post_type, ['first_posts', 'first_pages'], true)) return $url;
    $payload = $post->ID . ':' . (time() + 600);
    $token = $payload . ':' . hash_hmac('sha256', $payload, wp_salt('auth'));
    $path = $post->post_type === 'first_posts' ? '/posts/' : (get_option('first_official_mode') === 'blog' ? '/pages/' : '/');
    return $frontend . $path . $post->post_name . '?preview=' . rawurlencode($token);
}, 10, 2);
add_action('rest_api_init', function () {
    register_rest_route('first-official/v1', '/session', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function () {
        $id = isset($_COOKIE[LOGGED_IN_COOKIE]) ? wp_validate_auth_cookie($_COOKIE[LOGGED_IN_COOKIE], 'logged_in') : false;
        $response = new WP_REST_Response(['user' => $id ? ['id' => (int)$id, 'name' => get_the_author_meta('display_name', $id)] : null]);
        $response->header('Cache-Control', 'private, no-store');
        return $response;
    }]);
    register_rest_route('first-official/v1', '/site', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function () {
        $settings = ['title' => get_option('blogname'), 'tagline' => get_option('blogdescription')];
        foreach (['logo' => get_theme_mod('custom_logo'), 'favicon' => get_option('site_icon')] as $key => $id) if ($id && wp_get_attachment_url($id)) $settings[$key] = ['mediaId' => (string)$id, 'alt' => get_post_meta($id, '_wp_attachment_image_alt', true), 'url' => wp_get_attachment_url($id)];
        return ['settings' => $settings,
            'menus' => array_map(function ($menu) {
                $locations = get_nav_menu_locations();
                $native = wp_get_nav_menu_items($locations[$menu['name']] ?? 0);
                if ($native) $menu['items'] = array_map(fn($item) => ['type' => 'custom', 'label' => $item->title, 'url' => $item->url, 'target' => $item->target], $native);
                return $menu;
            }, get_option('first_official_menus', [])), 'widgets' => get_option('first_official_widgets', [])];
    }]);
    register_rest_route('first-official/v1', '/terms/(?P<taxonomy>category|tag)', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ($r) {
        $terms = get_terms(['taxonomy' => $r['taxonomy'] === 'tag' ? 'post_tag' : 'category', 'hide_empty' => false]);
        return is_wp_error($terms) ? $terms : array_map(fn($t) => ['id' => (string)$t->term_id, 'slug' => $t->slug, 'label' => $t->name], $terms);
    }]);
    register_rest_route('first-official/v1', '/content/(?P<collection>posts|pages)', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ($r) {
        $limit = max(1, min(100, (int)($r['limit'] ?: 20)));
        $query = ['post_type' => 'first_' . $r['collection'], 'post_status' => 'publish', 'has_password' => false,
            'posts_per_page' => $limit, 'offset' => max(0, (int)$r['offset']), 'orderby' => 'date ID', 'order' => 'DESC'];
        if ($r['slug']) {
            $query['name'] = sanitize_title($r['slug']);
            $candidate = get_page_by_path($query['name'], OBJECT, $query['post_type']);
            if ($candidate && zof_preview_valid($r['preview'], $candidate->ID)) $query['post_status'] = ['publish', 'draft', 'pending', 'future', 'private'];
        }
        if ($r['ids']) $query['post__in'] = array_map('intval', explode(',', $r['ids']));
        if ($r['month'] && preg_match('/^(\d{4})-(\d{2})$/', $r['month'], $month)) $query['date_query'] = [['year' => (int)$month[1], 'month' => (int)$month[2]]];
        if ($r['search']) $query['s'] = (string)$r['search'];
        foreach (['category', 'tag'] as $tax) if ($r[$tax]) $query['tax_query'][] = ['taxonomy' => $tax === 'tag' ? 'post_tag' : 'category', 'field' => 'slug', 'terms' => [(string)$r[$tax]]];
        $posts = new WP_Query($query);
        $response = new WP_REST_Response(['entries' => array_map('zof_entry', $posts->posts), 'total' => $posts->found_posts]);
        $response->header('Cache-Control', 'private, no-store');
        return $response;
    }]);
    register_rest_route('first-official/v1', '/comments/(?P<id>\d+)', ['methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ($r) {
        $post = get_post((int)$r['id']);
        if ($post && $post->post_status !== 'publish' && zof_preview_valid($r['preview'], $post->ID)) return ['open' => false, 'items' => []];
        if (!$post || $post->post_status !== 'publish' || $post->post_password !== '') return new WP_Error('not_found', 'Not found', ['status' => 404]);
        return ['open' => comments_open($post), 'items' => array_map(fn($c) => ['id' => (string)$c->comment_ID, 'parent' => (string)$c->comment_parent,
            'author' => $c->comment_author, 'html' => wpautop(esc_html($c->comment_content))], get_comments(['post_id' => $post->ID, 'status' => 'approve', 'order' => 'ASC']))];
    }]);
});

// Keep the upstream widget composition editable in native WordPress Appearance.
add_action('admin_init', function () {
    register_setting('first_official_template', 'first_official_widgets', ['sanitize_callback' => function ($input) {
        $existing = get_option('first_official_widgets', []);
        foreach ($existing as $area_index => &$area) foreach ($area['widgets'] as $widget_index => &$widget) {
            $changes = $input[$area_index]['widgets'][$widget_index] ?? [];
            $widget['title'] = sanitize_text_field($changes['title'] ?? $widget['title'] ?? '');
            $widget['enabled'] = !empty($changes['enabled']);
            if (isset($widget['props']['count'])) $widget['props']['count'] = max(1, min(100, absint($changes['count'] ?? $widget['props']['count'])));
            if ($widget['type'] === 'content' && isset($changes['text'])) $widget['content'] = [['_type' => 'block', '_key' => 'native-widget', 'style' => 'normal', 'children' => [['_type' => 'span', 'text' => sanitize_textarea_field($changes['text'])]]]];
        }
        return $existing;
    }]);
});
add_action('admin_menu', function () {
    add_theme_page('Template widgets', 'Template widgets', 'manage_options', 'first-official-widgets', function () {
        echo '<div class="wrap"><h1>Template widgets</h1><form method="post" action="options.php">';
        settings_fields('first_official_template');
        foreach (get_option('first_official_widgets', []) as $area_index => $area) {
            echo '<h2>' . esc_html($area['label'] ?? $area['name']) . '</h2><table class="form-table">';
            foreach ($area['widgets'] as $widget_index => $widget) {
                $name = 'first_official_widgets[' . $area_index . '][widgets][' . $widget_index . ']';
                echo '<tr><th scope="row">' . esc_html($widget['title'] ?? 'Content') . '</th><td><p><label>Title <input class="regular-text" name="' . esc_attr($name . '[title]') . '" value="' . esc_attr($widget['title'] ?? '') . '"></label></p>';
                echo '<p><label><input type="checkbox" name="' . esc_attr($name . '[enabled]') . '" value="1" ' . checked($widget['enabled'] ?? true, true, false) . '> Show this widget</label></p>';
                if (isset($widget['props']['count'])) echo '<p><label>Number of posts <input type="number" min="1" max="100" name="' . esc_attr($name . '[count]') . '" value="' . esc_attr($widget['props']['count']) . '"></label></p>';
                if ($widget['type'] === 'content') {
                    $text = implode("\n", array_map(fn($b) => implode('', array_column($b['children'] ?? [], 'text')), $widget['content'] ?? []));
                    echo '<p><label>Content<br><textarea class="large-text" rows="4" name="' . esc_attr($name . '[text]') . '">' . esc_textarea($text) . '</textarea></label></p>';
                }
                echo '</td></tr>';
            }
            echo '</table>';
        }
        submit_button();
        echo '</form></div>';
    });
});
