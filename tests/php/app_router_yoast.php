<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';

function check(bool $pass, string $message): void
{
    if (!$pass) {
        throw new RuntimeException($message . "\n" . (isset($GLOBALS['site']) ? $GLOBALS['site']->debugLog() : ''));
    }
}

/** Parse the real document, including JSON-LD, without depending on whitespace or entity spelling. */
function document(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $html = (string) curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $dom = new DOMDocument();
    @$dom->loadHTML($html);
    $xpath = new DOMXPath($dom);
    $tags = [];
    foreach ($xpath->query('//head/meta[@name or @property]') as $tag) {
        $key = $tag->getAttribute('name') ?: $tag->getAttribute('property');
        $tags[$key][] = $tag->getAttribute('content');
    }
    $graph = [];
    foreach ($xpath->query('//script[@type="application/ld+json"]') as $script) {
        $json = json_decode($script->textContent, true, 512, JSON_THROW_ON_ERROR);
        foreach ($json['@graph'] ?? [] as $node) {
            $graph[is_array($node['@type']) ? $node['@type'][0] : $node['@type']] = $node;
        }
    }
    $canonical = $xpath->query('//head/link[@rel="canonical"]');
    $titles = $xpath->query('//head/title');
    check($titles->length === 1, "Expected one title at $url: $html");
    foreach (['description', 'robots', 'og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'twitter:card'] as $key) {
        check(count($tags[$key] ?? []) <= 1, "Duplicate $key at $url");
    }
    check($canonical->length <= 1, "Duplicate canonical at $url");
    return ['status' => $status, 'title' => $titles->item(0)->textContent, 'tags' => $tags, 'canonical' => $canonical->item(0)?->getAttribute('href'), 'graph' => $graph, 'html' => $html];
}

$site = wpSite('yoast', ['wpContent' => $argv[1], 'muPlugins' => [
    // Eager consumers must not leave the router using the original query's cached context.
    'early-seo' => '<?php add_action("wp", static function () { if (function_exists("YoastSEO")) YoastSEO()->meta->for_current_page()->title; });',
]]);
check(get_bloginfo('version') === WP_CORE_VERSION, 'Wrong WordPress fixture');
check(defined('WPSEO_VERSION') && WPSEO_VERSION === '28.8', 'Wrong Yoast fixture');
wp_set_current_user($site->userId('author'));
foreach (['hello', 'defaults', 'editor', 'explicit', 'robots', 'noindex', 'draft'] as $slug) {
    $row = \First\db()->insert('notes', [
        'title' => ucfirst($slug) . ' & news', 'slug' => $slug, 'body' => '<p>Public article body.</p>',
        'dek' => 'Public introduction', 'secret' => 'MASKED SEO SECRET', 'status' => $slug === 'draft' ? 'draft' : 'published',
    ], true)[0];
    $ids[$slug] = $row['id'];
}
\First\db()->insert('masked', ['title' => 'Visible title', 'slug' => 'hidden', 'body' => '<p>HIDDEN NATIVE BODY</p>', 'status' => 'published']);
// Exercise an explicit Yoast editor override and template replacements with no First value.
foreach (['title' => 'Editor %%title%% & %%sitename%%', 'metadesc' => 'Editor description', 'canonical' => $site->url() . '/editor-canonical', 'opengraph-title' => 'Editor social', 'bctitle' => 'Editor crumb'] as $key => $value) {
    update_post_meta($ids['editor'], '_yoast_wpseo_' . $key, $value);
}
foreach (['title' => 'Editorial title', 'metadesc' => 'Editorial description', 'canonical' => $site->url() . '/editorial-canonical', 'opengraph-title' => 'Editorial social', 'opengraph-description' => 'Editorial social description'] as $key => $value) {
    update_post_meta($ids['explicit'], '_yoast_wpseo_' . $key, $value);
}
update_post_meta($ids['robots'], '_yoast_wpseo_meta-robots-noindex', '1');
update_post_meta($ids['robots'], '_yoast_wpseo_meta-robots-nofollow', '1');
$site->actAs(null);
$site->startServer();
$url = $site->url();

$article = document("$url/notes/hello");
check($article['status'] === 200, 'Article unavailable: ' . $article['html']);
check($article['title'] === 'Hello & news', 'Explicit title escaped twice: ' . $article['title']);
check($article['tags']['description'] === ['Public introduction'], 'Masked metadata missing/leaked: ' . $article['html']);
check(!str_contains($article['html'], 'MASKED SEO SECRET'), 'Masked field leaked');
check($article['canonical'] === "$url/notes/hello", 'Wrong article canonical');
check($article['tags']['og:url'] === ["$url/notes/hello"], 'Wrong article social URL');
foreach (['Article', 'WebPage', 'BreadcrumbList'] as $type) {
    check(isset($article['graph'][$type]), "Missing $type");
    check(str_starts_with($article['graph'][$type]['@id'], "$url/notes/hello"), "Wrong $type ID");
}
check(html_entity_decode($article['graph']['Article']['headline'], ENT_QUOTES) === 'Hello & news', 'Wrong article source: ' . json_encode($article['graph']['Article']));
check($article['graph']['Article']['author']['name'] !== '', 'Missing Article author');
$crumbs = $article['graph']['BreadcrumbList']['itemListElement'];
check(array_map(static fn ($name) => html_entity_decode($name, ENT_QUOTES), array_column($crumbs, 'name')) === ['Home', 'Notes', 'Hello & news'], 'Dishonest breadcrumb hierarchy: ' . json_encode($crumbs));
check($crumbs[1]['item'] === "$url/notes", 'Wrong breadcrumb parent link');
check($article['graph']['WebPage']['url'] === $article['canonical'], 'WebPage canonical mismatch');
// An Article card cannot make an authorless collection post an Article.
wp_update_post(['ID' => $ids['hello'], 'post_author' => 0]);
$authorless = document("$url/notes/hello");
check(!isset($authorless['graph']['Article']), 'Authorless post became an Article');
wp_update_post(['ID' => $ids['hello'], 'post_author' => $site->userId('author')]);

$about = document("$url/about");
check($about['title'] === 'First & Yoast', 'Wrong static title');
check($about['tags']['description'] === ['About & details'], 'Wrong static description');
check($about['canonical'] === "$url/about", 'Wrong static canonical');
check($about['tags']['og:title'] === ['Social & title'], 'Wrong social title');
check($about['tags']['og:description'] === ['Social description'], 'Wrong social description');
check($about['tags']['og:image'] === ["$url/og.png"], 'Missing explicit image');
check($about['tags']['twitter:card'] === ['summary_large_image'], 'Wrong Twitter card');
check(str_contains($about['tags']['robots'][0], 'nofollow'), 'Missing nofollow');
check(!isset($about['graph']['Article']), 'Static page became an Article');
check(str_contains($about['html'], 'rel="help"'), 'Extra head link lost');

$defaults = document("$url/notes/defaults");
check(str_contains($defaults['title'], 'Defaults & news') && $defaults['title'] !== 'First test site', 'Omitted title replaced the Yoast default');
check($defaults['canonical'] === get_permalink($ids['defaults']), 'Omitted canonical replaced plugin default');
$editor = document("$url/notes/editor");
check($editor['title'] === 'Editor Editor & news & First test site', 'Editor title/variables lost: ' . $editor['title']);
check($editor['tags']['description'] === ['Editor description'], 'Editor description lost');
check($editor['tags']['og:title'] === ['Editor social'], 'Editor social override lost');
check($editor['canonical'] === "$url/editor-canonical", 'Editor canonical lost');
check($editor['graph']['WebPage']['url'] === $editor['canonical'], 'Editor schema canonical mismatch');
check(end($editor['graph']['BreadcrumbList']['itemListElement'])['name'] === 'Editor crumb', 'Editor breadcrumb override lost');
$explicit = document("$url/notes/explicit");
check($explicit['title'] === 'Editorial title', 'TSX title overrode the editor');
check($explicit['tags']['description'] === ['Editorial description'], 'TSX description overrode the editor');
check($explicit['canonical'] === "$url/editorial-canonical", 'TSX canonical overrode the editor');
check($explicit['graph']['WebPage']['url'] === $explicit['canonical'], 'Editorial canonical and schema differ');
check($explicit['tags']['og:title'] === ['Editorial social'], 'TSX social title overrode the editor');
check($explicit['tags']['og:description'] === ['Editorial social description'], 'TSX social description overrode the editor');
$robots = document("$url/notes/robots");
check(str_contains($robots['tags']['robots'][0], 'noindex') && str_contains($robots['tags']['robots'][0], 'nofollow'), 'Page defaults relaxed editor robots restrictions');
$aboutId = \First\Wp\RoutePages::instance()->pages()['about'];
update_post_meta($aboutId, '_yoast_wpseo_opengraph-image', "$url/editor-image.png");
$editorImage = document("$url/about");
check($editorImage['tags']['og:image'] === ["$url/editor-image.png"], 'Editor image replaced or duplicated by TSX');
delete_post_meta($aboutId, '_yoast_wpseo_opengraph-image');

$purges = [];
$editorPath = wp_parse_url(get_permalink($ids['editor']), PHP_URL_PATH);
add_action('first_purge_urls', static function (array $paths) use (&$purges): void { $purges = [...$purges, ...$paths]; });
\First\Wp\Purges::flush();
$purges = [];
update_post_meta($ids['editor'], '_yoast_wpseo_title', 'SEO-only edit');
\First\Wp\Purges::flush();
check(in_array($editorPath, $purges, true), 'SEO-only edit did not purge its page: ' . json_encode($purges));
check(document("$url/notes/editor")['title'] === 'SEO-only edit', 'SEO-only edit stayed stale');
$purges = [];
delete_post_meta($ids['editor'], '_yoast_wpseo_title');
\First\Wp\Purges::flush();
check(in_array($editorPath, $purges, true), 'Removing an SEO override did not purge its page');
$purges = [];
add_post_meta($ids['editor'], '_yoast_wpseo_title', 'New SEO override');
\First\Wp\Purges::flush();
check(in_array($editorPath, $purges, true), 'Adding an SEO override did not purge its page');
$purges = [];
update_post_meta($ids['editor'], 'unrelated_metadata', 'unrelated');
\First\Wp\Purges::flush();
check($purges === [], 'Unrelated metadata triggered an SEO purge');
$purges = [];
$notesPage = \First\Wp\RoutePages::instance()->pages()['notes'];
update_post_meta($notesPage, '_yoast_wpseo_bctitle', 'Journal');
\First\Wp\Purges::flush();
check(in_array('/*', $purges, true), 'Breadcrumb label edit did not invalidate descendant pages');
delete_post_meta($notesPage, '_yoast_wpseo_bctitle');
\First\Wp\Purges::flush();

WPSEO_Options::set('breadcrumbs-home', '');
$purges = [];
\First\Wp\Purges::flush();
check(in_array('/*', $purges, true), 'SEO option changes did not invalidate page metadata');
$withoutHome = document("$url/notes/hello");
check(count($withoutHome['graph']['BreadcrumbList']['itemListElement']) === 2, 'Disabled Home crumb was duplicated');
check($withoutHome['graph']['BreadcrumbList']['itemListElement'][0]['name'] === 'Notes', 'Virtual breadcrumb parent lost');
WPSEO_Options::set('breadcrumbs-home', 'Home');

// The adapter does not persist an alternate raw reader for viewer-qualified collections.
$repository = YoastSEO()->classes->get(\Yoast\WP\SEO\Repositories\Indexable_Repository::class);
check($repository->find_by_id_and_type($ids['hello'], 'post', false) === false, 'Collection indexable persisted');
check(!get_post_type_object('first_notes')->public, 'Collection visibility changed');
wp_update_post(['ID' => $ids['defaults'], 'post_title' => 'Updated default']);
$updated = document("$url/notes/defaults");
check(str_contains($updated['title'], 'Updated default'), 'Yoast reused stale collection metadata');
foreach (['hello', 'draft'] as $slug) {
    $ch = curl_init("$url/wp-json/yoast/v1/get_head?url=" . rawurlencode("$url/notes/$slug"));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30]);
    $head = (string) curl_exec($ch);
    check(curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 404, 'Yoast head API exposed a collection reader: ' . $head);
}

