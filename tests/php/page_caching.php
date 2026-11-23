<?php

declare(strict_types=1);

/*
 * What a page cache holds and what a write drops from it (tests/app_router.rs
 * `page_caches_drop_what_a_write_changed`): tests/fixtures/page-caching on WordPress with php -S, a
 * must-use plugin standing in for the host and recording each `sp_purge_urls` call. Every write is
 * followed by the page as the origin renders it then, so a purge the test expects is one a visitor
 * needs. Prints JSON.
 *
 *   SP_WP_THEMES=1 php tests/php/page_caching.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('page-caching', ['wpContent' => $argv[1], 'muPlugins' => ['host' => <<<'PHP'
    <?php
    add_action('sp_purge_urls', static function (array $paths): void {
        $GLOBALS['test_purges'][] = $paths;
    });
    add_action('plugins_loaded', static function (): void {
        if (!class_exists(\SpacePress\Wp\Connection::class)) {
            return;
        }
        \SpacePress\Wp\Connection::$observer = static function (string $sql): void {
            if (str_contains($sql, 'sp__app_reads')) {
                $GLOBALS['fixture_read_index_sql'] = 1 + ($GLOBALS['fixture_read_index_sql'] ?? 0);
            }
        };
        if (get_option('pagecaching_show_global')) {
            \SpacePress\Extensions::onRead(static function (array $rows, string $collection): array {
                if ($collection === 'drives') {
                    $currency = \SpacePress\db()->globalGet('shop')['currency'];
                    foreach ($rows as &$row) {
                        $row['name'] .= ' ' . $currency;
                    }
                    unset($row);
                }
                return $rows;
            });
        }
    });
    add_action('sp_app_rendered', static function (): void {
        header('X-Fixture-Rendered: 1');
        header('X-Fixture-Read-Index: ' . ($GLOBALS['fixture_read_index_sql'] ?? 0));
    });
    add_action('wp_footer', static function (): void {
        if (($_SERVER['HTTP_X_FIXTURE_LATE_COOKIE'] ?? null) === '1') {
            setcookie('fixture_footer', '1');
        }
    });
    add_action('wp_footer', static function (): void {
        if (wp_get_nav_menu_object('Fixture menu')) {
            wp_nav_menu(['menu' => 'Fixture menu', 'fallback_cb' => false]);
        }
    });
    PHP]]);
wp_set_current_user(1);
$db = \SpacePress\db();
$drive = static fn (string $name, string $media, float $price): int => (int) $db->insert('drives', ['name' => $name, 'slug' => strtolower($name), 'media' => $media, 'price' => $price, 'stock' => 3, 'status' => 'published'], true)[0]['id'];
$alpha = $drive('Alpha', 'nvme', 10);
$beta = $drive('Beta', 'hdd', 20);
$gamma = $drive('Gamma', 'ssd', 30);
add_option('pagecaching_store_notice', 'Open today');
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, array $requestHeaders = []): array
{
    $ch = curl_init($url);
    $headers = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_HTTPHEADER => $requestHeaders,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $headers[strtolower(trim($name))] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $body = (string) curl_exec($ch);
    preg_match_all('#<li>([^<]*)</li>#', $body, $items);
    preg_match('#<p class="(?:top|drive|about)">([^<]*)</p>#', $body, $line);
    preg_match('#data-currency="([^"]*)"#', $body, $currency);
    return [
        'status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
        'cache' => $headers['cache-control'] ?? null,
        'edge' => $headers['a8c-edge-cache'] ?? null,
        'rendered' => isset($headers['x-fixture-rendered']),
        'read index SQL' => isset($headers['x-fixture-read-index']) ? (int) $headers['x-fixture-read-index'] : null,
        'cookie' => $headers['set-cookie'] ?? null,
        'location' => isset($headers['location']) ? parse_url($headers['location'], PHP_URL_PATH) : null,
        'prebuilt' => $headers['x-spacepress-prebuilt'] ?? null,
        'menu' => str_contains($body, 'Fixture menu link'),
        'template' => str_contains($body, 'Fixture template body'),
        'rolled template' => str_contains($body, 'Template rollback probe'),
        'items' => $items[1],
        'line' => $line[1] ?? null,
        'currency' => $currency[1] ?? null,
        'markdown' => str_contains($headers['content-type'] ?? '', 'markdown') ? trim($body) : null,
    ];
}

global $wpdb;
$reads = "{$wpdb->prefix}sp__app_reads";
$index = static fn (): array => array_map(static fn (array $r): string => "{$r['kind']} " . ($r['item'] === '*' ? '*' : '#') . " {$r['url']}", $wpdb->get_results("SELECT DISTINCT kind, CASE WHEN item = '*' THEN '*' ELSE '#' END AS item, url FROM $reads ORDER BY url, kind, item", ARRAY_A));
/** The paths one write announced, sorted; null when it announced nothing. */
$announced = static function (callable $write): ?array {
    \SpacePress\Wp\Purges::flush(); // what setting up queued goes out first
    $GLOBALS['test_purges'] = [];
    wp_set_current_user(1);
    try {
        $write();
    } catch (\RuntimeException) {
    }
    \SpacePress\Wp\Purges::flush(); // the end of the request, for a write outside a transaction
    wp_set_current_user(0);
    $calls = $GLOBALS['test_purges'];
    if (count($calls) > 1) {
        throw new LogicException('one write announced ' . count($calls) . ' times');
    }
    $paths = $calls[0] ?? null;
    if ($paths !== null) {
        sort($paths);
    }
    return $paths;
};
$has = static fn (?array $paths, string ...$want): array => array_values(array_intersect($want, $paths ?? []));

