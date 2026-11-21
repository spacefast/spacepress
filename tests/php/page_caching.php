<?php

declare(strict_types=1);

/*
 * What a page cache holds and what a write drops from it (tests/app_router.rs
 * `page_caches_drop_what_a_write_changed`): tests/fixtures/page-caching on WordPress with php -S, a
 * must-use plugin standing in for the host and recording each `tp_purge_urls` call. Every write is
 * followed by the page as the origin renders it then, so a purge the test expects is one a visitor
 * needs. Prints JSON.
 *
 *   TP_WP_THEMES=1 php tests/php/page_caching.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('page-caching', ['wpContent' => $argv[1], 'muPlugins' => ['host' => <<<'PHP'
    <?php
    add_action('tp_purge_urls', static function (array $paths): void {
        $GLOBALS['test_purges'][] = $paths;
    });
    PHP]]);
wp_set_current_user(1);
$db = \TypedPress\db();
$drive = static fn (string $name, string $media, float $price): int => (int) $db->insert('drives', ['name' => $name, 'slug' => strtolower($name), 'media' => $media, 'price' => $price, 'stock' => 3, 'status' => 'published'], true)[0]['id'];
$alpha = $drive('Alpha', 'nvme', 10);
$beta = $drive('Beta', 'hdd', 20);
$gamma = $drive('Gamma', 'ssd', 30);
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url): array
{
    $ch = curl_init($url);
    $headers = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
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
        'items' => $items[1],
        'line' => $line[1] ?? null,
        'currency' => $currency[1] ?? null,
        'markdown' => str_contains($headers['content-type'] ?? '', 'markdown') ? trim($body) : null,
    ];
}

global $wpdb;
$reads = "{$wpdb->prefix}tp__app_reads";
$index = static fn (): array => array_map(static fn (array $r): string => "{$r['kind']} " . ($r['item'] === '*' ? '*' : '#') . " {$r['url']}", $wpdb->get_results("SELECT DISTINCT kind, CASE WHEN item = '*' THEN '*' ELSE '#' END AS item, url FROM $reads ORDER BY url, kind, item", ARRAY_A));
/** The paths one write announced, sorted; null when it announced nothing. */
$announced = static function (callable $write): ?array {
    \TypedPress\Wp\Purges::flush(); // what setting up queued goes out first
    $GLOBALS['test_purges'] = [];
    wp_set_current_user(1);
    try {
        $write();
    } catch (\RuntimeException) {
    }
    \TypedPress\Wp\Purges::flush(); // the end of the request, for a write outside a transaction
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
];
$out['index'] = $index();
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
$option = $announced(static fn () => update_option('tp_global_shop_currency', 'GBP'));
$out['global option'] = ['announced' => $has($option, '/catalog/', '/drives/alpha/', '/top/'), 'catalog' => fetch("$url/catalog/")['currency']];

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
$max = \TypedPress\Render\Cache::MAX_VARIANTS;
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
$wpdb->query($wpdb->prepare("UPDATE $reads SET seenAt = %s WHERE url LIKE '/catalog/?media=v%'", gmdate('Y-m-d\TH:i:s.000\Z', time() - 3 * \TypedPress\Render\Cache::WINDOW)));
$out['variants'] += [
    'after two windows' => fetch("$url/catalog/?media=v" . ($max + 2))['cache'],
    'recorded then' => $count(),
];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
