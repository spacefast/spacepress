<?php

declare(strict_types=1);

/*
 * examples/drive-store, the shop that shows most of TypedPress at once, on WordPress-on-SQLite: built by
 * `typedpress build`, seeded from its content/drives/ the way a publish seeds it, served with php -S and
 * used the way a browser with scripts off uses it. Prints one JSON object of what each step saw
 * (tests/app_router.rs `drive_store_example_sells_on_wordpress`).
 *
 *   TP_WP_THEMES=1 php tests/php/drive_store.php <wp-content dir> <seed records dir>
 */

require __DIR__ . '/wp.php';

// Core's flood check (one comment per author per 15 seconds) would refuse the test's quick succession.
$site = wpSite('drive-store', ['wpContent' => $argv[1], 'users' => ['ann' => 'subscriber', 'bo' => 'subscriber'], 'muPlugins' => ['no-flood' => <<<'PHP'
    <?php
    add_filter('wp_is_comment_flood', '__return_false', PHP_INT_MAX);
    PHP]]);
wp_set_current_user(1);
$out = ['seed' => \TypedPress\Sync\Seed::run(\TypedPress\Wp\Runtime::plugin(), $argv[2])['drives'] ?? null];
$out['rows'] = array_column(\TypedPress\db()->findMany('drives', ['orderBy' => ['slug' => 'asc']]), 'slug');
$site->actAs(null);
$site->startServer();
$url = $site->url();

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body,
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

/** The text of every node $query finds in $html, whitespace collapsed. */
function texts(string $html, string $query): array
{
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?>' . $html);
    $out = [];
    foreach ((new DOMXPath($doc))->query($query) as $node) {
        $out[] = trim((string) preg_replace('/\s+/', ' ', $node->textContent));
    }
    return $out;
}

/** The form on $html that posts to a URL ending in $suffix: its action and its inputs. */
function form(string $html, string $suffix): array
{
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?>' . $html);
    foreach ($doc->getElementsByTagName('form') as $form) {
        if (str_ends_with($form->getAttribute('action'), $suffix)) {
            $fields = [];
            foreach ($form->getElementsByTagName('input') as $input) {
                $fields[] = [$input->getAttribute('name'), $input->getAttribute('type'), $input->getAttribute('value')];
            }
            return ['action' => $form->getAttribute('action'), 'fields' => $fields];
        }
    }
    throw new RuntimeException("no form posts to $suffix");
}

/**
 * Submits $form as a browser does (its hidden fields, then $values, form-encoded), then follows the
 * 303 with the flash cookie it set, plus the visitor's own cookie. Returns the page it came back to.
 */
function submit(array $form, array $values, string $cookie = ''): array
{
    $pairs = [];
    foreach ($form['fields'] as [$name, $type, $value]) {
        if ($type === 'hidden') {
            $pairs[] = rawurlencode($name) . '=' . rawurlencode($value);
        }
    }
    foreach ($values as $name => $value) {
        $pairs[] = rawurlencode($name) . '=' . rawurlencode((string) $value);
    }
    $session = $cookie === '' ? [] : ["Cookie: $cookie"];
    $post = fetch($form['action'], 'POST', [...$session, 'Content-Type: application/x-www-form-urlencoded'], implode('&', $pairs));
    $flash = explode(';', $post['headers']['set-cookie'][0] ?? '')[0];
    $cookies = implode('; ', array_filter([$cookie, $flash]));
    $location = $post['headers']['location'][0] ?? null;
    $back = $location === null ? ['body' => ''] : fetch($location, headers: $cookies === '' ? [] : ["Cookie: $cookies"]);
    return ['status' => $post['status'], 'path' => $location === null ? null : parse_url($location, PHP_URL_PATH), 'body' => $back['body']];
}

/** A signed-in browser's cookie for $who. */
function session(WpSite $site, string $who): string
{
    $id = $site->userId($who);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($id)->create($expires);
    return LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($id, $expires, 'logged_in', $token));
}

$cards = "//li[contains(@class,'card')]";

// The catalog, searched and filtered.
$home = fetch("$url/");
$out['catalog'] = [
    'status' => $home['status'],
    'title' => texts($home['body'], '//title'),
    'names' => texts($home['body'], "$cards//h2"),
    'links' => texts($home['body'], "$cards//h2/a/@href"),
    'feed link' => texts($home['body'], "//link[@type='application/rss+xml' and contains(@href,'tp_drives')]/@href") !== [],
];
$out['search'] = texts(fetch("$url/?q=samsung")['body'], "$cards//h2");
$out['filter'] = texts(fetch("$url/?media=nvme")['body'], "$cards//h2");

// A product page.
$page = fetch("$url/drives/wd-red-plus-4tb/");
$out['product'] = [
    'status' => $page['status'],
    'h1' => texts($page['body'], '//h1'),
    'stock' => texts($page['body'], "//aside[@class='buybox']//p[@class='muted']"),
    'reviews' => texts($page['body'], "//section[@class='reviews']//a"),
];

// A guest buys with scripts off: the order comes back on the page, and the stock goes down.
$buy = form($page['body'], '/actions/buy');
$sold = submit($buy, ['buyerName' => 'Guest Buyer', 'buyerEmail' => 'guest@example.test', 'quantity' => '1']);
$out['guest buy'] = [$sold['status'], $sold['path'], preg_replace('/[0-9A-F]{8}/', 'CODE', texts($sold['body'], "//p[@class='ok']")[0] ?? '')];
$out['stock after'] = texts(fetch("$url/drives/wd-red-plus-4tb/")['body'], "//aside[@class='buybox']//p[@class='muted']");
$out['over stock'] = texts(submit($buy, ['buyerName' => 'Greedy', 'buyerEmail' => 'g@example.test', 'quantity' => '3'])['body'], "//p[@class='error']");
// The buyer never sends a price: the action takes none (an unknown field is refused), and the hook sets it.
$priced = fetch("$url/__tp/api/v1/actions/buy", 'POST', ['Content-Type: application/json'], '{"drive":1,"buyerName":"X","buyerEmail":"x@example.test","total":1}');
$out['price from buyer'] = $priced['status'];