$out = [];

// ---- a list read stays a list read, whatever it returned -----------------------------------
// One nvme drive: the filtered catalog and the top-priced page each read exactly one row.
$out['warm'] = [
    'catalog' => fetch("$url/catalog/"),
    'nvme' => fetch("$url/catalog/?media=nvme"),
    'none' => fetch("$url/catalog/?media=tape"),
    'top' => fetch("$url/top/"),
    'drive' => fetch("$url/drives/alpha/"),
    'about' => fetch("$url/about/"),
    'twin' => fetch("$url/catalog.md?media=nvme"),
    'option' => fetch("$url/option/"),
    'opaque' => fetch("$url/opaque/"),
];
$out['index'] = $index();
$out['redirect'] = fetch("$url/about");
$out['late cookie'] = fetch("$url/about/", ['X-Fixture-Late-Cookie: 1']);
$out['authorization'] = fetch("$url/about/", ['Authorization: Bearer fixture']);
$out['literal prebuild'] = [
    'paths' => array_column(\SpacePress\Render\Prebuilt::urls(\SpacePress\Wp\Runtime::plugin())['urls'], 'path'),
    'before' => fetch("$url/about/")['prebuilt'],
];
\SpacePress\Render\Prebuilt::build();
$out['literal prebuild']['after'] = fetch("$url/about/");
$out['literal prebuild']['authorization'] = fetch("$url/about/", ['Authorization: Bearer fixture']);
// A second nvme drive, also the most expensive one: it joins the filtered list and takes the top.
$delta = 0;
$grown = $announced(static function () use ($drive, &$delta): void {
    $delta = $drive('Delta', 'nvme', 99);
});
$out['grown'] = [
    'announced' => $has($grown, '/catalog/', '/catalog/?media=nvme', '/catalog/?media=tape', '/catalog.md?media=nvme', '/top/', '/about/', '/drives/alpha/'),
    'nvme' => fetch("$url/catalog/?media=nvme")['items'],
    'top' => fetch("$url/top/")['line'],
    'twin' => fetch("$url/catalog.md?media=nvme")['markdown'],
];
fetch("$url/catalog/?media=tape");

// ---- price and stock: the item's page and the lists, nothing else ---------------------------
$priced = $announced(static fn () => $db->update('drives', ['price' => 12.5, 'stock' => 0], ['id' => $alpha]));
$out['priced'] = [
    'announced' => $has($priced, '/catalog/', '/catalog/?media=nvme', '/top/', '/drives/alpha/', '/drives/beta/', '/about/'),
    'drive' => fetch("$url/drives/alpha/")['line'],
];

