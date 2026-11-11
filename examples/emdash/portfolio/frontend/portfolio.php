<?php
/**
 * Plugin Name: First Portfolio frontend
 * Description: Public editorial portfolio for the First portfolio example. WordPress and First own all content.
 * License: MIT
 */

declare(strict_types=1);

namespace FirstPortfolio;

const TAGS = ['identity' => 'Identity', 'editorial' => 'Editorial', 'packaging' => 'Packaging', 'digital' => 'Digital', 'spatial' => 'Spatial', 'art-direction' => 'Art direction'];

function database(): \First\Db
{
    $plugin = \First\Wp\Plugin::instance();
    if ($plugin === null || $plugin->schema->name() !== 'portfolio') {
        throw new \RuntimeException('Activate the generated First portfolio plugin first.');
    }
    return $plugin->db();
}

function rows(string $collection, array $options = []): array
{
    return database()->findMany($collection, $options, new \First\Viewer(null));
}

function projects(array $where = [], int $limit = 12, int $offset = 0): array
{
    return rows('projects', ['where' => ['AND' => [['status' => 'published'], $where]], 'orderBy' => ['publishedAt' => 'desc', 'id' => 'desc'], 'limit' => $limit, 'offset' => $offset]);
}

function selected(): array
{
    $featured = projects(['featured' => true]);
    return $featured !== [] ? $featured : projects([], 6);
}

function href(string $path): string { return home_url($path); }
function e(mixed $text): string { return esc_html((string) ($text ?? '')); }
function link(string $path): string { return esc_url(href($path)); }
function external(mixed $value): string
{
    return is_string($value) && preg_match('~^https?://~i', $value) ? esc_url($value, ['http', 'https']) : '';
}

function socials(array $social): array
{
    $links = [];
    foreach (['twitter' => ['X (Twitter)', 'https://x.com/'], 'github' => ['GitHub', 'https://github.com/'], 'facebook' => ['Facebook', 'https://www.facebook.com/'], 'instagram' => ['Instagram', 'https://www.instagram.com/'], 'linkedin' => ['LinkedIn', 'https://www.linkedin.com/in/'], 'youtube' => ['YouTube', 'https://www.youtube.com/']] as $key => [$label, $prefix]) {
        $raw = trim($social[$key] ?? '');
        if ($raw === '') continue;
        if (preg_match('~^https?://~i', $raw)) $url = external($raw);
        else {
            $handle = ltrim($raw, '@');
            if ($handle === '') continue;
            if ($key === 'youtube') $prefix .= !str_starts_with($raw, '@') && preg_match('/^UC[\w-]{22}$/', $handle) ? 'channel/' : '@';
            $url = $prefix . rawurlencode($handle);
        }
        $links[] = ['label' => $label, 'href' => $url];
    }
    return $links;
}

function image(mixed $id, string $size = 'large', string $class = ''): string
{
    return is_numeric($id) && (int) $id > 0 ? wp_get_attachment_image((int) $id, $size, false, ['class' => $class, 'loading' => 'lazy']) : '';
}

function cards(array $items): void
{
    echo '<div class="project-grid" data-selected-work>';
    foreach ($items as $p) {
        echo '<article class="card" data-project="' . esc_attr($p['slug']) . '"><a href="' . link('/work/' . rawurlencode($p['slug'])) . '"><div class="plate">' . image($p['cover']) . '</div><div class="card-meta"><h3>' . e($p['title']) . '</h3><span>' . e($p['year']) . '</span></div></a><p class="muted">' . e($p['client']) . '</p></article>';
    }
    echo '</div>';
    if ($items === []) echo '<p>No projects yet.</p>';
}

function socialList(array $settings): void
{
    echo '<ul class="links" aria-label="Social profiles">';
    foreach (socials($settings['social'] ?? []) as $s) echo '<li><a href="' . esc_url($s['href']) . '">' . e($s['label']) . '</a></li>';
    echo '</ul>';
}

