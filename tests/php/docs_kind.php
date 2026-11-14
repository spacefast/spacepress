<?php

declare(strict_types=1);

/*
 * A docs section as a hierarchical kind, on WordPress over HTTP (tests/app_router.rs
 * `docs_kind_*`): the fixture tests/fixtures/docs-kind as built, seeded from the records a hosted
 * compile wrote for its content/docs/ folder tree, and served by php -S. Prints one JSON object.
 *
 *   FIRST_WP_THEMES=1 php tests/php/docs_kind.php <wp-content dir> <seed records dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('docs-kind', ['wpContent' => $argv[1], 'users' => ['chief' => 'editor']]);
$out = [];
$out['seed'] = \First\Sync\Seed::run(\First\Wp\Runtime::plugin(), $argv[2]);
$site->startServer();
$url = $site->url();

function fetch(string $url, array $headers = []): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $text = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}

/** What a docs page shows: its heading, tree, table of contents, pager and title. */
function doc(array $r): array
{
    $html = new DOMDocument();
    @$html->loadHTML('<?xml encoding="utf-8"?>' . $r['body']);
    $x = new DOMXPath($html);
    $texts = static fn (string $q): array => array_map(static fn (DOMNode $n): string => trim($n->textContent), iterator_to_array($x->query($q)));
    $tree = static function (DOMNode $ul) use (&$tree, $x): array {
        $out = [];
        foreach ($x->query('./li', $ul) as $li) {
            $a = $x->query('./a', $li)->item(0);
            $mark = $li->getAttribute('class');
            $item = [trim((string) $a?->textContent) . ($mark !== '' ? " [$mark]" : '') => parse_url((string) $a?->getAttribute('href'), PHP_URL_PATH)];
            $below = $x->query('./ul', $li)->item(0);
            if ($below !== null) {
                $item['children'] = $tree($below);
            }
            $out[] = $item;
        }
        return $out;
    };
    $root = $x->query('//nav[@class="tree"]/ul')->item(0);
    preg_match('#<title>(.*?)</title>#s', $r['body'], $t);
    return [
        'status' => $r['status'],
        'title' => html_entity_decode($t[1] ?? '', ENT_QUOTES),
        'h1' => $texts('//article/h1'),
        'tree' => $root === null ? null : $tree($root),
        'toc' => array_map(static fn (DOMNode $a): string => $a->getAttribute('href') . ' ' . trim($a->textContent) . ' ' . $a->parentNode->getAttribute('class'), iterator_to_array($x->query('//aside[@class="toc"]//a'))),
        'anchors' => array_map(static fn (DOMNode $h): string => $h->nodeName . '#' . $h->getAttribute('id'), iterator_to_array($x->query('//article//*[self::h2 or self::h3]'))),
        'prev' => array_map(static fn (DOMNode $a): string => trim($a->textContent) . ' ' . parse_url($a->getAttribute('href'), PHP_URL_PATH), iterator_to_array($x->query('//footer//a[@rel="prev"]'))),
        'next' => array_map(static fn (DOMNode $a): string => trim($a->textContent) . ' ' . parse_url($a->getAttribute('href'), PHP_URL_PATH), iterator_to_array($x->query('//footer//a[@rel="next"]'))),
        'cache' => $r['headers']['cache-control'][0] ?? null,
    ];
}

$cookie = static function (string $user) use ($site): string {
    $id = $site->userId($user);
    return 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, time() + 3600, 'logged_in'));
};

// The rows as WordPress stores them: a Page-like tree in post_parent and menu_order.
global $wpdb;
$type = \First\Wp\Runtime::plugin()->schema->collection('docs')['wp']['postType'];
$rows = $wpdb->get_results($wpdb->prepare("SELECT ID, post_name, post_parent, menu_order, post_status FROM {$wpdb->posts} WHERE post_type = %s AND post_status NOT IN ('auto-draft', 'inherit') ORDER BY post_name", $type), ARRAY_A);
$byId = array_column($rows, 'post_name', 'ID');
foreach ($rows as $row) {
    $out['stored'][$row['post_name']] = [($byId[$row['post_parent']] ?? null), (int) $row['menu_order'], $row['post_status']];
}
$out['type hierarchical'] = is_post_type_hierarchical($type);

