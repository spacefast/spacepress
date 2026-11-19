<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$profile = null;
$muPlugins = ['test-mail' => "<?php add_filter('pre_wp_mail', '__return_true');"];
if ($destination = getenv('TP_DRIVE_PROFILE')) {
    require __DIR__ . '/drive_store_profile.php';
    $profile = new DriveStoreProfile($destination);
    $muPlugins['drive-profile'] = DriveStoreProfile::PLUGIN;
}
$site = wpSite('drive-store', [
    'wpContent' => $argv[1], 'users' => ['ann' => 'subscriber', 'editor' => 'editor'],
    'muPlugins' => $muPlugins, 'server' => true,
]);
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

$db = $site->app()->db;
$admin = new \TypedPress\Viewer(['id' => $site->userId('admin'), 'name' => 'Admin', 'role' => 'admin']);
$guest = new \TypedPress\Viewer(null);
$catalog = $db->findMany('drives', ['orderBy' => ['slug' => 'asc']], $guest);
eq('a fresh installation seeds the Markdown drives', array_column($catalog, 'slug'), [
    'crucial-p3-2tb', 'samsung-870-evo-1tb', 'seagate-exos-x16', 'wd-red-plus-4tb',
]);
$drive = $catalog[2];
$id = $drive['id'];
$slug = $drive['slug'];
$path = "/drives/$slug/";
$native = wc_get_product($id);
check('the catalog row is a native Woo product', $native instanceof WC_Product_Simple);
eq('typed capacity is stored on the Woo product', [(int) $native->get_meta('_tp_field_capacityGb'), $drive['capacityGb']], [16000, 16000]);
eq('money is an exact decimal string', $drive['price'], '139.00');
eq('the public product masks its serial', $drive['serial'] ?? null, null);
eq('staff can read the typed inventory serial', $db->findFirst('drives', ['where' => ['id' => $id]], $admin)['serial'], 'DEMO-SEAGATE-EXOS-X16');
eq('new products start at zero Woo stock', [$native->managing_stock(), $native->get_stock_quantity()], [true, 0]);
eq('checkout is a real WordPress Page containing the native block', has_block('woocommerce/checkout', get_post(wc_get_page_id('checkout'))), true);

$catalogPage = fetch("$url/");
eq('catalog renders', $catalogPage['status'], 200);
check('catalog renders the native product', str_contains($catalogPage['body'], 'Seagate Exos X16'));
$filtered = fetch("$url/?media=ssd&q=Samsung");
eq('search and media filter render', $filtered['status'], 200);
check('search and media filter select the matching drive', str_contains($filtered['body'], 'Samsung 870 EVO') && !str_contains($filtered['body'], 'Seagate Exos X16'));
$missing = fetch("$url/drives/does-not-exist/");
eq('an unknown product slug returns 404', $missing['status'], 404);
eq('guest staff page redirects to sign-in', fetch("$url/staff/")['status'], 302);
eq('editors cannot use the Woo fulfilment page', fetch("$url/staff/", headers: ['Cookie: ' . session($site, 'editor')])['status'], 403);
check('catalog offers the WordPress product feed', str_contains($catalogPage['body'], 'post_type=product'));
foreach (['cart', 'checkout'] as $page) {
    $answer = fetch("$url/$page/");
    eq("the $page route renders", $answer['status'], 200);
    check("the $page response is private", str_contains($answer['headers']['cache-control'][0] ?? '', 'no-store'));
}
check('the app source page still renders', str_contains(fetch("$url/source/")['body'], 'Drive Store source'));

$staffCookie = session($site, 'admin');
$staff = fetch("$url/staff/", headers: ["Cookie: $staffCookie"]);
eq('admin can open the staff page', $staff['status'], 200);
check('the staff page links to TypedPress Admin', str_contains($staff['body'], '/wp-admin/new/screens/shipping'));
eq('editor cannot restock through the action', $site->call('POST', '/actions/restock', ['drive' => $id, 'quantity' => 2], as: 'editor')[0], 403);
[$status, $restocked] = $site->call('POST', '/actions/restock', ['drive' => $id, 'quantity' => 2], as: 'admin');
eq('restock action increments Woo inventory', [$status, $restocked['stock'] ?? null, wc_get_product($id)->get_stock_quantity()], [200, 2, 2]);