function layout(array $blocks, array $settings): void
{
    foreach ($blocks as $i => $b) {
        $h = $i === 0 && in_array($b['layout'], ['statement', 'contact'], true) ? 'h1' : 'h2';
        echo '<section class="block block-' . esc_attr($b['layout']) . '">';
        switch ($b['layout']) {
            case 'statement':
                echo '<p class="label">' . e($b['label']) . '</p><' . $h . ' class="statement">' . nl2br(e($b['text'])) . '</' . $h . '>';
                break;
            case 'selectedWork':
                echo '<div class="section-head"><h2>' . e($b['heading']) . '</h2><a href="' . link('/work') . '">All work ↗</a></div>';
                cards(selected());
                break;
            case 'clients':
                echo '<h2 class="label">' . e($b['heading']) . '</h2><ul class="clients">';
                foreach ($b['clients'] ?? [] as $client) echo '<li>' . e($client['name']) . '</li>';
                echo '</ul>';
                break;
            case 'contact':
                echo '<p class="label">' . e($b['label']) . '</p><' . $h . ' class="statement">' . e($b['heading']) . '</' . $h . '><p class="lead">' . e($b['intro']) . '</p><p class="email"><a href="mailto:' . esc_attr(sanitize_email($b['email'])) . '">' . e($b['email']) . '</a></p><dl><div><dt>' . e($b['emailLabel'] ?? 'Email') . '</dt><dd>' . e($b['email']) . '</dd></div>';
                foreach ($b['details'] ?? [] as $detail) echo '<div><dt>' . e($detail['label']) . '</dt><dd>' . e($detail['text']) . '<small>' . e($detail['note']) . '</small></dd></div>';
                echo '</dl>';
                socialList($settings);
        }
        echo '</section>';
    }
}

function pageBody(?array $page, array $settings, bool $home = false): void
{
    $blocks = $page['layout'] ?? [];
    if ($home && $blocks === []) {
        $items = selected();
        $years = array_filter(array_column($items, 'year'));
        sort($years);
        $range = $years ? (reset($years) === end($years) ? reset($years) : reset($years) . '–' . end($years)) : '';
        $blocks = [
            ['layout' => 'statement', 'text' => $settings['tagline'] ?: $settings['title'], 'label' => $range ? 'Selected work ' . $range : ''],
            ['layout' => 'selectedWork', 'heading' => 'Selected work'],
        ];
        $clients = array_values(array_unique(array_filter(array_column($items, 'client'))));
        if (count($clients) >= 2) $blocks[] = ['layout' => 'clients', 'heading' => 'Clients', 'clients' => array_map(static fn ($name) => ['name' => $name], $clients)];
    }
    $blocksFirst = isset($blocks[0]) && in_array($blocks[0]['layout'], ['statement', 'contact'], true);
    if (!$blocksFirst) echo '<h1' . ($home ? ' class="sr-only"' : '') . '>' . e($home ? $settings['title'] : $page['title']) . '</h1>';
    if ($blocksFirst) layout($blocks, $settings);
    if (!empty($page['body'])) echo '<div class="prose">' . do_blocks(wp_kses_post($page['body'])) . '</div>';
    elseif (!$home && $blocks === []) echo '<p>Content coming soon.</p>';
    if (!$blocksFirst) layout($blocks, $settings);
}