$out['introduction'] = doc(fetch("$url/docs/introduction"));
$out['install'] = doc(fetch("$url/docs/guides/install"));
$out['space'] = doc(fetch("$url/docs/guides/deploy/space"));
$out['reference'] = doc(fetch("$url/docs/reference"));
$out['guides'] = doc(fetch("$url/docs/guides"));
// A draft is a 404 for visitors, and is in no visitor's tree or pager, an editor's included.
$out['roadmap'] = fetch("$url/docs/guides/roadmap")['status'];
$out['roadmap as editor'] = doc(fetch("$url/docs/guides/roadmap", [$cookie('chief')]));
$out['install as editor'] = doc(fetch("$url/docs/guides/install", [$cookie('chief')]));
// A path that isn't the item's own: the wrong parent, a missing page, the slug alone.
$out['wrong parent'] = fetch("$url/docs/reference/install")['status'];
$out['missing'] = fetch("$url/docs/guides/nothing")['status'];
// The optional catch-all's empty match: no item, so not this page (the landing page is an app page).
$out['landing'] = fetch("$url/docs")['status'];
$out['slug alone'] = [fetch("$url/docs/install")['status'], fetch("$url/docs/install")['headers']['location'][0] ?? null];
// Its Markdown twin.
$out['twin'] = [fetch("$url/docs/guides/install.md")['status'], fetch("$url/docs/guides/install.md")['body']];
$out['twin draft'] = fetch("$url/docs/guides/roadmap.md")['status'];
// WordPress's own address for an item is the kind's URL.
$space = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'space'", $type));
$out['permalink'] = parse_url((string) get_permalink($space), PHP_URL_PATH);

// An editor moves a page in wp-admin: parent and order are the post's own, so the tree follows.
wp_set_current_user($site->userId('chief'));
$reference = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'reference'", $type));
$guides = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'guides'", $type));
wp_update_post(['ID' => $reference, 'post_parent' => $guides, 'menu_order' => 0]);
wp_set_current_user(0);
$out['moved'] = doc(fetch("$url/docs/guides/reference"));
$out['moved old'] = [fetch("$url/docs/reference")['status']];
// A published page under a draft: unreachable like its parent, so not served at a path that names the draft.
$roadmap = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'roadmap'", $type));
wp_set_current_user($site->userId('chief'));
$under = wp_insert_post(['post_type' => $type, 'post_status' => 'publish', 'post_title' => 'Later', 'post_name' => 'later', 'post_parent' => $roadmap]);
wp_set_current_user(0);
$out['under a draft'] = [fetch("$url/docs/guides/roadmap/later")['status'], fetch("$url/docs/guides/roadmap/later.md")['status']];
wp_delete_post($under, true);
// A WordPress Page with a doc's slug: the doc's URL is still the doc, not a redirect loop.
$page = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Introduction', 'post_name' => 'introduction']);
$out['page with a doc slug'] = [fetch("$url/docs/introduction")['status'], doc(fetch("$url/docs/introduction"))['h1']];
wp_delete_post($page, true);
// A published page with a slug a sibling elsewhere has: both are served, each at its own path.
wp_set_current_user($site->userId('chief'));
$twin = wp_insert_post(['post_type' => $type, 'post_status' => 'publish', 'post_title' => 'Install again', 'post_name' => 'install', 'post_parent' => $reference]);
wp_set_current_user(0);
$out['same slug elsewhere'] = [
    doc(fetch("$url/docs/guides/reference/install"))['h1'],
    doc(fetch("$url/docs/guides/install"))['h1'],
];
// Headings beside a block whose markup changes per render (a gallery's per-request ids): the
// table of contents and the page's anchors still agree.
$intro = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'introduction'", $type));
$wpdb->update($wpdb->posts, ['post_content' => get_post_field('post_content', $intro) . "\n\n<!-- wp:gallery {\"linkTo\":\"none\"} -->\n<figure class=\"wp-block-gallery has-nested-images columns-default is-cropped\"></figure>\n<!-- /wp:gallery -->"], ['ID' => $intro]);
clean_post_cache($intro);
$gallery = doc(fetch("$url/docs/introduction"));
$out['headings beside a gallery'] = [$gallery['toc'], $gallery['anchors']];

// Heading ids follow GitHub's rule: each case's id as github-slugger gives it. Prints the ones that differ.
$ids = json_decode((string) file_get_contents(dirname(__DIR__) . '/fixtures/docs-kind/heading-ids.json'), true, flags: JSON_THROW_ON_ERROR);
$out['heading ids'] = array_values(array_filter(array_map(static fn (array $c): ?array => \First\Content\Nav::slug($c[0]) === $c[1] ? null : [$c[0], $c[1], \First\Content\Nav::slug($c[0])], $ids['cases'])));
$out['heading id cases'] = count($ids['cases']);
// A heading with its own id keeps it, and no generated id repeats it; the rest number around it.
$own = ("<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Why</h2>\n<!-- /wp:heading -->\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\" id=\"why\">Mine</h2>\n<!-- /wp:heading -->\n<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Why</h2>\n<!-- /wp:heading -->");
$out['own ids'] = array_map(static fn (\First\JsObject $h): string => $h->p['id'], \First\Content\Nav::headings(['content' => $own], 'content')->a);
// The query API reads the same tree.
$out['api'] = array_map(static fn (array $r): array => [$r['slug'], $r['parent'] === null ? null : $byId[$r['parent']] ?? $r['parent'], $r['order']], \First\Seam::toPhp(\First\Seam::kindList('docs', ['orderBy' => ['order' => 'asc'], 'where' => ['parent' => null]], true)));