// A signed-in customer buys, then finds the order under My orders; nobody else sees it.
$ann = session($site, 'ann');
$samsung = fetch("$url/drives/samsung-870-evo-1tb/", headers: ["Cookie: $ann"]);
$annBuy = submit(form($samsung['body'], '/actions/buy'), ['buyerName' => 'Ann', 'buyerEmail' => 'ann@example.test', 'quantity' => '2'], $ann);
$out['ann buy'] = preg_replace('/[0-9A-F]{8}/', 'CODE', texts($annBuy['body'], "//p[@class='ok']")[0] ?? '');
$out['my orders'] = [
    'ann' => texts(fetch("$url/orders/", headers: ["Cookie: $ann"])['body'], '//tbody/tr/td[2]'),
    'bo' => texts(fetch("$url/orders/", headers: ['Cookie: ' . session($site, 'bo')])['body'], "//p[@class='empty']"),
];
$anon = fetch("$url/orders/");
$out['my orders signed out'] = [$anon['status'], str_contains($anon['headers']['location'][0] ?? '', '/wp-login.php')];

// Staff: the guard, shipping an order and restocking, each through its action.
$out['staff as customer'] = fetch("$url/staff/", headers: ["Cookie: $ann"])['status'];
$editor = session($site, 'editor');
$staff = fetch("$url/staff/", headers: ["Cookie: $editor"]);
$out['staff'] = ['status' => $staff['status'], 'to ship' => count(texts($staff['body'], '//table[1]//tbody/tr')), 'low' => texts($staff['body'], "//ul[@class='list']/li/span")];
$out['ship'] = preg_replace('/[0-9A-F]{8}/', 'CODE', texts(submit(form($staff['body'], '/actions/markShipped'), [], $editor)['body'], "//p[@class='ok']")[0] ?? '');
$out['restock'] = texts(submit(form($staff['body'], '/actions/restock'), ['quantity' => '4'], $editor)['body'], "//p[@class='ok']");
$out['movements'] = texts(fetch("$url/staff/", headers: ["Cookie: $editor"])['body'], '//table[last()]//tbody/tr/td[4]');
$restock = fetch("$url/__tp/api/v1/actions/restock", 'POST', ['Content-Type: application/json', 'Authorization: Basic ' . base64_encode($site->appPassword('ann'))], '{"drive":1,"quantity":1}');
$out['restock as customer'] = $restock['status'];
$orders = fetch("$url/__tp/api/v1/orders", headers: ['Authorization: Basic ' . base64_encode($site->appPassword('ann'))]);
$out['orders api as ann'] = array_column(json_decode($orders['body'], true)['data'] ?? [], 'buyerName');

// Reviews: a customer's first review is held and shown only to them; a signed-out visitor gets a link.
$seagate = fetch("$url/drives/seagate-exos-x16/", headers: ["Cookie: $ann"]);
$review = submit(form($seagate['body'], '/comments'), ['content' => 'Arrived well packed, SMART clean.'], $ann);
$out['review'] = [$review['status'], texts($review['body'], "//section[@class='reviews']//div[@class='typedpress-comment-body']")];
$out['review signed out'] = [
    texts(fetch("$url/drives/seagate-exos-x16/")['body'], "//section[@class='reviews']//div[@class='typedpress-comment-body']"),
    texts(fetch("$url/drives/seagate-exos-x16/")['body'], "//section[@class='reviews']//a"),
];

// WordPress's own RSS feed of the drives post type, linked from every page.
$feed = fetch("$url/?feed=rss2&post_type=tp_drives");
$xml = @simplexml_load_string($feed['body']);
$sorted = static function (array $list): array {
    sort($list);
    return $list;
};
$out['feed'] = [
    $feed['status'],
    strtok($feed['headers']['content-type'][0] ?? '', ';'),
    $xml === false ? null : $sorted(array_map('strval', $xml->xpath('//item/title'))),
    $xml === false ? null : $sorted(array_map(static fn ($l): string => (string) parse_url((string) $l, PHP_URL_PATH), $xml->xpath('//item/link'))),
];

// The shop settings global: the notice banner and the currency.
\TypedPress\db()->globalUpdate('shop', ['notice' => 'Demo shop: orders are fake.', 'currency' => 'EUR']);
$after = fetch("$url/");
$out['settings'] = [texts($after['body'], "//p[@class='notice']"), texts($after['body'], "$cards//strong[@class='price']")[0] ?? null];

// The price rule holds on the API too.
$bad = fetch("$url/__tp/api/v1/drives", 'POST', ['Content-Type: application/json', 'Authorization: Basic ' . base64_encode($site->appPassword('editor'))], '{"name":"X","brand":"B","model":"M","capacityGb":10,"price":1.234}');
$out['bad price'] = [$bad['status'], json_decode($bad['body'], true)['detail'] ?? $bad['body']];

// TypedPress Admin's classic list screen for a table labels its columns from `.ui({ label })`.
$screen = fetch("$url/wp-json/typedpress-admin/v1/screens/table-orders", headers: ['Authorization: Basic ' . base64_encode($site->appPassword('editor'))]);
$fields = json_decode($screen['body'], true)['view']['fields'] ?? [];
$out['orders screen'] = [$screen['status'], json_decode($screen['body'], true)['title'] ?? null, array_column($fields, 'label', 'id')];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), "\n";
$site->destroy();