$detail = fetch("$url$path");
eq('native product URL renders', $detail['status'], 200);
check('native product page shows specs and live stock', str_contains($detail['body'], 'SMART power-on hours') && str_contains($detail['body'], '2 in stock') && str_contains($detail['body'], 'data-tp-live'));
check('an available drive offers add to cart', str_contains($detail['body'], 'Add to cart'));
check('the storefront does not print the inventory serial', !str_contains($detail['body'], 'DEMO-SEAGATE-EXOS-X16'));

$customerCookie = session($site, 'ann');
$review = fetch("$url$path", headers: ["Cookie: $customerCookie"]);
$reviewForm = form($review['body'], '/comments');
$posted = submit($reviewForm, ['content' => 'Arrived well packed.'], $customerCookie);
eq('a signed-in customer can post a review', $posted['status'], 303);
check('first review is held for moderation', str_contains($posted['body'], 'awaiting moderation'));
check('guests do not see the held review', !str_contains(fetch("$url$path")['body'], 'Arrived well packed.'));

$profile?->measure($site, 'catalog', '/');
$profile?->measure($site, 'catalog/search-and-filter', '/?media=ssd&q=Samsung');
$profile?->measure($site, 'product/in-stock', $path);
$profile?->measure($site, 'cart', '/cart/');
$profile?->measure($site, 'checkout', '/checkout/');

$order = wc_create_order();
$order->add_product(wc_get_product($id), 2);
$order->calculate_totals();
$order->update_status('processing');
$orderId = $order->get_id();
eq('native Woo order reduces stock', wc_get_product($id)->get_stock_quantity(), 0);
$record = $db->findFirst('orders', ['where' => ['id' => $orderId]], $admin);
eq('order() reads the native order and its lines', [$record['status'], $record['lines'][0]['product'], $record['lines'][0]['quantity']], ['processing', $id, 2]);
eq('order() keeps native records private', $site->call('GET', '/orders')[0], 401);
$moves = static fn () => array_map(static fn ($row) => [$row['reason'], (float) $row['change'], $row['order']], $db->findMany('stock_movements', ['orderBy' => ['id' => 'asc']], $admin));
eq('the activity table logs restock and checkout stock changes', $moves(), [['restock', 2.0, null], ['sale', -2.0, $orderId]]);
$sold = fetch("$url$path");
check('fresh product HTML reflects the Woo stock change', str_contains($sold['body'], 'Sold out') && !str_contains($sold['body'], 'Add to cart'));
$profile?->measure($site, 'product/sold-out', $path);
$profile?->measure($site, 'staff/processing', '/staff/', 200, $staffCookie);
$staff = fetch("$url/staff/", headers: ["Cookie: $staffCookie"]);
$shipped = submit(form($staff['body'], '/actions/markShipped'), [], $staffCookie);
clean_post_cache($orderId);
eq('staff form marks the native order shipped', [$shipped['status'], wc_get_order($orderId)->get_status()], [303, 'completed']);
check('the staff page confirms the order', str_contains($shipped['body'], 'marked shipped'));
eq('repeating the shipping action is safe', $site->call('POST', '/actions/markShipped', ['order' => $orderId], as: 'admin')[0], 200);

$order = wc_get_order($orderId);
$order->update_status('cancelled');
eq('Woo restores cancelled stock and the log records the return', [wc_get_product($id)->get_stock_quantity(), $moves()[2] ?? null], [2, ['return', 2.0, $orderId]]);
eq('typed product updates leave operational stock intact', $db->update('drives', ['powerOnHours' => 22000], ['id' => $id], true, $admin)[0]['powerOnHours'], 22000);
eq('a spec edit preserves the Woo stock count', wc_get_product($id)->get_stock_quantity(), 2);

$profile?->save();
finish('drive_store');