// Components in Markdown: the file's tags are the app's blocks, stored as blocks, rendered through
// the components on the route, and written back as the same tags.
$installPost = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'install'", $type));
$stored = (string) get_post_field('post_content', $installPost);
$out['blocks stored'] = array_values(array_map(static fn (array $b): array => [$b['blockName'], $b['attrs'], array_map(static fn (array $i): ?string => $i['blockName'], $b['innerBlocks'])], array_filter(parse_blocks($stored), static fn (array $b): bool => $b['blockName'] !== null)));
$out['blocks registered'] = array_values(array_filter(array_keys(WP_Block_Type_Registry::get_instance()->get_all_registered()), static fn (string $n): bool => str_starts_with($n, 'docskind/')));
$page = fetch("$url/docs/guides/install");
preg_match('#<aside class="callout callout-warning".*?</aside>#s', $page['body'], $callout);
preg_match('#<span class="badge">.*?</span>#s', $page['body'], $badge);
$out['blocks rendered'] = [$page['status'], preg_replace('/\s+/', ' ', $callout[0] ?? ''), $badge[0] ?? null];
$out['blocks back'] = \First\Sync\Markdown::fromBlocks($stored);
$out['blocks twin'] = fetch("$url/docs/guides/install.md")['body'];
// An editor changes a prop in the block editor: the file's tag follows.
$changed = str_replace('{"type":"warning","title":"Before you start"}', '{"type":"note","title":"Before you start"}', $stored);
$out['blocks edited back'] = \First\Sync\Markdown::fromBlocks($changed);
// What a Markdown file can't say about a block is refused with the reason, never stored half.
foreach ([
    'unknown tag' => "<Tabs>\nx\n</Tabs>\n",
    'unknown prop' => "<Callout type=\"note\" colour=\"red\">\nx\n</Callout>\n",
    'enum' => "<Callout type=\"danger\">\nx\n</Callout>\n",
    'required' => "<Callout>\nx\n</Callout>\n",
    'number' => "<Badge label=\"x\" count=\"three\" />\n",
    'unclosed' => "<Callout type=\"note\">\nx\n",
] as $case => $markdown) {
    try {
        \First\Sync\Markdown::toBlocks($markdown);
        $out['blocks refused'][$case] = null;
    } catch (\First\HttpError $e) {
        $out['blocks refused'][$case] = $e->getMessage();
    }
}
// A tag inside a code fence is code, not a block.
$out['blocks fenced'] = \First\Sync\Markdown::toBlocks("```md\n<Callout type=\"note\">\n```\n");

// Code blocks (docs/decisions/2026-11-13-code-blocks.md): highlighted on the route, with titles,
// marked lines and a tab group, no script; written back as the same fences.
$setup = fetch("$url/docs/guides/setup");
$html = new DOMDocument();
@$html->loadHTML('<?xml encoding="utf-8"?>' . $setup['body']);
$x = new DOMXPath($html);
$text = static fn (?DOMNode $n): ?string => $n === null ? null : trim($n->textContent);
$out['code'] = [
    'status' => $setup['status'],
    'titles' => array_map($text, iterator_to_array($x->query('//figcaption[@class="first-code-title"]'))),
    'keywords' => array_map($text, iterator_to_array($x->query('//pre[contains(@class, "language-ts")]//span[@class="hljs-keyword"]'))),
    'marked' => array_map($text, iterator_to_array($x->query('//span[contains(@class, "first-code-marked")]'))),
    'tabs' => array_map($text, iterator_to_array($x->query('//div[@class="first-code-group"]/label'))),
    'tab inputs' => $x->query('//div[@class="first-code-group"]/input[@type="radio"]')->length,
    'panels' => array_map(static fn (DOMNode $n): string => trim($n->textContent), iterator_to_array($x->query('//div[@class="first-code-group"]/figure'))),
    'plain' => $text($x->query('//pre[contains(@class, "language-text")]')->item(0)),
    'plain spans' => $x->query('//pre[contains(@class, "language-text")]//span[starts-with(@class, "hljs")]')->length,
    'stylesheet' => $x->query('//link[@id="first-code-css"]')->length,
    'scripts' => array_values(array_filter(array_map(static fn (DOMNode $n): string => (string) $n->getAttribute('src'), iterator_to_array($x->query('//script[@src]'))), static fn (string $s): bool => str_contains($s, 'code'))),
];
$css = fetch($x->query('//link[@id="first-code-css"]')->item(0)?->getAttribute('href') ?? "$url/none");
$out['code css'] = [$css['status'], str_contains($css['body'], '@media (prefers-color-scheme: dark)'), str_contains($css['body'], '.first-code .hljs-keyword')];
$setupPost = (int) $wpdb->get_var($wpdb->prepare("SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_name = 'setup'", $type));
$out['code back'] = \First\Sync\Markdown::fromBlocks((string) get_post_field('post_content', $setupPost));

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
