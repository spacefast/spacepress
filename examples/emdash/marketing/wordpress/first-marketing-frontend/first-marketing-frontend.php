<?php
/**
 * Plugin Name: First Marketing Frontend
 * Description: Public rendering for the editable EmDash marketing equivalent. Keeps the native WordPress admin.
 * License: MIT
 */
declare(strict_types=1);
namespace FirstMarketing;

function text(mixed $value): string { return esc_html((string) ($value ?? '')); }
function href(mixed $value): string { return esc_url((string) ($value ?? ''), ['http', 'https', 'mailto', 'tel']); }
function paragraphs(mixed $value): void {
    foreach (preg_split('/\n\s*\n/', trim((string) ($value ?? '')), -1, PREG_SPLIT_NO_EMPTY) as $p) echo '<p>' . nl2br(text($p)) . '</p>';
}
function lines(mixed $value): void {
    $items = preg_split('/\r?\n/', trim((string) ($value ?? '')), -1, PREG_SPLIT_NO_EMPTY);
    if (!$items) return;
    echo '<ul class="checklist">';
    foreach ($items as $item) echo '<li>' . text($item) . '</li>';
    echo '</ul>';
}
function image(mixed $id, string $caption = '', bool $priority = false): void {
    if (!$id) return;
    echo '<figure class="photo">' . wp_get_attachment_image((int) $id, 'large', false, ['loading' => $priority ? 'eager' : 'lazy']);
    if ($caption !== '') echo '<figcaption>' . text($caption) . '</figcaption>';
    echo '</figure>';
}
function button(mixed $label, mixed $url, bool $secondary = false): void {
    if (!$label || !$url || !href($url)) return;
    echo '<a class="button' . ($secondary ? ' secondary' : '') . '" href="' . href($url) . '">' . text($label) . ' <span aria-hidden="true">↗</span></a>';
}
function actions(array $s): void {
    echo '<div class="actions">';
    button($s['primary_cta_label'] ?? null, $s['primary_cta_url'] ?? null);
    button($s['secondary_cta_label'] ?? null, $s['secondary_cta_url'] ?? null, true);
    echo '</div>';
}
function heading(array $s, string $tag = 'h2'): void {
    if (!empty($s['eyebrow'])) echo '<p class="eyebrow">' . text($s['eyebrow']) . '</p>';
    if (!empty($s['headline'])) echo '<' . $tag . '>' . text($s['headline']) . '</' . $tag . '>';
    if (!empty($s['subheadline'])) echo '<div class="lead">' . (function () use ($s) { ob_start(); paragraphs($s['subheadline']); return ob_get_clean(); })() . '</div>';
}
function icon(string $name): string {
    return ['zap'=>'ϟ','shield'=>'◈','users'=>'♧','chart'=>'▥','code'=>'⌘','globe'=>'◎','heart'=>'♡','star'=>'☆','check'=>'✓','lock'=>'▣','clock'=>'◷','cloud'=>'☁','building'=>'▤','leaf'=>'❧','gauge'=>'◴','thermometer'=>'♨','plug'=>'↯','bell'=>'♧','file'=>'▱','sun'=>'☀','trend'=>'↗','email'=>'✉','support'=>'◎','sales'=>'↗','phone'=>'☎','chat'=>'☏','location'=>'⌖'][$name] ?? '◇';
}
function section(array $s, int $index): void {
    $layout = $s['layout'];
    $classes = 'section ' . $layout . (!empty($s['centered']) ? ' centered' : '') . (!empty($s['image_first']) ? ' image-first' : '');
    echo '<section class="' . esc_attr($classes) . '" data-layout="' . esc_attr($layout) . '" data-position="' . $index . '"' . (!empty($s['anchor_id']) ? ' id="' . esc_attr($s['anchor_id']) . '"' : '') . '>';
    switch ($layout) {
        case 'hero':
            if (!empty($s['eyebrow'])) {
                echo '<p class="eyebrow">';
                if (!empty($s['eyebrow_url'])) echo '<a href="' . href($s['eyebrow_url']) . '">';
                echo text($s['eyebrow']);
                if (!empty($s['eyebrow_url'])) echo ' ↗</a>';
                echo '</p>';
            }
            echo '<h1>' . text($s['headline']) . '</h1><div class="hero-row"><div class="lead">';
            paragraphs($s['subheadline'] ?? null); echo '</div>'; actions($s); echo '</div>';
            image($s['image'] ?? null, $s['image_caption'] ?? '', true);
            break;
        case 'logos':
            heading($s); echo '<ul class="logos-list" role="list">';
            foreach ($s['logos'] ?? [] as $row) {
                echo '<li>';
                if (!empty($row['logo'])) echo wp_get_attachment_image((int) $row['logo'], 'medium', false, ['alt' => $row['name']]);
                else echo text($row['name']);
                echo '</li>';
            }
            echo '</ul>'; break;
        case 'features':
        case 'contact':
            heading($s); echo '<div class="grid">';
            foreach ($s[$layout === 'features' ? 'features' : 'options'] ?? [] as $row) {
                echo '<article class="card"><span class="icon" aria-hidden="true">' . icon($row['icon']) . '</span><h3>' . text($row['title']) . '</h3>';
                paragraphs($row['description'] ?? null);
                if ($layout === 'contact') button($row['link_label'], $row['link_url'], true);
                echo '</article>';
            }
            echo '</div>'; break;
        case 'split':
            echo '<div class="split-copy">'; heading($s); paragraphs($s['body'] ?? null); lines($s['points'] ?? null); button($s['cta_label'] ?? null, $s['cta_url'] ?? null); echo '</div>';
            image($s['image'] ?? null, $s['image_caption'] ?? ''); break;
        case 'stats':
            heading($s); echo '<dl class="grid">';
            foreach ($s['stats'] ?? [] as $row) echo '<div><dt>' . text($row['label']) . '</dt><dd>' . text($row['value']) . '</dd></div>';
            echo '</dl>'; break;
        case 'testimonials':
            heading($s); echo '<div class="quotes">';
            foreach ($s['testimonials'] ?? [] as $i => $row) {
                echo '<figure class="quote ' . ($i === 0 ? 'featured' : '') . '"><blockquote>'; paragraphs($row['quote']); echo '</blockquote><figcaption>';
                if (!empty($row['avatar'])) echo wp_get_attachment_image((int) $row['avatar'], 'thumbnail', false, ['alt' => '']);
                else echo '<span class="initial" aria-hidden="true">' . text(mb_substr($row['author'], 0, 1)) . '</span>';
                echo '<span><strong>' . text($row['author']) . '</strong><br>' . text(implode(', ', array_filter([$row['role'] ?? null, $row['company'] ?? null]))) . '</span></figcaption></figure>';
            }
            echo '</div>'; break;
        case 'pricing':
            heading($s); echo '<div class="grid plans">';
            foreach ($s['plans'] ?? [] as $row) {
                echo '<article class="card plan' . (!empty($row['highlighted']) ? ' highlighted' : '') . '">';
                if (!empty($row['badge'])) echo '<span class="badge">' . text($row['badge']) . '</span>';
                echo '<h3>' . text($row['name']) . '</h3><p class="price">' . text($row['price']) . '</p><p>' . text($row['period'] ?? null) . '</p>';
                paragraphs($row['description'] ?? null); lines($row['features'] ?? null); button($row['cta_label'], $row['cta_url']); echo '</article>';
            }
            echo '</div>'; break;
        case 'faq':
            heading($s); echo '<div class="questions">';
            foreach ($s['items'] ?? [] as $row) { echo '<details><summary>' . text($row['question']) . '</summary><div>'; paragraphs($row['answer']); echo '</div></details>'; }
            echo '</div>'; break;
        case 'cta':
            echo '<div class="cta-copy">'; heading($s); paragraphs($s['body'] ?? null); actions($s); echo '</div>'; image($s['image'] ?? null); break;
        case 'text':
            heading($s); echo '<div class="prose">' . wp_kses_post(do_blocks($s['body'])) . '</div>'; break;
    }
    echo '</section>';
}

