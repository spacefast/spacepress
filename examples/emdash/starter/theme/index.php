<?php
declare(strict_types=1);
$path = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$page = max(1, (int) ($_GET['page'] ?? 1));
$query = null;
$entry = null;
$title = get_bloginfo('name');
$description = get_bloginfo('description');
$notFound = false;
if ($path === 'rss.xml') {
    status_header(200);
    header('Content-Type: application/rss+xml; charset=UTF-8');
    echo '<?xml version="1.0" encoding="UTF-8"?>';
    echo '<rss version="2.0"><channel><title>' . esc_xml($title) . '</title><description>' . esc_xml($description) . '</description><link>' . esc_xml(home_url('/')) . '</link>';
    foreach (zp_query(['posts_per_page' => 20, 'no_found_rows' => true])->posts as $post) {
        echo '<item><title>' . esc_xml(get_the_title($post)) . '</title><link>' . esc_xml(zp_url($post)) . '</link><guid isPermaLink="true">' . esc_xml(zp_url($post)) . '</guid><pubDate>' . esc_xml(get_post_time('r', true, $post)) . '</pubDate><description>' . esc_xml(zp_excerpt($post)) . '</description></item>';
    }
    echo '</channel></rss>';
    return;
}
if ($path === '' && zp_mode() === 'blank') {
    $title = 'Welcome to TypedPress';
} elseif ($path === '' || $path === 'posts') {
    $title = $path === '' ? get_bloginfo('name') : 'All posts';
    $query = zp_query(['paged' => $page, 'posts_per_page' => $path === '' ? (zp_mode() === 'blog' ? 7 : 10) : 20]);
} elseif ($path === 'search') {
    $search = sanitize_text_field(wp_unslash($_GET['q'] ?? ''));
    $title = $search === '' ? 'Search' : 'Search: ' . $search;
    $query = $search === '' ? null : zp_query(['s' => $search, 'post_type' => [zp_type('posts'), zp_type('pages')], 'paged' => $page]);
} elseif (preg_match('~^(category|tag)/([^/]+)$~', $path, $match)) {
    $taxonomy = $match[1] === 'category' ? 'category' : 'post_tag';
    $term = get_term_by('slug', rawurldecode($match[2]), $taxonomy);
    if ($term) {
        $title = $term->name;
        $query = zp_query(['tax_query' => [['taxonomy' => $taxonomy, 'field' => 'term_id', 'terms' => $term->term_id]], 'paged' => $page]);
    } else $notFound = true;
} else {
    $kind = null; $slug = null;
    if (preg_match('~^posts/([^/]+)$~', $path, $match)) { $kind = 'posts'; $slug = $match[1]; }
    elseif (zp_mode() === 'blog' && preg_match('~^pages/([^/]+)$~', $path, $match)) { $kind = 'pages'; $slug = $match[1]; }
    elseif (zp_mode() !== 'blog' && !str_contains($path, '/')) { $kind = 'pages'; $slug = $path; }
    if ($kind !== null) $entry = zp_query(['post_type' => zp_type($kind), 'name' => sanitize_title(rawurldecode($slug)), 'has_password' => null, 'posts_per_page' => 1, 'no_found_rows' => true])->posts[0] ?? null;
    if ($entry) {
        $title = get_the_title($entry);
        if (!post_password_required($entry)) $description = (string) get_post_meta($entry->ID, 'tp_seoDescription', true) ?: zp_excerpt($entry);
    } else $notFound = true;
}
$GLOBALS['wp_query']->is_404 = $notFound;
if ($notFound) { status_header(404); $title = 'Page not found'; }
else status_header(200);
$seoTitle = $entry && !post_password_required($entry) ? (string) get_post_meta($entry->ID, 'tp_seoTitle', true) : '';
$accent = sanitize_hex_color(get_theme_mod('tp_accent', '#355e42')) ?: '#355e42';
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html(($seoTitle ?: $title) . ' — ' . get_bloginfo('name')); ?></title>
<meta name="description" content="<?php echo esc_attr($description); ?>">
<link rel="canonical" href="<?php echo esc_url(home_url('/' . $path)); ?>">
<link rel="alternate" type="application/rss+xml" title="RSS" href="<?php echo esc_url(home_url('/rss.xml')); ?>">
<?php wp_head(); ?>
<style>:root{--accent:<?php echo esc_html($accent); ?>}</style>
</head>
<body <?php body_class('publication-' . zp_mode()); ?>><?php wp_body_open(); ?>
<a class="skip-link" href="#content">Skip to content</a>
<header class="masthead frame">
<a class="brand" href="<?php echo esc_url(home_url('/')); ?>"><?php bloginfo('name'); ?></a>
<nav aria-label="Primary"><?php
if (has_nav_menu('primary')) wp_nav_menu(['theme_location' => 'primary', 'container' => false, 'depth' => 1]);
else { ?><a href="<?php echo esc_url(home_url('/posts')); ?>">Posts</a> <a href="<?php echo esc_url(home_url(zp_mode() === 'blog' ? '/pages/about' : '/about')); ?>">About</a> <a href="<?php echo esc_url(home_url('/rss.xml')); ?>">RSS</a><?php } ?>
</nav>
<form action="<?php echo esc_url(home_url('/search')); ?>" role="search"><label class="visually-hidden" for="query">Search posts and pages</label><input id="query" type="search" name="q" placeholder="Find a story…" value="<?php echo esc_attr(sanitize_text_field(wp_unslash($_GET['q'] ?? ''))); ?>"><button>Search</button></form>
</header>
<main id="content" class="frame">
<?php if ($notFound): ?>
<section class="intro"><p class="eyebrow">404</p><h1>Page not found</h1><p>This address has no published page. <a href="<?php echo esc_url(home_url('/')); ?>">Head home</a>.</p></section>
<?php elseif ($path === '' && zp_mode() === 'blank'): ?>
<section class="intro"><p class="eyebrow">Your next idea starts here</p><h1>Welcome to TypedPress</h1><p>Your site is ready. Open the <a href="<?php echo esc_url(admin_url()); ?>">admin panel</a> to start adding content.</p></section>
<?php elseif ($entry):
    $GLOBALS['post'] = $entry; setup_postdata($entry);