// ---- a rolled-back write: nothing announced, nothing changed -------------------------------
fetch("$url/top/");
fetch("$url/catalog/?media=nvme");
$rolled = $announced(static fn () => $db->transaction(static function () use ($db, $alpha): void {
    $db->update('drives', ['price' => 500], ['id' => $alpha]);
    throw new \RuntimeException('rollback');
}));
$out['rolled back'] = ['announced' => $rolled, 'drive' => fetch("$url/drives/alpha/")['line'], 'top' => fetch("$url/top/")['line'], 'index' => $index()];

// ---- a global two pages print ------------------------------------------------------------
fetch("$url/drives/beta/");
$global = $announced(static fn () => $db->globalUpdate('shop', ['currency' => 'EUR']));
$out['global'] = [
    'announced' => $has($global, '/catalog/', '/catalog/?media=nvme', '/drives/alpha/', '/drives/beta/', '/top/', '/about/'),
    'catalog' => fetch("$url/catalog/")['currency'],
    'drive' => fetch("$url/drives/alpha/")['line'],
];
// The same global saved from wp-admin (SCF's options page writes the option itself).
fetch("$url/catalog/?media=nvme");
$option = $announced(static fn () => update_option('sp_global_shop_currency', 'GBP'));
$out['global option'] = ['announced' => $has($option, '/catalog/', '/drives/alpha/', '/top/'), 'catalog' => fetch("$url/catalog/")['currency']];

$changed = $announced(static fn () => $db->transaction(static fn () => \SpacePress\Wp\Functions::tracked(
    static fn () => update_option('pagecaching_store_notice', 'Closed now')
)));
$out['option write'] = ['announced' => $has($changed, '/option/', '/option.md', '/about/'), 'line' => fetch("$url/option/")['line']];
$rolled = $announced(static fn () => $db->transaction(static function (): void {
    \SpacePress\Wp\Functions::tracked(static fn () => update_option('pagecaching_store_notice', 'Never shown'));
    throw new \RuntimeException('rollback');
}));
$out['option rollback'] = ['announced' => $rolled, 'line' => fetch("$url/option/")['line']];
$deleted = $announced(static fn () => delete_option('pagecaching_store_notice'));
$out['option delete'] = ['announced' => $has($deleted, '/option/', '/option.md'), 'line' => fetch("$url/option/")['line']];

// ---- query strings ---------------------------------------------------------------------------
// A parameter the page doesn't declare is not a page of its own: never shared, never recorded.
$before = $index();
$junk = [];
foreach (['/about/?junk=1', '/about/?junk=2', '/catalog/?junk=1', '/catalog/?media=nvme&junk=1', '/drives/alpha/?utm_source=x', '/catalog.md?junk=1'] as $path) {
    $seen = fetch($url . $path);
    $junk[$path] = [$seen['status'], $seen['cache'], $seen['edge']];
}
$out['junk'] = ['answers' => $junk, 'recorded' => array_values(array_diff($index(), $before))];
$edited = $announced(static fn () => $db->update('drives', ['stock' => 7], ['id' => $alpha]));
$out['junk']['announced'] = array_values(array_filter($edited ?? [], static fn (string $p): bool => str_contains($p, 'junk') || str_contains($p, 'utm_')));
// Declared parameters: each value is a page of its own, up to MAX_VARIANTS recorded per path. One
// more is answered, private, and recorded nowhere, so a write names a bounded list. A variant no
// render has confirmed for two cache windows gives its place up.
$max = \SpacePress\Render\Cache::MAX_VARIANTS;
$variants = [];
for ($i = 1; $i <= $max + 2; $i++) {
    $variants[] = fetch("$url/catalog/?media=v$i")['cache'];
}
$count = static fn (): int => (int) $wpdb->get_var("SELECT COUNT(DISTINCT url) FROM $reads WHERE url LIKE '/catalog/?%'");
$out['variants'] = [
    'max' => $max,
    'shared' => count(array_filter($variants, static fn (?string $c): bool => str_starts_with((string) $c, 'public'))),
    'private' => count(array_filter($variants, static fn (?string $c): bool => str_starts_with((string) $c, 'private'))),
    'recorded' => $count(),
];
$flood = $announced(static fn () => $db->update('drives', ['stock' => 8], ['id' => $alpha]));
$out['variants'] += [
    'announced' => count(array_filter($flood ?? [], static fn (string $p): bool => str_starts_with($p, '/catalog/?'))),
    'whole host' => $flood === ['/*'],
    // Recorded variants keep answering shared; the one over the limit stays private.
    'recorded one' => fetch("$url/catalog/?media=nvme")['cache'],
    'over the limit' => fetch("$url/catalog/?media=v" . ($max + 2))['cache'],
];
$wpdb->query($wpdb->prepare("UPDATE $reads SET seenAt = %s WHERE url LIKE '/catalog/?media=v%'", gmdate('Y-m-d\TH:i:s.000\Z', time() - 3 * \SpacePress\Render\Cache::WINDOW)));
$out['variants'] += [
    'after two windows' => fetch("$url/catalog/?media=v" . ($max + 2))['cache'],
    'recorded then' => $count(),
];

