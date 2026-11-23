<?php
/** Import the pinned upstream seed once into a newly owned native SpacePress site. */
[$mode, $seed_file, $site] = $args;
if (!in_array($mode, ['starter', 'blog'], true) || realpath(ABSPATH) !== realpath($site)) WP_CLI::error('Site ownership mismatch.');
if (get_option('sp_official_mode')) WP_CLI::error('This site is already seeded; refusing to overwrite content.');
$seed = json_decode(file_get_contents($seed_file), true, 512, JSON_THROW_ON_ERROR);
function zof_seed_html($blocks) {
    $html = '';
    foreach ($blocks as $block) {
        if (($block['_type'] ?? '') !== 'block') WP_CLI::error('Unsupported upstream seed block.');
        $style = $block['style'] ?? 'normal';
        $tag = in_array($style, ['h1','h2','h3','h4','h5','h6','blockquote'], true) ? $style : 'p';
        $text = '';
        foreach ($block['children'] ?? [] as $span) {
            $part = esc_html($span['text'] ?? '');
            foreach ($span['marks'] ?? [] as $mark) {
                if ($mark === 'strong') $part = '<strong>' . $part . '</strong>';
                elseif ($mark === 'em') $part = '<em>' . $part . '</em>';
                elseif ($mark === 'code') $part = '<code>' . $part . '</code>';
                else foreach ($block['markDefs'] ?? [] as $def) if (($def['_key'] ?? '') === $mark && ($def['_type'] ?? '') === 'link') $part = '<a href="' . esc_url($def['href']) . '">' . $part . '</a>';
            }
            $text .= $part;
        }
        $name = str_starts_with($tag, 'h') ? 'heading' : ($tag === 'blockquote' ? 'quote' : 'paragraph');
        $level = $name === 'heading' ? ' {"level":' . substr($tag,1) . '}' : '';
        $html .= '<!-- wp:' . $name . $level . ' --><' . $tag . '>' . $text . '</' . $tag . '><!-- /wp:' . $name . ' -->';
    }
    return $html;
}
update_option('sp_official_mode', $mode);
update_option('blogname', $seed['settings']['title']);
update_option('blogdescription', $seed['settings']['tagline']);
update_option('sp_official_menus', $seed['menus']);
$locations = get_nav_menu_locations();
foreach ($seed['menus'] as $menu_seed) {
    $menu_id = wp_create_nav_menu($menu_seed['label']);
    if (is_wp_error($menu_id)) WP_CLI::error($menu_id->get_error_message());
    foreach ($menu_seed['items'] as $item) wp_update_nav_menu_item($menu_id, 0, ['menu-item-title' => $item['label'], 'menu-item-url' => $item['url'], 'menu-item-type' => 'custom', 'menu-item-status' => 'publish']);
    $locations[$menu_seed['name']] = $menu_id;
}
set_theme_mod('nav_menu_locations', $locations);
update_option('sp_official_widgets', $seed['widgetAreas']);
update_option('comment_moderation', 1);
update_option('comment_previously_approved', 0);
update_option('comments_notify', 0);
update_option('moderation_notify', 0);
foreach ($seed['taxonomies'] as $taxonomy) foreach ($taxonomy['terms'] as $term) {
    $result = wp_insert_term($term['label'], $taxonomy['name'] === 'tag' ? 'post_tag' : 'category', ['slug' => $term['slug']]);
    if (is_wp_error($result) && $result->get_error_code() !== 'term_exists') WP_CLI::error($result->get_error_message());
}
$bylines = [];
foreach ($seed['bylines'] ?? [] as $byline) {
    $term = wp_insert_term($byline['displayName'], 'sp_credit', ['slug' => $byline['slug']]);
    if (is_wp_error($term)) WP_CLI::error($term->get_error_message());
    $bylines[$byline['id']] = (int)$term['term_id'];
}
$receipt = [];
foreach ($seed['content'] as $collection => $entries) foreach ($entries as $index => $entry) {
    $id = wp_insert_post(['post_type' => 'sp_' . $collection, 'post_status' => $entry['status'] === 'published' ? 'publish' : 'draft',
        'post_title' => $entry['data']['title'], 'post_name' => $entry['slug'], 'post_author' => 1,
        'post_content' => zof_seed_html($entry['data']['content'] ?? []), 'post_date' => gmdate('Y-m-d H:i:s', time() - ($index + 1) * DAY_IN_SECONDS),
        'comment_status' => $mode === 'blog' && $collection === 'posts' ? 'open' : 'closed',
        'meta_input' => ['sp_excerpt' => $entry['data']['excerpt'] ?? '']], true);
    if (is_wp_error($id)) WP_CLI::error($id->get_error_message());
    foreach ($entry['taxonomies'] ?? [] as $taxonomy => $slugs) wp_set_object_terms($id, $slugs, $taxonomy === 'tag' ? 'post_tag' : 'category');
    foreach ($entry['bylines'] ?? [] as $credit) {
        wp_set_object_terms($id, [$bylines[$credit['byline']]], 'sp_credit', true);
        if (isset($credit['roleLabel'])) update_term_meta($bylines[$credit['byline']], 'sp_role', $credit['roleLabel']);
    }
    $receipt[] = ['id' => $id, 'collection' => $collection, 'slug' => $entry['slug'], 'image' => $entry['data']['featured_image']['$media'] ?? null];
}
echo wp_json_encode($receipt);