?>
<div class="reading-layout"><article class="story">
<header class="intro"><p class="eyebrow"><?php echo in_array($entry->post_type, ['tp_posts', 'post'], true) ? 'Story' : 'Page'; ?></p><h1><?php echo esc_html($title); ?></h1>
<?php if (!post_password_required($entry) && in_array($entry->post_type, ['tp_posts', 'post'], true)): ?>
<p class="byline"><?php echo esc_html(get_the_author_meta('display_name', (int) $entry->post_author)); ?> · <?php echo esc_html(get_the_date('', $entry)); ?> · <?php echo max(1, (int) ceil(str_word_count(wp_strip_all_tags($entry->post_content)) / 200)); ?> min read</p>
<?php zp_terms($entry, 'category'); zp_terms($entry, 'post_tag'); endif; ?>
</header>
<?php if (zp_cover($entry)) echo wp_get_attachment_image(zp_cover($entry), 'large', false, ['class' => 'hero-image']); ?>
<div class="prose"><?php the_content(); ?></div>
<?php edit_post_link('Edit this page', '<p>', '</p>', $entry->ID);
if (!post_password_required($entry) && zp_mode() === 'blog' && $entry->post_type === zp_type('posts')) {
    $comments = get_comments(['post_id' => $entry->ID, 'status' => 'approve', 'order' => 'ASC']);
    echo '<section class="comments"><h2>Conversation</h2><ol>';
    wp_list_comments(['style' => 'ol', 'short_ping' => true], $comments);
    echo '</ol>';
    if (comments_open($entry)) comment_form([], $entry->ID);
    echo '</section>';
}
wp_reset_postdata(); ?>
</article><?php if ($entry->post_type === zp_type('posts')) zp_sidebar(); ?></div>
<?php else: ?>
<section class="intro"><p class="eyebrow"><?php echo $path === '' ? 'A small publication, an open web' : 'The archive'; ?></p><h1><?php echo esc_html($title); ?></h1><?php if ($path === ''): ?><p><?php echo esc_html(get_bloginfo('description')); ?></p><?php endif; ?></section>
<div class="reading-layout"><section aria-label="Published content"><div class="cards"><?php
if ($query && $query->posts) foreach ($query->posts as $post) zp_card($post);
else echo '<p>' . ($path === 'search' ? 'No matching published content.' : 'No posts yet. Publish your first story in WordPress.') . '</p>';
?></div>
<?php if ($query && $query->max_num_pages > 1): ?>
<nav class="pagination" aria-label="Pagination">
<?php if ($page > 1): ?><a rel="prev" href="<?php echo esc_url(add_query_arg('page', $page - 1)); ?>">Newer posts</a><?php endif; ?>
<span>Page <?php echo $page; ?> of <?php echo (int) $query->max_num_pages; ?></span>
<?php if ($page < $query->max_num_pages): ?><a rel="next" href="<?php echo esc_url(add_query_arg('page', $page + 1)); ?>">Older posts</a><?php endif; ?>
</nav><?php endif; ?></section><?php if (zp_mode() !== 'blank') zp_sidebar(); ?></div>
<?php endif; ?>
</main>
<footer class="frame"><p><?php echo esc_html(get_theme_mod('tp_footer', 'Made with TypedPress. Published with care.')); ?></p><fieldset class="theme-controls"><legend>Color theme</legend><button type="button" data-theme="light" aria-pressed="false">Light</button><button type="button" data-theme="dark" aria-pressed="false">Dark</button><button type="button" data-theme="system" aria-pressed="true">System</button></fieldset><a href="<?php echo esc_url(admin_url()); ?>">WordPress admin</a></footer>
<?php wp_footer(); ?></body></html>