update_option('pagecaching_show_global', true);
$hooked = fetch("$url/top/");
$out['unknown read hook'] = ['line' => $hooked['line'], 'recorded global' => in_array('global:shop * /top/', $index(), true)];
$announced(static fn () => wp_insert_post([
    'post_type' => \SpacePress\Wp\Runtime::plugin()->schema->collection('drives')['wp']['postType'],
    'post_name' => 'unpublished',
    'post_title' => 'Unpublished',
    'post_status' => 'draft',
]));
$out['negative'] = [
    'before' => fetch("$url/drives/newly-published/"),
    'alternate' => fetch("$url/drives/newly-published"),
    'unpublished' => fetch("$url/drives/unpublished/"),
];
$published = $announced(static fn () => $drive('Newly-published', 'hdd', 1));
$out['negative'] += [
    'announced' => $has($published, '/drives/newly-published/', '/drives/newly-published.md'),
    'after' => fetch("$url/drives/newly-published/"),
];

$menu = wp_create_nav_menu('Fixture menu');
$out['menu'] = ['before' => fetch("$url/about/")['menu']];
$changed = $announced(static fn () => wp_update_nav_menu_item($menu, 0, [
    'menu-item-type' => 'custom', 'menu-item-title' => 'Fixture menu link',
    'menu-item-url' => home_url('/catalog/'), 'menu-item-status' => 'publish',
]));
$out['menu'] += ['announced' => $changed, 'after' => fetch("$url/about/")['menu']];

$template = 0;
$body = static fn (string $text): string => '<!-- wp:paragraph --><p>' . $text . '</p><!-- /wp:paragraph --><!-- wp:sp/page /-->';
$out['template'] = ['before' => fetch("$url/about/")['template']];
$changed = $announced(static function () use ($db, $body, &$template): void {
    $db->transaction(static function () use ($body, &$template): void {
        \SpacePress\Wp\Functions::tracked(static function () use ($body, &$template): void {
            $template = wp_insert_post([
                'post_type' => 'wp_template', 'post_name' => 'sp-blank', 'post_title' => 'Fixture template',
                'post_status' => 'publish', 'post_content' => $body('Fixture template body'),
            ]);
            wp_set_object_terms($template, get_stylesheet(), 'wp_theme');
        });
    });
});
$out['template'] += ['announced' => $changed, 'after' => fetch("$url/about/")['template']];
$rolled = $announced(static fn () => $db->transaction(static function () use ($body, $template): void {
    \SpacePress\Wp\Functions::tracked(static fn () => wp_update_post([
        'ID' => $template, 'post_content' => $body('Template rollback probe'),
    ]));
    throw new \RuntimeException('rollback');
}));
$afterRoll = fetch("$url/about/");
$out['template rollback'] = ['announced' => $rolled, 'previous' => $afterRoll['template'], 'attempted' => $afterRoll['rolled template']];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