function work(): int
{
    $tag = isset($_GET['tag']) && is_string($_GET['tag']) ? wp_unslash($_GET['tag']) : '';
    $offset = isset($_GET['offset']) ? filter_var($_GET['offset'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 99999]]) : 0;
    if (($tag !== '' && !isset(TAGS[$tag])) || $offset === false || isset($_GET['cursor'])) return 404;
    $items = projects($tag === '' ? [] : ['tags' => ['has' => $tag]], 13, $offset);
    $more = count($items) > 12;
    $items = array_slice($items, 0, 12);
    echo '<h1>Work</h1><p class="lead">An index of every project, newest first.</p><nav class="filters" aria-label="Filter by discipline">';
    foreach (['' => 'All'] + TAGS as $slug => $label) echo '<a href="' . link('/work' . ($slug ? '?tag=' . rawurlencode($slug) : '')) . '"' . ($tag === $slug ? ' aria-current="page"' : '') . '>' . e($label) . '</a>';
    echo '</nav><ol class="work-list" start="' . ($offset + 1) . '">';
    foreach ($items as $p) {
        echo '<li data-project="' . esc_attr($p['slug']) . '"><a class="work-row" href="' . link('/work/' . rawurlencode($p['slug'])) . '"><span class="thumb">' . image($p['cover'], 'medium') . '</span><h2>' . e($p['title']) . '</h2><span>' . e($p['client']) . '</span><span>' . e(implode(', ', array_map(static fn ($t) => TAGS[$t] ?? $t, $p['tags']))) . '</span><span>' . e($p['year']) . '</span></a></li>';
    }
    echo '</ol>';
    if ($items === []) echo '<h2>' . ($tag ? 'No ' . e(TAGS[$tag]) . ' projects yet' : 'No projects yet') . '</h2><a href="' . link('/work') . '">View all projects</a>';
    if ($more) echo '<a class="more" rel="next" href="' . link('/work?' . http_build_query(['offset' => $offset + 12] + ($tag ? ['tag' => $tag] : []))) . '">More projects →</a>';
    return 200;
}

function caseStudy(array $p): void
{
    echo '<article data-case-study="' . esc_attr($p['slug']) . '"><a class="label" href="' . link('/work') . '">← Index</a><h1>' . e($p['title']) . '</h1><div class="case-intro"><p class="lead">' . e($p['summary']) . '</p><dl><div><dt>Client</dt><dd>' . e($p['client']) . '</dd></div><div><dt>Year</dt><dd>' . e($p['year']) . '</dd></div><div><dt>Disciplines</dt><dd>';
    foreach ($p['tags'] as $tag) echo '<a href="' . link('/work?tag=' . rawurlencode($tag)) . '">' . e(TAGS[$tag] ?? $tag) . '</a> ';
    echo '</dd></div>';
    if ($url = external($p['website'])) echo '<div><dt>Website</dt><dd><a target="_blank" rel="noopener noreferrer" href="' . $url . '">' . e(wp_parse_url($url, PHP_URL_HOST)) . ' ↗<span class="sr-only"> (opens in a new tab)</span></a></dd></div>';
    echo '</dl></div><div class="cover">' . image($p['cover'], 'full') . '</div><div class="prose">' . do_blocks(wp_kses_post($p['body'] ?? '')) . '</div><div class="gallery">';
    $figures = array_values(array_filter($p['gallery'] ?? [], static fn ($g) => !empty($g['image'])));
    foreach ($figures as $i => $g) {
        $half = $i % 3 === 2 || ($i % 3 === 1 && $i < count($figures) - 1);
        echo '<figure class="' . ($half ? 'half' : 'full') . '">' . image($g['image'], 'full') . '<figcaption><span class="label">' . str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT) . '</span> ' . e($g['caption']) . '</figcaption></figure>';
    }
    echo '</div>';
    $older = empty($p['publishedAt']) ? projects([], 1) : projects(['OR' => [['publishedAt' => ['lt' => $p['publishedAt']]], ['AND' => [['publishedAt' => $p['publishedAt']], ['id' => ['lt' => $p['id']]]]]]], 1);
    if ($older) echo '<nav class="next-project"><span class="label">Next project</span><a rel="next" href="' . link('/work/' . rawurlencode($older[0]['slug'])) . '">' . e($older[0]['title']) . ' →</a></nav>';
    echo '</article>';
}