add_action('template_redirect', static function (): void {
    if (is_admin() || wp_doing_ajax() || wp_is_json_request() || is_feed() || is_robots() || is_trackback() || !in_array($_SERVER['REQUEST_METHOD'], ['GET', 'HEAD'], true)) return;
    if (!class_exists('First\\Db')) return;
    $db = \First\Wp\Plugin::instance()->db();
    if ($db->schema()->name() !== 'emdash-marketing') return;
    $path = trim((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
    $basePath = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
    if ($basePath !== '' && str_starts_with($path, $basePath)) $path = trim(substr($path, strlen($basePath)), '/');
    if (str_starts_with($path, 'wp-') || str_contains($path, '/')) return;
    if ($path === 'home') {
        $query = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY);
        wp_safe_redirect(home_url('/') . ($query !== '' ? '?' . $query : ''), 301); exit;
    }
    $viewer = new \First\Viewer(null);
    $page = $db->findFirst('pages', ['where' => ['slug' => $path === '' ? 'home' : rawurldecode($path)]], $viewer);
    $preview = isset($_GET['preview'], $_GET['p']) ? absint($_GET['p']) : 0;
    if ($preview && current_user_can('edit_post', $preview)) $page = $db->findFirst('pages', ['where' => ['id' => $preview]]);
    $site = $db->globalGet('site', $viewer);
    status_header($page || $path === '' ? 200 : 404);
    nocache_headers();
    remove_action('wp_head', '_wp_render_title_tag', 1);
    remove_action('wp_head', 'rel_canonical');
    remove_action('wp_head', 'wp_robots');
    require __DIR__ . '/render.php';
    exit;
}, 0);
