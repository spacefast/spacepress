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
// The query API reads the same tree.
$out['api'] = array_map(static fn (array $r): array => [$r['slug'], $r['parent'] === null ? null : $byId[$r['parent']] ?? $r['parent'], $r['order']], \First\Seam::toPhp(\First\Seam::kindList('docs', ['orderBy' => ['order' => 'asc'], 'where' => ['parent' => null]], true)));

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