$noindex = document("$url/notes/noindex");
check(str_contains($noindex['tags']['robots'][0], 'noindex'), 'Explicit noindex lost');
foreach (['/notes/draft', '/notes/missing', '/absent'] as $path) {
    $missing = document($url . $path);
    check($missing['status'] === 404 && $missing['title'] === 'Not found', "Wrong refusal at $path");
    check(!isset($missing['graph']['Article']), "Article leaked at $path");
    check(!str_contains($missing['html'], 'Draft &amp; news'), "Private native data leaked at $path");
}
$masked = document("$url/masked/hidden");
check($masked['status'] === 200 && $masked['title'] === 'Visible title', 'SEO disabled a readable page');
check(!str_contains($masked['html'], 'HIDDEN NATIVE BODY') && $masked['graph'] === [], 'Native SEO readers exposed a masked body');
check(!str_contains($masked['html'], 'yoast-schema-graph'), 'Unsafe provider did not yield to the safe head fallback');
// A normal WordPress post keeps its own Yoast head. The adapter runs only for claimed routes.
wp_set_current_user(1);
$native = wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'Native post', 'post_content' => '<p>Native body</p>']);
$nativeDoc = document(get_permalink($native));
check($nativeDoc['status'] === 200 && isset($nativeDoc['graph']['Article']), 'Native WordPress SEO changed');