function rss(array $settings): void
{
    header('Content-Type: application/rss+xml; charset=utf-8');
    header('Cache-Control: public, max-age=0, must-revalidate');
    $x = static fn ($value) => htmlspecialchars((string) $value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    echo '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>' . $x($settings['title']) . '</title><description>' . $x($settings['tagline'] ?: $settings['title']) . '</description><link>' . $x(href('/')) . '</link><atom:link href="' . $x(href('/rss.xml')) . '" rel="self" type="application/rss+xml"/><language>en-us</language><lastBuildDate>' . gmdate(DATE_RSS) . '</lastBuildDate>';
    foreach (projects([], 20) as $p) {
        if (empty($p['publishedAt'])) continue;
        $url = href('/work/' . rawurlencode($p['slug']));
        echo '<item><title>' . $x($p['title']) . '</title><link>' . $x($url) . '</link><guid isPermaLink="true">' . $x($url) . '</guid><pubDate>' . gmdate(DATE_RSS, strtotime($p['publishedAt'])) . '</pubDate><description>' . $x($p['summary']) . '</description></item>';
    }
    echo '</channel></rss>';
}

add_filter('post_type_link', static function (string $url, \WP_Post $post): string {
    if ($post->post_type === 'first_projects') return href('/work/' . $post->post_name);
    if ($post->post_type === 'first_pages') return href($post->post_name === 'home' ? '/' : '/' . $post->post_name);
    return $url;
}, 10, 2);

add_action('template_redirect', function (): void {
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) return;
    $path = rawurldecode((string) wp_parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
    $prefix = rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
    $path = '/' . trim(substr($path, strlen($prefix)), '/');
    if ($path === '/home') { wp_safe_redirect(href('/') . (!empty($_SERVER['QUERY_STRING']) ? '?' . $_SERVER['QUERY_STRING'] : ''), 301); exit; }
    if (!class_exists(\First\Wp\Plugin::class)) return;
    $buffer = false;
    try {
        $settings = database()->globalGet('settings', new \First\Viewer(null));
        if ($path === '/rss.xml') { status_header(200); rss($settings); exit; }
        $p = null;
        $preview = null;
        $previewId = ($_GET['preview'] ?? '') === 'true' && isset($_GET['p']) ? absint($_GET['p']) : 0;
        if ($previewId > 0 && current_user_can('edit_post', $previewId)) {
            $type = get_post_type($previewId);
            if (in_array($type, ['first_projects', 'first_pages'], true)) {
                $preview = database()->findFirst($type === 'first_projects' ? 'projects' : 'pages', ['where' => ['id' => $previewId]], new \First\Viewer(\First\Wp\WpAuth::current()));
                if ($preview !== null) $path = $type === 'first_projects' ? '/work/' . $preview['slug'] : ($preview['slug'] === 'home' ? '/' : '/' . $preview['slug']);
            }
        }
        if (preg_match('~^/work/([^/]+)$~', $path, $m)) $p = projects(['slug' => $m[1]], 1)[0] ?? null;
        $page = !str_starts_with($path, '/work') ? (rows('pages', ['where' => ['slug' => $path === '/' ? 'home' : ltrim($path, '/')], 'limit' => 1])[0] ?? null) : null;
        if ($preview !== null) {
            if (get_post_type($previewId) === 'first_projects') $p = $preview;
            else $page = $preview;
        }
        if ($path !== '/' && $path !== '/work' && $p === null && $page === null && !str_starts_with($path, '/work/')) return;
        $status = str_starts_with($path, '/work/') && $p === null ? 404 : 200;
        ob_start();
        $buffer = true;
        if ($preview !== null) echo '<p class="preview-notice">Preview — only editors can see unpublished content.</p>';
        if ($status === 404) echo '<h1>Page not found</h1><a href="' . link('/work') . '">Back to work</a>';
        elseif ($path === '/work') {
            $status = work();
            if ($status === 404) echo '<h1>Page not found</h1><a href="' . link('/work') . '">Back to work</a>';
        } elseif ($p !== null) caseStudy($p);
        else pageBody($page, $settings, $path === '/');
        $body = ob_get_clean();
        $buffer = false;
        status_header($status);
        header('Content-Type: text/html; charset=utf-8');
        nocache_headers();
        $entry = $p ?? $page;
        $title = $entry['seo']['title'] ?? ($path === '/work' ? 'Work' : ($entry['title'] ?? $settings['title']));
        if ($path === '/') $title = $entry['seo']['title'] ?? $settings['title'];
        if ($status === 404) $title = 'Page not found';
        $fullTitle = $title === $settings['title'] ? $title : $title . ' ' . ($settings['separator'] ?: '—') . ' ' . $settings['title'];
        $description = $entry['seo']['description'] ?? ($p['summary'] ?? $settings['tagline']);
        $cover = $p ? wp_get_attachment_url((int) $p['cover']) : false;
        $asset = plugin_dir_url(__FILE__);
        $theme = in_array($_COOKIE['theme'] ?? '', ['light', 'dark'], true) ? $_COOKIE['theme'] : '';
        ?><!doctype html>
<html lang="en" class="<?= esc_attr($theme) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><?= e($fullTitle) ?></title>
  <meta name="description" content="<?= esc_attr($description ?? '') ?>">
  <link rel="canonical" href="<?= link($path) ?>">
  <meta property="og:title" content="<?= esc_attr($fullTitle) ?>">
  <meta property="og:description" content="<?= esc_attr($description ?? '') ?>">
  <meta property="og:type" content="<?= $p ? 'article' : 'website' ?>">
  <meta property="og:url" content="<?= link($path) ?>"><?php if ($cover): ?>
  <meta property="og:image" content="<?= esc_url($cover) ?>">
<?php endif; if ($preview !== null || !empty($entry['seo']['noindex'])): ?>
  <meta name="robots" content="noindex,follow">
<?php endif; ?>
  <link rel="alternate" type="application/rss+xml" title="<?= esc_attr($settings['title']) ?>" href="<?= link('/rss.xml') ?>">
  <link rel="stylesheet" href="<?= esc_url($asset . 'style.css') ?>">
  <script defer src="<?= esc_url($asset . 'theme.js') ?>"></script>
</head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="frame site-header"><a class="brand" href="<?= link('/') ?>"><?= !empty($settings['logo']) ? image($settings['logo'], 'medium') : e($settings['title']) ?></a>
    <nav aria-label="Main navigation">
<?php foreach ($settings['navigation'] ?? [] as $nav): ?><a href="<?= esc_url($nav['href']) ?>"><?= e($nav['label']) ?></a>
<?php endforeach; ?>
</nav>
</header>
  <main id="main" class="frame" tabindex="-1"><?= $body ?></main>
  <footer class="frame">
    <div class="footer-cta"><h2>Have a project in mind?</h2>
<?php foreach ($settings['footer'] ?? [] as $nav): ?><a href="<?= esc_url($nav['href']) ?>"><?= e($nav['label']) ?> ↗</a>
<?php endforeach; ?>
</div>
    <div class="footer-grid"><p><?= e($settings['tagline']) ?></p><?php socialList($settings); ?><div><p class="label">Appearance</p><div class="themes" aria-label="Appearance">
<?php foreach (['light', 'dark', 'system'] as $choice): ?><button type="button" data-theme="<?= $choice ?>" aria-pressed="<?= ($theme ?: 'system') === $choice ? 'true' : 'false' ?>"><?= ucfirst($choice) ?></button>
<?php endforeach; ?>
</div></div></div>
    <p class="wordmark" aria-hidden="true"><?= e($settings['title']) ?></p>
    <div class="footer-bottom"><p>© <?= gmdate('Y') ?> <?= e($settings['title']) ?></p><a href="<?= esc_url(admin_url()) ?>">Edit in WordPress</a><a href="<?= link('/rss.xml') ?>">RSS</a></div>
  </footer>
</body>
</html><?php
        exit;
    } catch (\Throwable $error) {
        if ($buffer) ob_end_clean();
        error_log('First Portfolio: ' . $error->getMessage());
        status_header(503);
        header('Retry-After: 5');
        echo 'The portfolio could not be loaded. Please try again.';
        exit;
    }
}, 1);