// First's unconditional title emitter also works under a classic theme without title-tag support.
mkdir($site->content . '/themes/classic-no-title');
file_put_contents($site->content . '/themes/classic-no-title/style.css', "/* Theme Name: Classic without title support */");
file_put_contents($site->content . '/themes/classic-no-title/index.php', '<?php wp_head(); the_content(); wp_footer();');
switch_theme('classic-no-title');
$classic = document("$url/about");
check($classic['title'] === 'First & Yoast' && $classic['tags']['description'] === ['About & details'], 'Classic theme SEO changed');

// The same compiled app, with Yoast deactivated, keeps First's existing document behavior.
deactivate_plugins('wordpress-seo/wp-seo.php');
$fallback = document("$url/about");
check($fallback['title'] === 'First & Yoast' && $fallback['tags']['description'] === ['About & details'], 'Plugin-absent fallback changed');
check($fallback['canonical'] === "$url/about" && $fallback['tags']['og:title'] === ['Social & title'], 'Plugin-absent social/canonical changed');
check(!str_contains($fallback['html'], 'yoast-schema-graph') && !str_contains($fallback['html'], 'optimized with the Yoast'), 'Yoast still active');
echo json_encode(['wordpress' => get_bloginfo('version'), 'yoast' => WPSEO_VERSION, 'article' => array_keys($article['graph']), 'breadcrumbs' => $crumbs, 'editor title' => $editor['title'], 'plugin absent' => $fallback['title']]), "\n";
$site->destroy();
