<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$site = wpSite('commerce', ['wpContent' => $argv[1], 'users' => ['ed' => 'editor'], 'server' => true, 'muPlugins' => [
    'cache-probe' => '<?php function batcache_cancel(): void { if (!headers_sent()) { header("X-Test-Batcache-Cancel: yes"); } }',
    'deferred-payment' => <<<'PHP'
<?php
add_action('woocommerce_rest_checkout_process_payment_with_context', static function ($context, $result): void {
    if (empty($context->payment_data['defer'])) { return; }
    $result->set_status('success');
    $result->set_redirect_url($context->order->get_checkout_order_received_url());
}, 10, 2);
PHP,
]]);
$plugin = $site->plugin();
$db = $site->app()->db;
$admin = new \TypedPress\Viewer(['id' => $site->userId('admin'), 'name' => 'Admin', 'role' => 'admin']);
$guest = new \TypedPress\Viewer(null);
$products = $db->findMany('products', ['orderBy' => ['id' => 'asc']], $guest);
eq('a fresh installation seeds both native products', count($products), 2);
$mug = array_values(array_filter($products, static fn ($p) => $p['sku'] === 'MUG-BLUE'))[0];
$guide = array_values(array_filter($products, static fn ($p) => $p['sku'] === 'GUIDE-PDF'))[0];
eq('public catalog retains download names and ids', [$guide['downloads'][0]['id'], $guide['downloads'][0]['name']], ['field-guide', 'Field guide']);
check('public catalog does not disclose backing download locations', !array_key_exists('file', $guide['downloads'][0]));
check('administrators can read backing locations', is_string($db->findFirst('products', ['where' => ['id' => $guide['id']]], $admin)['downloads'][0]['file'] ?? null));
eq('price is an exact decimal string', $mug['price'], '24.00');
eq('source currency is live without admin setup', get_woocommerce_currency(), 'EUR');
eq('source country is live', WC()->countries->get_base_country(), 'PL');
eq('source terms resolve to native term identities', get_term($mug['categories'][0], 'product_cat')->name, 'Home');
eq('categories load through with', $db->findFirst('products', ['where' => ['id' => $mug['id']], 'with' => ['categories' => true]], $guest)['categories'][0]['name'], 'Home');
$child = $db->insert('categories', ['name' => 'Child category', 'parent' => $mug['categories'][0]], true, $admin)[0];
problem('distinct categories cannot claim the same sync identity', fn () => $db->insert('categories', ['name' => 'Duplicate identity category', 'uid' => $child['uid']], true, $admin), 409, 'unique_violation', '/uid');
eq('a refused duplicate identity creates no term', $db->findFirst('categories', ['where' => ['name' => 'Duplicate identity category']]), null);
$sameUidTag = $db->insert('tags', ['name' => 'Independent taxonomy identity', 'uid' => $child['uid']], true, $admin)[0];
eq('UID ownership is scoped to its taxonomy', $sameUidTag['uid'], $child['uid']);
$db->delete('tags', ['id' => $sameUidTag['id']], false, $admin);
$categoryOrder = [$child['id'], $mug['categories'][0]];
$categorySort = get_taxonomy('product_cat')->sort;
$orderedProduct = $db->update('products', ['categories' => $categoryOrder], ['id' => $mug['id']], true, $admin)[0];
eq('category replacement returns submitted order', $orderedProduct['categories'], $categoryOrder);
eq('category order survives a fresh read', $db->findFirst('products', ['where' => ['id' => $mug['id']]])['categories'], $categoryOrder);
eq('sync exports categories in the submitted order', \TypedPress\Sync\Wire::encode('products', [$orderedProduct])[0]['record']['fields']['categories'], [$child['uid'], get_term_meta($mug['categories'][0], '_tp_uid', true)]);
eq('product writes preserve Woo taxonomy sorting configuration', get_taxonomy('product_cat')->sort, $categorySort);
$cleared = $db->update('products', ['categories' => [], 'tags' => []], ['id' => $mug['id']], true, $admin)[0];
eq('clearing product categories returns Woo default category normalization', $cleared['categories'], [(int) get_option('default_product_cat')]);
eq('normalized categories are the persisted native product categories', wc_get_product($mug['id'])->get_category_ids(), $cleared['categories']);
eq('product tags can be cleared completely', $cleared['tags'], []);
$db->update('products', ['categories' => $mug['categories'], 'tags' => $mug['tags']], ['id' => $mug['id']], false, $admin);
$termWire = \TypedPress\Sync\Wire::encode('categories', [$child])[0]['record'];
eq('term parents sync through portable UIDs', $termWire['fields']['parent'], get_term_meta($mug['categories'][0], '_tp_uid', true));
check('native taxonomy registration is retained', get_taxonomy('product_cat')->cap->manage_terms === 'manage_product_terms');
check('source enables COD', isset(WC()->payment_gateways()->get_available_payment_gateways()['cod']));
$zones = WC_Shipping_Zones::get_zones();
eq('source shipping zones are present', array_column($zones, 'zone_name'), ['Poland', 'Germany']);
foreach (['woocommerce_custom_orders_table_enabled', 'woocommerce_custom_orders_table_data_sync_enabled'] as $option) {
    update_option($option, 'yes');
    $refused = false;
    try { \TypedPress\Commerce\Module::checkOrderStorage(); } catch (RuntimeException $e) { $refused = str_contains($e->getMessage(), 'legacy order storage'); }
    check('existing HPOS or synchronization is refused without overriding ' . $option, $refused && get_option($option) === 'yes');
    // As a must-use plugin the early policy leaves this to the runtime: throwing there would take wp-admin down.
    require dirname($plugin->dir, 2) . '/mu-plugins/typedpress-commerce.php';
    update_option($option, 'no');
}
check('Woo is told the app does not support HPOS', in_array(basename($plugin->dir) . '/' . basename($plugin->dir) . '.php', \Automattic\WooCommerce\Utilities\FeaturesUtil::get_compatible_plugins_for_feature('custom_order_tables')['incompatible'], true));
foreach (['/%63art', '/%63heckout', '/%63heckout/order-received/123', '//checkout/'] as $path) {
    check('encoded or normalized private route stays private: ' . $path, \TypedPress\Commerce\Module::privatePath($plugin, $path));
}
update_option('woocommerce_checkout_pay_endpoint', 'pay');
eq('custom Woo endpoint resolves to checkout', \TypedPress\Commerce\Module::routePath($plugin, '/checkout/pay/123'), '/checkout');
eq('custom Woo endpoint populates the canonical query variable', get_query_var('order-pay'), '123');
delete_option('woocommerce_checkout_pay_endpoint');
check('Woo checkout is a real Page containing its native block', ($checkout = \TypedPress\Commerce\Module::checkoutPage($plugin)) > 0 && has_block('woocommerce/checkout', get_post($checkout)));
$checkoutLookups = 0;
wp_cache_delete($checkout, 'posts');
$countLookup = static function (string $sql) use (&$checkoutLookups, $checkout, $wpdb): string {
    if (str_contains($sql, "FROM $wpdb->posts WHERE ID = $checkout")
        || (str_contains($sql, $wpdb->postmeta) && str_contains($sql, \TypedPress\Wp\ContentPages::META))) {
        $checkoutLookups++;
    }
    return $sql;
};
add_filter('query', $countLookup);
for ($i = 0; $i < 3; $i++) {
    eq('Woo resolves the stored checkout Page', wc_get_page_id('checkout'), $checkout);
}
remove_filter('query', $countLookup);
eq('repeated checkout Page reads make one cold post lookup', $checkoutLookups, 1);

$account = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Customer account',
    'post_name' => 'customer-account', 'post_content' => '[woocommerce_my_account]']);
update_option('woocommerce_myaccount_page_id', $account);
check('the native account permalink and its endpoints are private', \TypedPress\Commerce\Module::privatePath($plugin, '/customer-account/orders/'));
$guestRequest = static function ($client, string $path, array $headers = [], ?array $data = null) use ($site): array {
    $responseHeaders = [];
    curl_setopt_array($client, [
        CURLOPT_URL => $site->url() . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POST => $data !== null,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$responseHeaders): int {
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) { $responseHeaders[strtolower($parts[0])] = trim($parts[1]); }
            return strlen($line);
        },
    ]);
    if ($data !== null) { curl_setopt($client, CURLOPT_POSTFIELDS, wp_json_encode($data)); }
    $body = curl_exec($client);
    return [(int) curl_getinfo($client, CURLINFO_RESPONSE_CODE), $responseHeaders, $body];
};
$anonymousHttp = curl_init();
$cartHttp = curl_init();
curl_setopt($cartHttp, CURLOPT_COOKIEFILE, '');
$storeApi = '/wp-json/wc/store/v1/cart';
[, $nonceHeaders] = $guestRequest($cartHttp, $storeApi);
[$cartStatus, $storeHeaders, $cartBody] = $guestRequest($cartHttp, $storeApi . '/add-item',
    ['Content-Type: application/json', 'Nonce: ' . ($nonceHeaders['nonce'] ?? '')], ['id' => $mug['id']]);
eq('Woo adds the fixture product to an actual guest session', [$cartStatus, json_decode((string) $cartBody, true)['items_count'] ?? null], [201, 1]);
check('the guest session returned a cookie on a private Store API response', isset($storeHeaders['set-cookie'])
    && str_contains($storeHeaders['cache-control'] ?? '', 'no-store') && ($storeHeaders['a8c-edge-cache'] ?? '') === 'no-cache');
[, , $persistedCart] = $guestRequest($cartHttp, $storeApi);
eq('Woo restores the guest cart from the cookie jar', json_decode((string) $persistedCart, true)['items_count'] ?? null, 1);
foreach (['/shop/', '/shop/home/', '/products/ceramic-mug/'] as $path) {
    [$guestStatus, $guestHeaders, $guestHtml] = $guestRequest($anonymousHttp, $path);
    [$cartStatus, $cartHeaders, $cartHtml] = $guestRequest($cartHttp, $path);
    check("catalog HTML is byte-identical with a cart at $path", $guestStatus === 200 && $cartStatus === 200 && $guestHtml === $cartHtml);
    check("there are no cart-dependent PHP prefetch links at $path", !str_contains((string) $cartHtml, "rel='prefetch'"));
    $sharedHeaders = array_flip(['cache-control', 'a8c-edge-cache', 'x-test-batcache-cancel']);
    check("edge and Batcache policy is shared with and without cart cookies at $path",
        str_starts_with($guestHeaders['cache-control'] ?? '', 'public,')
        && ($guestHeaders['cache-control'] ?? '') === ($cartHeaders['cache-control'] ?? null)
        && ($guestHeaders['a8c-edge-cache'] ?? '') === 'cache' && ($cartHeaders['a8c-edge-cache'] ?? '') === 'cache'
        && !isset($guestHeaders['x-test-batcache-cancel']) && !isset($cartHeaders['x-test-batcache-cancel']),
        [array_intersect_key($guestHeaders, $sharedHeaders), array_intersect_key($cartHeaders, $sharedHeaders)]);
    check("neither shared response sets a cookie at $path", !isset($guestHeaders['set-cookie']) && !isset($cartHeaders['set-cookie']));
}
// A page the theme renders is not an app page: Woo keeps the cart session there and prints its
// cart-dependent prefetch links, so that answer is the cart visitor's alone.
$themePage = '/' . get_page_uri(wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Returns', 'post_name' => 'returns', 'post_content' => 'Thirty days.'])) . '/';
[$themeStatus, $themeHeaders, $themeHtml] = $guestRequest($anonymousHttp, $themePage);
[$themeCartStatus, $themeCartHeaders, $themeCartHtml] = $guestRequest($cartHttp, $themePage);
eq('Woo prints its cart prefetch links on a theme page only for a cart', [substr_count((string) $themeHtml, "rel='prefetch'") === 0, substr_count((string) $themeCartHtml, "rel='prefetch'") > 0], [true, true]);
check('a theme page is not private for a visitor without a cart', $themeStatus === 200 && !str_contains($themeHeaders['cache-control'] ?? '', 'no-store'), $themeHeaders);
check('a theme page is private for a cart cookie visitor', $themeCartStatus === 200 && str_contains($themeCartHeaders['cache-control'] ?? '', 'private, no-store')
    && ($themeCartHeaders['a8c-edge-cache'] ?? '') === 'no-cache' && isset($themeCartHeaders['x-test-batcache-cancel']), $themeCartHeaders);
// Woo turns `?wc_error=` into a session notice: whatever it does with it, a shared answer sets no cookie.
foreach ([$anonymousHttp, $cartHttp] as $client) {
    [, $noticeHeaders] = $guestRequest($client, '/shop/?wc_error=Sold+out');
    check('a catalog address with a Woo notice sets no cookie on a shared answer',
        !isset($noticeHeaders['set-cookie']) || str_contains($noticeHeaders['cache-control'] ?? '', 'private, no-store'), $noticeHeaders);
}
// No query string and no spelling of the path brings the cart back onto an answer the router shares:
// a shared answer is the page every guest gets, whatever WordPress makes of `?page_id=` and the like.
foreach (["/shop/?page_id=$checkout", "/shop/?p=$checkout", '/shop/?pagename=checkout', '/shop/?preview=true',
    "/products/ceramic-mug/?page_id=$checkout", '//foo/shop/', '//foo/shop/?page_id=' . $checkout] as $path) {
    [, , $guestHtml] = $guestRequest($anonymousHttp, $path);
    [, $cartHeaders, $cartHtml] = $guestRequest($cartHttp, $path);
    $shared = str_starts_with($cartHeaders['cache-control'] ?? '', 'public') || ($cartHeaders['a8c-edge-cache'] ?? '') === 'cache';
    check("a cart visitor is given a shared answer only when it is everyone's page at $path",
        !$shared || ($cartHtml === $guestHtml && !isset($cartHeaders['set-cookie'])), $cartHeaders);
    check("Woo's cart prefetch links are on no shared answer at $path", !$shared || !str_contains((string) $cartHtml, "rel='prefetch'"));
}
[$queryStatus, $queryHeaders] = $guestRequest($cartHttp, '/?pagename=checkout');
eq('the home page asked for checkout by query goes to the checkout address', [$queryStatus, wp_parse_url($queryHeaders['location'] ?? '', PHP_URL_PATH)], [301, '/checkout/']);
eq('a doubled leading slash names a path, not a host, to the router as to WooCommerce', $guestRequest($cartHttp, '//foo/shop/')[0], 404);
[, , $afterCart] = $guestRequest($cartHttp, $storeApi);
eq('the cart is intact after shared pages rendered without it', json_decode((string) $afterCart, true)['items_count'] ?? null, 1);
foreach (['/cart/', '/checkout/', '/checkout/order-received/9999/', '/customer-account/', '/customer-account/orders/'] as $path) {
    [, $headers] = $guestRequest($cartHttp, $path);
    check("Woo shopper route is private at $path", str_contains($headers['cache-control'] ?? '', 'private, no-store')
        && ($headers['a8c-edge-cache'] ?? '') === 'no-cache' && isset($headers['x-test-batcache-cancel']));
}
eq('the native account page has no Markdown twin', $guestRequest($cartHttp, '/customer-account.md')[0], 404);
$prebuilt = \TypedPress\Render\Prebuilt::dir();
if (!is_dir($prebuilt . '/products')) { mkdir($prebuilt . '/products', 0777, true); }
file_put_contents($prebuilt . '/products/ceramic-mug.html', 'prebuilt product');
file_put_contents($prebuilt . '/cart.html', 'prebuilt cart should never be served');
file_put_contents($prebuilt . '/customer-account.html', 'prebuilt account should never be served');
[, $guestHeaders, $guestHtml] = $guestRequest($anonymousHttp, '/products/ceramic-mug/');
[, $cartHeaders, $cartHtml] = $guestRequest($cartHttp, '/products/ceramic-mug/');
check('prebuilt serves the same public file with and without a Woo session',
    $guestHtml === 'prebuilt product' && $cartHtml === $guestHtml && ($guestHeaders['x-typedpress-prebuilt'] ?? '') === '1'
    && ($cartHeaders['x-typedpress-prebuilt'] ?? '') === '1' && ($cartHeaders['a8c-edge-cache'] ?? '') === 'cache');
foreach (['/cart/', '/customer-account/'] as $path) {
    [, $headers] = $guestRequest($cartHttp, $path);
    check("prebuilt falls through to the private response at $path", !isset($headers['x-typedpress-prebuilt'])
        && str_contains($headers['cache-control'] ?? '', 'no-store'));
}
// Every Store API answer is the visitor's: an order carries addresses, and extensions add per-visitor routes.
foreach (['/wp-json/wc/store/v1/products', '/wp-json/wc/store/v1/order/999999?key=wc_order_none', '/?rest_route=/wc/store/v1/products/categories'] as $path) {
    [, $headers] = $guestRequest($anonymousHttp, $path);
    check("the Store API answer is private at $path", str_contains($headers['cache-control'] ?? '', 'private, no-store')
        && ($headers['a8c-edge-cache'] ?? '') === 'no-cache' && isset($headers['x-test-batcache-cancel']), $headers);
}
// Woo's `/checkout-link/` fills a cart and sets its cookies with no cache headers of its own.
flush_rewrite_rules();
[$linkStatus, $linkHeaders] = $guestRequest(curl_init(), '/checkout-link/?products=' . $mug['id'] . ':1');
check('a response Woo sets a cookie on is private, whichever endpoint set it', $linkStatus === 302 && isset($linkHeaders['set-cookie'])
    && str_contains($linkHeaders['cache-control'] ?? '', 'private, no-store') && ($linkHeaders['a8c-edge-cache'] ?? '') === 'no-cache'
    && isset($linkHeaders['x-test-batcache-cancel']), [$linkStatus, $linkHeaders]);
// A cart with no cookie at any step: Woo's Cart-Token names the session and replaces the nonce.
$tokenHttp = curl_init();
[, $tokenHeaders] = $guestRequest($tokenHttp, $storeApi);
$cartToken = $tokenHeaders['cart-token'] ?? '';
check('Woo hands a cookieless visitor a cart token and no cookie', $cartToken !== '' && !isset($tokenHeaders['set-cookie']));
[$tokenStatus, $tokenHeaders, $tokenBody] = $guestRequest($tokenHttp, $storeApi . '/add-item',
    ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id']]);
eq('a token cart write needs no nonce and no cookie', [$tokenStatus, json_decode((string) $tokenBody, true)['items_count'] ?? null], [201, 1]);
check('a token cart answer is private and sets no session cookie', !str_contains($tokenHeaders['set-cookie'] ?? '', 'wp_woocommerce_session_')
    && str_contains($tokenHeaders['cache-control'] ?? '', 'no-store') && ($tokenHeaders['a8c-edge-cache'] ?? '') === 'no-cache');
$cartToken = $tokenHeaders['cart-token'] ?? '';
[, , $tokenCart] = $guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken]);
eq('the token alone restores the cart on a new connection', json_decode((string) $tokenCart, true)['items_count'] ?? null, 1);
[, , $noToken] = $guestRequest(curl_init(), $storeApi);
eq('a request with neither token nor cookie has an empty cart', json_decode((string) $noToken, true)['items_count'] ?? null, 0);
// What the client reads as "this token is no longer accepted": Woo ignores it and asks the write for a nonce.
$expired = \Automattic\WooCommerce\StoreApi\Utilities\JsonWebToken::create(['user_id' => 't_expired', 'exp' => time() - 60, 'iss' => 'store-api'], '@' . wp_salt());
[$expiredStatus, , $expiredBody] = $guestRequest(curl_init(), $storeApi . '/add-item',
    ['Content-Type: application/json', 'Cart-Token: ' . $expired], ['id' => $mug['id']]);
eq('an expired cart token is refused as a missing nonce', [$expiredStatus, json_decode((string) $expiredBody, true)['code'] ?? null], [401, 'woocommerce_rest_missing_nonce']);
foreach (['/shop/', '/products/ceramic-mug/'] as $path) {
    [, $headers, $html] = $guestRequest(curl_init(), $path, ['Cart-Token: ' . $cartToken]);
    check("a token cart visitor gets the shared page at $path", $html === $guestRequest($anonymousHttp, $path)[2]
        && str_starts_with($headers['cache-control'] ?? '', 'public,') && !isset($headers['set-cookie']));
}
// Woo's own handoff to the Checkout Block: `?session=` copies the token's cart into a new cookie session.
$handoffHttp = curl_init();
curl_setopt($handoffHttp, CURLOPT_COOKIEFILE, '');
$handoff = static fn (string $token): array => $guestRequest($handoffHttp, '/checkout/?lang=pl&session=' . rawurlencode($token));
$items = static fn (array $answer): mixed => json_decode((string) $answer[2], true)['items_count'] ?? null;
[$handoffStatus, $handoffHeaders] = $handoff($cartToken);
check('the checkout link starts a cookie session on a private response', $handoffStatus === 302
    && str_contains($handoffHeaders['set-cookie'] ?? '', 'wp_woocommerce_session_')
    && str_contains($handoffHeaders['cache-control'] ?? '', 'private, no-store') && ($handoffHeaders['a8c-edge-cache'] ?? '') === 'no-cache', $handoffHeaders);
// The token is a credential: it leaves the address bar, and that response names no referrer to another site.
eq('the visitor goes on at the same address without the token', [$handoffHeaders['location'] ?? null, $handoffHeaders['referrer-policy'] ?? null], ['/checkout/?lang=pl', 'same-origin']);
[$checkoutStatus, $checkoutHeaders] = $guestRequest($handoffHttp, '/checkout/?lang=pl');
check('the checkout page it lands on is private', $checkoutStatus === 200 && str_contains($checkoutHeaders['cache-control'] ?? '', 'private, no-store'));
eq('the cookie session checkout reads holds the token cart', $items($guestRequest($handoffHttp, $storeApi)), 1);
// The storefront changes the cart and hands it over again: Woo alone would keep its first copy.
[, $tokenHeaders] = $guestRequest(curl_init(), $storeApi . '/add-item', ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id']]);
$cartToken = $tokenHeaders['cart-token'] ?? '';
eq('a second checkout link shows the cart as it is now', [$handoff($cartToken)[0], $items($guestRequest($handoffHttp, $storeApi))], [302, 2]);
[, , $copyBody] = $guestRequest($handoffHttp, $storeApi);
$copyKey = json_decode((string) $copyBody, true)['items'][0]['key'];
$changeCopy = static fn (int $quantity): array => $guestRequest($handoffHttp, $storeApi . '/update-item',
    ['Content-Type: application/json', 'Nonce: ' . ($guestRequest($handoffHttp, $storeApi)[1]['nonce'] ?? '')], ['key' => $copyKey, 'quantity' => $quantity]);
eq('editing the imported cart updates its quantity', $items($changeCopy(3)), 3);
$handoff($cartToken);
eq('reopening the same link preserves edits in the cookie cart', $items($guestRequest($handoffHttp, $storeApi)), 3);
$changeCopy(2);
// A cookie cart's own token names the session the cookie already holds: nothing to copy, and no second session.
$ownHttp = curl_init();
curl_setopt($ownHttp, CURLOPT_COOKIEFILE, '');
[, $nonceHeaders] = $guestRequest($ownHttp, $storeApi);
[, $ownHeaders] = $guestRequest($ownHttp, $storeApi . '/add-item', ['Content-Type: application/json', 'Nonce: ' . ($nonceHeaders['nonce'] ?? '')], ['id' => $mug['id']]);
[$ownStatus, $ownHeaders] = $guestRequest($ownHttp, '/checkout/?session=' . rawurlencode($ownHeaders['cart-token'] ?? ''));
check('a link carrying the cookie session\'s own token keeps that session', $ownStatus === 302 && !str_contains($ownHeaders['set-cookie'] ?? '', 'wp_woocommerce_session_'), $ownHeaders);
eq('and its cart', $items($guestRequest($ownHttp, $storeApi)), 1);
$guestRequest($ownHttp, '/checkout/?session=' . rawurlencode($cartToken));
eq('a link for a different token leaves the guest cart in place', $items($guestRequest($ownHttp, $storeApi)), 1);
$offCheckout = curl_init();
curl_setopt($offCheckout, CURLOPT_COOKIEFILE, '');
[$sessionStatus, $sessionHeaders] = $guestRequest($offCheckout, '/shop/?session=' . rawurlencode($cartToken));
check('a session link outside checkout is private and creates no session', $sessionStatus === 200 && !isset($sessionHeaders['set-cookie'])
    && str_contains($sessionHeaders['cache-control'] ?? '', 'private, no-store') && ($sessionHeaders['a8c-edge-cache'] ?? '') === 'no-cache');
$guestRequest($offCheckout, '/checkout/?session=' . rawurlencode($cartToken), ['Content-Type: application/json'], ['probe' => true]);
eq('POST to the checkout page does not import a cart', $items($guestRequest($offCheckout, $storeApi)), 0);
$user = $site->userId('ed');
$expires = time() + HOUR_IN_SECONDS;
$login = wp_generate_auth_cookie($user, $expires, 'logged_in', WP_Session_Tokens::get_instance($user)->create($expires));
$previousUser = get_current_user_id();
$previousLogin = $_COOKIE[LOGGED_IN_COOKIE] ?? null;
$_COOKIE[LOGGED_IN_COOKIE] = $login;
wp_set_current_user($user);
$signedHeaders = ['Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode($login), 'X-WP-Nonce: ' . wp_create_nonce('wp_rest')];
if ($previousLogin === null) { unset($_COOKIE[LOGGED_IN_COOKIE]); } else { $_COOKIE[LOGGED_IN_COOKIE] = $previousLogin; }
wp_set_current_user($previousUser);
$signedIn = curl_init();
[, $signedNonce] = $guestRequest($signedIn, $storeApi, $signedHeaders);
$signedCart = $guestRequest($signedIn, $storeApi . '/add-item',
    [...$signedHeaders, 'Content-Type: application/json', 'Nonce: ' . ($signedNonce['nonce'] ?? '')], ['id' => $mug['id']]);
eq('the signed-in shopper has a saved cart', $items($signedCart), 1);
$guestRequest($signedIn, '/checkout/?session=' . rawurlencode($cartToken), $signedHeaders);
eq("a checkout link preserves the signed-in shopper's saved cart", $items($guestRequest($signedIn, $storeApi, $signedHeaders)), 1);
[$badStatus, $badHeaders] = $guestRequest(curl_init(), '/shop/?session=not-a-token');
check('an address with a session Woo does not accept is private and stays where it is', $badStatus === 200 && !isset($badHeaders['set-cookie'])
    && str_contains($badHeaders['cache-control'] ?? '', 'private, no-store'), [$badStatus, $badHeaders]);
// An order from the cookie session buys the token's cart: the storefront must not still show, or hand over, that cart.
[, $nonceHeaders] = $guestRequest($handoffHttp, $storeApi);
$buyer = ['first_name' => 'Test', 'last_name' => 'Buyer', 'address_1' => 'Rynek 2', 'city' => 'Kraków', 'postcode' => '31-042', 'country' => 'PL'];
[$orderStatus, , $orderBody] = $guestRequest($handoffHttp, '/wp-json/wc/store/v1/checkout', ['Content-Type: application/json', 'Nonce: ' . ($nonceHeaders['nonce'] ?? '')],
    ['billing_address' => $buyer + ['email' => 'buyer@example.test', 'phone' => '123456789'], 'shipping_address' => $buyer, 'payment_method' => 'cod']);
$placed = json_decode((string) $orderBody, true);
eq('the cookie session places the order for the handed-over cart', [$orderStatus, $placed['payment_result']['payment_status'] ?? $placed], [200, 'success']);
eq('the order has both mugs', array_sum(array_map(static fn ($item) => $item->get_quantity(), wc_get_order((int) ($placed['order_id'] ?? 0))?->get_items() ?? [])), 2);
eq('the cookie cart is empty after its order', $items($guestRequest($handoffHttp, $storeApi)), 0);
eq('the token cart the order bought is empty too', $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken])), 0);
// A token cart that changed after the handoff is not what the order bought, and is kept.
[, $tokenHeaders] = $guestRequest(curl_init(), $storeApi . '/add-item', ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id']]);
$cartToken = $tokenHeaders['cart-token'] ?? '';
$handoff($cartToken);
[, $tokenHeaders] = $guestRequest(curl_init(), $storeApi . '/add-item', ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id']]);
$cartToken = $tokenHeaders['cart-token'] ?? '';
[, $nonceHeaders] = $guestRequest($handoffHttp, $storeApi);
[$orderStatus] = $guestRequest($handoffHttp, '/wp-json/wc/store/v1/checkout', ['Content-Type: application/json', 'Nonce: ' . ($nonceHeaders['nonce'] ?? '')],
    ['billing_address' => $buyer + ['email' => 'buyer@example.test', 'phone' => '123456789'], 'shipping_address' => $buyer, 'payment_method' => 'cod']);
eq('an order for an older copy leaves the changed token cart alone', [$orderStatus, $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken]))], [200, 2]);
// An unrelated receipt has no handoff recorded, even when this browser has an imported cart.
$unrelated = wc_create_order();
$deferredHttp = curl_init();
curl_setopt($deferredHttp, CURLOPT_COOKIEFILE, '');
$guestRequest($deferredHttp, '/checkout/?session=' . rawurlencode($cartToken));
[$receiptStatus] = $guestRequest($deferredHttp, '/checkout/order-received/' . $unrelated->get_id() . '/?key=' . $unrelated->get_order_key());
eq('a valid receipt for an unrelated order leaves the token cart alone', [$receiptStatus, $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken]))], [200, 2]);

$placeDeferred = static function (string $token) use ($guestRequest, $storeApi, $buyer): array {
    $client = curl_init();
    curl_setopt($client, CURLOPT_COOKIEFILE, '');
    $guestRequest($client, '/checkout/?session=' . rawurlencode($token));
    [, $headers] = $guestRequest($client, $storeApi);
    [$status, , $body] = $guestRequest($client, '/wp-json/wc/store/v1/checkout',
        ['Content-Type: application/json', 'Nonce: ' . ($headers['nonce'] ?? '')],
        ['billing_address' => $buyer + ['email' => 'buyer@example.test', 'phone' => '123456789'],
            'shipping_address' => $buyer, 'payment_method' => 'cod', 'payment_data' => [['key' => 'defer', 'value' => true]]]);
    $order = wc_get_order((int) (json_decode((string) $body, true)['order_id'] ?? 0));
    eq('deferred checkout placed a pending order', [$status, $order ? $order->get_status() : null], [200, 'pending']);
    return [$client, $order ? '/checkout/order-received/' . $order->get_id() . '/?key=' : '', $order ? $order->get_order_key() : ''];
};
[$receiptHttp, $receipt, $key] = $placeDeferred($cartToken);
$guestRequest($receiptHttp, $receipt . 'wc_order_guess');
eq('the wrong order key leaves the token cart alone', $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken])), 2);
[, $tokenHeaders] = $guestRequest(curl_init(), $storeApi . '/add-item', ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id']]);
$cartToken = $tokenHeaders['cart-token'] ?? '';
[$receiptStatus] = $guestRequest($receiptHttp, $receipt . $key);
eq('a valid receipt preserves token lines changed after checkout', [$receiptStatus, $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken]))], [200, 3]);
[, $receipt, $key] = $placeDeferred($cartToken);
[$receiptStatus] = $guestRequest(curl_init(), $receipt . $key);
eq('a valid receipt clears its unchanged source even in a new browser', [$receiptStatus, $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken]))], [200, 0]);
$guestRequest(curl_init(), $storeApi . '/add-item', ['Content-Type: application/json', 'Cart-Token: ' . $cartToken], ['id' => $mug['id'], 'quantity' => 3]);
$guestRequest(curl_init(), $receipt . $key);
eq('revisiting a settled receipt preserves a rebuilt cart with identical lines', $items($guestRequest(curl_init(), $storeApi, ['Cart-Token: ' . $cartToken])), 3);
$actionsOnly = '<!-- wp:woocommerce/checkout --><!-- wp:woocommerce/checkout-actions-block /--><!-- /wp:woocommerce/checkout -->';
set_query_var('order-pay', ''); unset($GLOBALS['wp']->query_vars['order-pay']);
eq('Woo renders no form for an actions-only checkout', trim(do_blocks($actionsOnly)), '');
$previousUser = get_current_user_id();
wp_set_current_user($site->userId('ed'));
$originalCheckout = get_post_field('post_content', $checkout);
wp_update_post(['ID' => $checkout, 'post_content' => 'Removed checkout']);
eq('an editor cannot remove the Checkout Block', get_post_field('post_content', $checkout), $originalCheckout);
eq('checkout cannot be trashed', wp_trash_post($checkout), false);
wp_update_post(['ID' => $checkout, 'post_content' => '<!-- wp:woocommerce/checkout-fields /-->']);
eq('a similarly named block cannot replace checkout', get_post_field('post_content', $checkout), $originalCheckout);
$legacy = '<!-- wp:woocommerce/checkout --><div class="wp-block-woocommerce-checkout"></div><!-- /wp:woocommerce/checkout -->';
wp_update_post(['ID' => $checkout, 'post_content' => $legacy]);
eq('an editor can save the legacy Woo checkout wrapper', get_post_field('post_content', $checkout), $legacy);
$nested = '<!-- wp:group -->' . $originalCheckout . '<!-- /wp:group -->';
wp_update_post(['ID' => $checkout, 'post_content' => wp_slash($nested)]);
eq('an editor can save nested checkout', get_post_field('post_content', $checkout), $nested);
foreach ([
    $actionsOnly,
    '<!-- wp:woocommerce/checkout broken -->',
    '<!-- wp:woocommerce/checkout /-->',
    '<!-- wp:woocommerce/checkout -->   <!-- /wp:woocommerce/checkout -->',
    '<!-- wp:woocommerce/checkout --><div></div>',
    '<!-- wp:woocommerce/checkout --><div></div><!-- /wp:woocommerce/checkout -->',
    '<!-- wp:woocommerce/checkout --><!-- wp:paragraph /--><!-- /wp:woocommerce/checkout -->',
    '<!-- /wp:group -->' . $nested,
] as $invalid) {
    wp_update_post(['ID' => $checkout, 'post_content' => wp_slash($invalid)]);
    eq('malformed or empty checkout preserves the last valid edit', get_post_field('post_content', $checkout), $nested);
}
wp_set_current_user($previousUser);
wp_update_post(['ID' => $checkout, 'post_content' => wp_slash($originalCheckout)]);
$checkoutRoute = get_post_meta($checkout, \TypedPress\Wp\ContentPages::META, true);
delete_post_meta($checkout, \TypedPress\Wp\ContentPages::META);
$newPage = wp_insert_post(['post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'Before checkout', 'post_content' => 'Keep this new content.']);
eq('new content survives when no checkout Page exists', get_post_field('post_content', $newPage), 'Keep this new content.');
update_post_meta($checkout, \TypedPress\Wp\ContentPages::META, $checkoutRoute); wp_delete_post($newPage, true);
$unidentifiedTerm = wp_insert_term('Empty UID term', 'product_cat')['term_id'];
add_term_meta($unidentifiedTerm, '_tp_uid', '');
eq('an empty term UID is treated as missing', $db->transaction(static fn () => \TypedPress\Sync\Lock::uid('categories', $unidentifiedTerm)), null);
wp_delete_term($unidentifiedTerm, 'product_cat');
$zoneIds = array_keys($zones);
$methodIds = array_map(static fn ($z) => array_keys($z['shipping_methods']), $zones);
\TypedPress\Commerce\Module::initialize($plugin);
eq('unchanged source does not recreate shipping methods', array_map(static fn ($z) => array_keys($z['shipping_methods']), WC_Shipping_Zones::get_zones()), $methodIds);
wp_cache_set('notoptions', ['tp_' . $plugin->schema->name() . '_shipping' => true], 'options');
eq('shipping inspection ignores a stale negative marker cache', \TypedPress\Commerce\Module::plan($plugin), []);
$translateRest = static fn ($translated, $text) => $text === 'Locations not covered by your other zones' ? 'Autres destinations' : $translated;
add_filter('gettext_woocommerce', $translateRest, 10, 2);
eq('localizing the fallback zone preserves the shipping receipt', \TypedPress\Commerce\Module::plan($plugin), []);
remove_filter('gettext_woocommerce', $translateRest, 10);
$zoneStore = WC_Data_Store::load('shipping-zone');
$unknownMethod = $zoneStore->add_method(reset($zoneIds), 'inactive_test_plugin', 9);
eq('an inactive plugin rate invalidates the shipping receipt', array_column(\TypedPress\Commerce\Module::plan($plugin), 'id'), ['commerce-shipping']);
\TypedPress\Commerce\Module::initialize($plugin);
check('reconciliation removes the inactive plugin rate', !$zoneStore->get_method($unknownMethod));
$reordered = new WC_Shipping_Zone(reset($zoneIds));
$reordered->set_zone_order(7); $reordered->save();
$skipZoneUpdate = static fn (string $sql): string => preg_match('/^UPDATE `?[^\s`]*woocommerce_shipping_zones`?\s/i', $sql) ? 'SELECT 1' : $sql;
add_filter('query', $skipZoneUpdate);
try {
    $refusedOrder = false;
    try { \TypedPress\Commerce\Module::initialize($plugin); } catch (RuntimeException $e) {
        $refusedOrder = str_contains($e->getMessage(), 'shipping zone order');
    }
    check('a lost zone-order update prevents installation', $refusedOrder);
} finally {
    remove_filter('query', $skipZoneUpdate);
}
\TypedPress\Commerce\Module::initialize($plugin);
eq('retry restores the declared order', (new WC_Shipping_Zone(reset($zoneIds)))->get_zone_order('edit'), 0);
$extra = new WC_Shipping_Zone();
$extra->set_zone_name('Admin addition');
$extra->add_location('FR', 'country');
$extra->save();
$extraRate = $extra->add_shipping_method('flat_rate');
check('the obsolete zone has a configured rate before reconciliation', $extraRate > 0
    && update_option('woocommerce_flat_rate_' . $extraRate . '_settings', ['title' => 'Local courier', 'cost' => '8.50']));
$shippingSnapshot = static function (): array {
    $state = [];
    foreach ([...array_keys(WC_Shipping_Zones::get_zones()), 0] as $id) {
        $zone = new WC_Shipping_Zone($id);
        $state[] = [$id, $zone->get_zone_name(), $zone->get_zone_order(),
            array_map(static fn ($location) => [$location->code, $location->type], $zone->get_zone_locations()),
            array_map(static fn ($method) => [$method->instance_id, $method->id, $method->enabled, get_option($method->get_instance_option_key())], $zone->get_shipping_methods())];
    }
    return $state;
};
$beforeFailedShipping = $shippingSnapshot();
eq('shipping drift is included in the install plan', array_column(\TypedPress\Commerce\Module::plan($plugin), 'id'), ['commerce-shipping']);
check('the runtime inspection includes pending commerce installation', in_array('commerce-shipping', array_column(\TypedPress\Wp\Runtime::installPlan(), 'id'), true));
// Simulate a data store that returns after a zone deletion without deleting its row.
$skipZoneDelete = static fn (string $sql): string => preg_match('/^DELETE FROM `?[^\s`]*woocommerce_shipping_zones`?\s/i', $sql) ? 'SELECT 1' : $sql;
add_filter('query', $skipZoneDelete);
try {
    $refusedDeletion = false;
    try { \TypedPress\Commerce\Module::initialize($plugin); } catch (RuntimeException $e) {
        $refusedDeletion = str_contains($e->getMessage(), 'Persisted shipping zones');
    }
    check('a surviving obsolete zone prevents installation', $refusedDeletion);
} finally {
    remove_filter('query', $skipZoneDelete);
}
eq('failed zone deletion preserves the previous shipping configuration', $shippingSnapshot(), $beforeFailedShipping);
$noMethods = static fn () => [];
add_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
$shippingFailed = false;
try { \TypedPress\Commerce\Module::initialize($plugin); } catch (RuntimeException $e) { $shippingFailed = str_contains($e->getMessage(), 'Could not add source shipping method'); }
check('failed shipping writes do not record a completed installation', $shippingFailed && \TypedPress\Commerce\Module::plan($plugin) !== []);
remove_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
eq('failed shipping replacement preserves every previous zone and method', $shippingSnapshot(), $beforeFailedShipping);
$newOption = null;
$failAfterSetting = static function ($instance, $type) use (&$newOption): void {
    if ($type === 'flat_rate') { $newOption = 'woocommerce_flat_rate_' . $instance . '_settings'; }
    if ($type === 'free_shipping') { throw new RuntimeException('Test failure after a shipping setting write'); }
};
add_action('woocommerce_shipping_zone_method_added', $failAfterSetting, 10, 2);
$lateShippingFailed = false;
try { \TypedPress\Commerce\Module::initialize($plugin); } catch (RuntimeException $e) { $lateShippingFailed = str_contains($e->getMessage(), 'Test failure after'); }
remove_action('woocommerce_shipping_zone_method_added', $failAfterSetting, 10);
check('a late shipping failure rolls back method settings and their option cache', $lateShippingFailed && $newOption !== null && get_option($newOption) === false);
eq('a late shipping failure preserves previous configuration', $shippingSnapshot(), $beforeFailedShipping);
\TypedPress\Commerce\Module::initialize($plugin);
eq('source shipping restores its whole zone list after an admin edit', array_column(WC_Shipping_Zones::get_zones(), 'zone_name'), ['Poland', 'Germany']);
eq('successful shipping retry clears the install plan', \TypedPress\Commerce\Module::plan($plugin), []);
check('the API exposes storefront-visible products to guests', count($products) === 2);
problem('guests cannot write products', fn () => $db->insert('products', ['name' => 'No'], true, $guest), 401, 'unauthenticated');
problem('guests cannot read orders', fn () => $db->findMany('orders', [], $guest), 401, 'unauthenticated');
problem('editors cannot read orders', fn () => $db->findMany('orders', [], new \TypedPress\Viewer(['id' => $site->userId('ed'), 'name' => 'Editor', 'role' => 'editor'])), 403, 'forbidden');
problem('scheduling a new product without a date is refused', fn () => $db->insert('products', ['name' => 'Premature product', 'status' => 'scheduled'], true, $admin), 422, 'invalid_input', '/status');
eq('a refused scheduled product is absent from the public catalog', $db->findFirst('products', ['where' => ['name' => 'Premature product']], $guest), null);
$future = new WC_Product_Simple();
$future->set_name('Scheduled product'); $future->set_sku('0'); $future->set_date_created(time() + WEEK_IN_SECONDS); $future->set_status('future'); $future->save();
$db->update('products', ['status' => 'scheduled', 'name' => 'Still scheduled'], ['id' => $future->get_id()], false, $admin);
$scheduled = $db->findFirst('products', ['where' => ['id' => $future->get_id()]], $admin);
eq('a native scheduled product keeps its status and zero SKU', [$scheduled['status'], $scheduled['sku']], ['scheduled', '0']);
// Model the clock reaching the final minute of a product that is already scheduled.
global $wpdb;
$imminent = gmdate('Y-m-d H:i:s', time() + 30);
$wpdb->update($wpdb->posts, ['post_date_gmt' => $imminent, 'post_date' => get_date_from_gmt($imminent)], ['ID' => $future->get_id()]);
clean_post_cache($future->get_id());
foreach ([['status' => 'scheduled', 'name' => 'Explicit near-term edit'], ['name' => 'Implicit near-term edit']] as $edit) {
    $db->update('products', $edit, ['id' => $future->get_id()], false, $admin);
    $post = get_post($future->get_id());
    eq('a last-minute title edit preserves publication time and status', [$post->post_title, $post->post_status, $post->post_date_gmt], [$edit['name'], 'future', $imminent]);
    eq('the next publication event uses the edited fixture time', wp_next_scheduled('publish_future_post', [$future->get_id()]), strtotime($imminent . ' UTC'));
    eq('the edited scheduled product stays out of the public catalog', $db->findFirst('products', ['where' => ['id' => $future->get_id()]], $guest), null);
}
// Cron has committed publication, but the editing request still has a pre-publication Woo object.
wp_publish_post($future->get_id());
$staleSchedule = static function ($id, $product) use ($future): void {
    if ($id === $future->get_id()) { $product->set_status('future'); }
};
add_action('woocommerce_product_read', $staleSchedule, 10, 2);
try {
    problem('a stale scheduled edit conflicts after publication', fn () => $db->update('products', ['name' => 'Stale title'], ['id' => $future->get_id()], false, $admin), 409, 'conflict', '/status');
} finally {
    remove_action('woocommerce_product_read', $staleSchedule, 10);
}
eq('a stale scheduled edit preserves the published product', get_post_status($future->get_id()), 'publish');
$future->delete(true);
problem('numeric prices are refused before text coercion', fn () => $db->update('products', ['price' => 12.5], ['id' => $mug['id']], false, $admin), 422, 'invalid_input', '/price');
$db->update('products', ['status' => 'draft'], ['id' => $mug['id']], false, $admin);
eq('a draft is not public', count($db->findMany('products', [], $guest)), 1);
eq('admin sees the draft', $db->findFirst('products', ['where' => ['id' => $mug['id']]], $admin)['status'], 'draft');
$db->update('products', ['status' => 'published', 'price' => '25.00'], ['id' => $mug['id']], false, $admin);
eq('publishing preserves identity', $db->findFirst('products', ['where' => ['uid' => $mug['uid']]], $guest)['id'], $mug['id']);
$native = wc_get_product($mug['id']);
$native->set_sale_price('1.00'); $native->set_manage_stock(true); $native->set_stock_quantity(2); $native->set_backorders('yes'); $native->save();
eq('sale prices have no effect', wc_get_product($mug['id'])->get_price(), '25.00');
check('sales are off', !wc_get_product($mug['id'])->is_on_sale());
check('backorders are off', !wc_get_product($mug['id'])->backorders_allowed());
check('coupons and new tax calculation are off', !wc_coupons_enabled() && !wc_tax_enabled());
eq('guest checkout remains on', get_option('woocommerce_enable_guest_checkout'), 'yes');
eq('customer signup remains off', get_option('woocommerce_enable_signup_and_login_from_checkout'), 'no');
eq('reviews and ratings remain off', [get_option('woocommerce_enable_reviews'), get_option('woocommerce_enable_review_rating')], ['no', 'no']);
$seed = \TypedPress\Sync\Seed::run($plugin, $plugin->dir . '/tp/app/seed');
eq('repeat deploy preserves merchant price edits', wc_get_product($mug['id'])->get_regular_price(), '25.00');
eq('repeat deploy preserves operational stock', wc_get_product($mug['id'])->get_stock_quantity(), 2);
eq('repeat deploy preserves download ids', array_keys(wc_get_product($guide['id'])->get_downloads()), ['field-guide']);
check('repeat deploy creates nothing', array_sum(array_column($seed, 'created')) === 0);
$seedFile = $plugin->dir . '/tp/app/seed/products.php';
$originalSeed = file_get_contents($seedFile); $seedInput = require $seedFile;
$waitingUid = \TypedPress\Sync\Uid::mint();
$seedInput['records'][] = ['uid' => $waitingUid, 'fields' => ['name' => 'Must not be reseeded']];
file_put_contents($seedFile, '<?php return ' . var_export($seedInput, true) . ';');
$seedKey = 'tp_' . $plugin->schema->name() . '_seed';
foreach (['old value', 'missing option'] as $cached) {
    wp_cache_delete($seedKey, 'options'); wp_cache_delete('alloptions', 'options');
    if ($cached === 'old value') { wp_cache_set($seedKey, 'stale-before-lock', 'options'); }
    else { wp_cache_set('notoptions', [$seedKey => true], 'options'); }
    $plugin->installSeed();
    eq('a waiting standalone seed rechecks its committed version after cached ' . $cached, $db->findFirst('products', ['where' => ['uid' => $waitingUid]]), null);
}
file_put_contents($seedFile, $originalSeed);
$seedDir = dirname($seedFile);
$versionFile = dirname($seedDir) . '/seed-version.php';
$originalVersion = file_get_contents($versionFile);
$originalMarker = get_option($seedKey);
rename($seedFile, $seedFile . '.held');
try {
    delete_option($seedKey);
    $partial = clone $plugin;
    $partial->installSeed();
    check('a missing product seed among present terms prevents a receipt', str_contains($partial->unavailable() ?? '', 'products.php') && get_option($seedKey) === false);
    file_put_contents($seedFile, $originalSeed . "\n");
    file_put_contents($seedDir . '/extra.json', '{}');
    $modified = clone $plugin;
    $modified->installSeed();
    check('a changed seed file prevents a receipt', str_contains($modified->unavailable() ?? '', 'extra.json, products.php') && get_option($seedKey) === false);
} finally {
    if (is_file($seedDir . '/extra.json')) { unlink($seedDir . '/extra.json'); }
    rename($seedFile . '.held', $seedFile);
}
$plugin->installSeed();
eq('restoring the product seed allows the same build to finish', get_option($seedKey), $originalMarker);
rename($seedDir, $seedDir . '.held');
try {
    delete_option($seedKey);
    $missingSeedPlugin = clone $plugin;
    $missingSeedPlugin->installSeed();
    check('a missing nonempty seed bundle is refused without a receipt', str_contains($missingSeedPlugin->unavailable() ?? '', 'Missing seed directory') && get_option($seedKey) === false);
    $emptyVersion = [];
    file_put_contents($versionFile, '<?php return ' . var_export($emptyVersion, true) . ';');
    $plugin->installSeed();
    eq('an intentionally empty seed bundle receives its receipt', get_option($seedKey), $emptyVersion);
} finally {
    rename($seedDir . '.held', $seedDir);
    file_put_contents($versionFile, $originalVersion);
    update_option($seedKey, $originalMarker, false);
}
$directories = wc_get_container()->get(\Automattic\WooCommerce\Internal\ProductDownloads\ApprovedDirectories\Register::class);
$approvalCount = $directories->count(true);
problem('oversized download directories are input errors', fn () => $db->insert('products', ['name' => 'Bad download', 'downloadable' => true, 'downloads' => [['id' => 'bad', 'name' => 'Bad', 'file' => 'https://example.test/' . str_repeat('a', 260) . '/file.pdf']]], true, $admin), 422, 'invalid_input', '/downloads');
problem('a later invalid field prevents download approval', fn () => $db->insert('products', ['name' => 'Bad SKU', 'downloads' => [['id' => 'later', 'name' => 'Later', 'file' => 'https://not-approved.example.test/file.pdf']], 'sku' => 'MUG-BLUE'], true, $admin), 422, 'product_invalid_sku');
eq('failed product writes leave no approved directories', $directories->count(true), $approvalCount);
$order = wc_create_order();
$order->add_product(wc_get_product($guide['id']), 1);
$order->set_billing_email('buyer@example.test'); $order->set_billing_first_name('Test'); $order->set_billing_last_name('Buyer');
$order->set_payment_method('cod'); $order->calculate_totals(); $order->save(); $order->payment_complete();
wc_downloadable_product_permissions($order->get_id(), true);
$permissions = wc_get_customer_download_permissions(0);
$downloads = $order->get_downloadable_items();
check('a paid digital order receives a native download link', count($downloads) === 1 && str_contains($downloads[0]['download_url'], 'download_file='));
eq('the stable download id is preserved on the entitlement', $downloads[0]['download_id'], 'field-guide');
$read = json_decode(\TypedPress\Js::jsonStringify($db->findFirst('orders', ['where' => ['id' => $order->get_id()]], $admin)), true);
eq('authorized order reads carry purchase snapshots', $read['lines'][0]['name'], 'Field guide');
eq('authorized order reads carry billing', $read['billing']['email'], 'buyer@example.test');
eq('guest-order customer values and null filters agree', $db->findFirst('orders', ['where' => ['id' => $order->get_id(), 'customer' => null]], $admin)['customer'], null);
$historicalTax = new WC_Order_Item_Tax(); $historicalTax->set_label('Historical VAT'); $historicalTax->set_tax_total('1.23'); $order->add_item($historicalTax);
$historicalCoupon = new WC_Order_Item_Coupon(); $historicalCoupon->set_code('historical'); $historicalCoupon->set_discount('2.00'); $order->add_item($historicalCoupon);
$order->set_cart_tax('1.23'); $order->set_discount_total('2.00'); $order->save();
$historical = json_decode(\TypedPress\Js::jsonStringify($db->findFirst('orders', ['where' => ['id' => $order->get_id()]], $admin)), true);
eq('v1 restrictions do not erase historical tax and coupon snapshots', [$historical['taxTotal'], $historical['taxLines'][0]['tax_total'], $historical['couponLines'][0]['discount']], ['1.23', '1.23', '2.00']);
$refund = wc_create_refund(['order_id' => $order->get_id(), 'amount' => '1.00', 'reason' => 'Test refund', 'refund_payment' => false, 'restock_items' => false]);
$refunded = json_decode(\TypedPress\Js::jsonStringify($db->findFirst('orders', ['where' => ['id' => $order->get_id()]], $admin)), true);
check('authorized order reads include native refund summaries', !is_wp_error($refund) && count($refunded['refunds']) === 1 && $refunded['refunds'][0]['reason'] === 'Test refund' && $refunded['refunds'][0]['amount'] === '1.00', $refunded['refunds']);
problem('read projections are not silently accepted as arbitrary filters', fn () => $db->findMany('orders', ['where' => ['billing' => ['city' => 'Kraków']]], $admin), 422, 'invalid_input', '/where/billing');
$db->update('products', ['name' => 'Revised guide'], ['id' => $guide['id']], false, $admin);
eq('later product edits do not rewrite purchased names', json_decode(\TypedPress\Js::jsonStringify($db->findFirst('orders', ['where' => ['id' => $order->get_id()]], $admin)), true)['lines'][0]['name'], 'Field guide');
$spec = $plugin->schema->collection('products');
$wire = \TypedPress\Sync\Wire::encode('products', [$db->findFirst('products', ['where' => ['id' => $mug['id']]])])[0]['record'];
eq('sync carries term UIDs', $wire['fields']['categories'], [get_term_meta($mug['categories'][0], '_tp_uid', true)]);
check('sync omits operational/read-only projections', array_intersect(['availability', 'purchasable', 'type', 'url'], array_keys($wire['fields'])) === []);
$current = $mug; $current['categories'] = [999999, $mug['categories'][0]];
$unnamed = \TypedPress\Sync\Wire::encode('products', [$current])[0]['record'];
$missing = null;
eq('a refList pull with an unnamed target can be pushed without losing the link', \TypedPress\Sync\Wire::decode('products', $unnamed, false, $missing, $current)['categories'], $current['categories']);
$seedDir = sys_get_temp_dir() . '/tp-commerce-seed-' . bin2hex(random_bytes(4)); mkdir($seedDir);
$categoryUid = \TypedPress\Sync\Uid::mint(); $parentUid = \TypedPress\Sync\Uid::mint(); $productUid = \TypedPress\Sync\Uid::mint();
$seedProduct = $wire; $seedProduct['uid'] = $productUid;
$seedProduct['fields'] = array_replace($seedProduct['fields'], ['name' => 'Dry-run product', 'slug' => 'dry-run-product', 'sku' => 'DRY-RUN', 'categories' => [$categoryUid]]);
file_put_contents($seedDir . '/categories.json', wp_json_encode(['collection' => 'categories', 'format' => 'md', 'records' => [['uid' => $categoryUid, 'fields' => ['name' => 'Dry-run category', 'slug' => 'dry-run-category', 'parent' => $parentUid]], ['uid' => $parentUid, 'fields' => ['name' => 'Dry-run parent', 'slug' => 'dry-run-parent']]]]));
file_put_contents($seedDir . '/products.json', wp_json_encode(['collection' => 'products', 'format' => 'md', 'records' => [$seedProduct]]));
$dry = \TypedPress\Sync\Seed::run($plugin, $seedDir, true);
eq('a dry run orders parent terms and resolves references between new collections', [$dry['categories']['created'], $dry['products']['created']], [2, 1]);
eq('the dry run rolls back parent terms, children and products together', [$db->findFirst('categories', ['where' => ['uid' => $parentUid]]), $db->findFirst('categories', ['where' => ['uid' => $categoryUid]]), $db->findFirst('products', ['where' => ['uid' => $productUid]])], [null, null, null]);
unlink($seedDir . '/categories.json'); unlink($seedDir . '/products.json'); rmdir($seedDir);
$uids = array_column($db->findMany('products'), 'uid');
problem('distinct products cannot claim the same live UID', fn () => $db->insert('products', ['name' => 'Duplicate live product UID', 'uid' => $mug['uid']], true, $admin), 409, 'unique_violation', '/uid');
eq('refusing a duplicate product UID creates no product', $db->findFirst('products', ['where' => ['name' => 'Duplicate live product UID']]), null);
$db->delete('products', ['id' => $mug['id']], false, $admin);
eq('product delete uses native Woo trash', get_post_status($mug['id']), 'trash');
check('orders are not removed by catalog retirement', wc_get_order($order->get_id()) instanceof WC_Order);
$retired = $db->insert('products', ['name' => 'Trash probe', 'price' => '1.00', 'categories' => [$child['id']]], true, $admin)[0];
$batchFirst = $db->insert('products', ['name' => 'Batch trash probe', 'price' => '1.00', 'categories' => [$child['id']]], true, $admin)[0];
$failedCreationId = 0;
$failAfterCreate = static function ($product) use (&$failedCreationId): void {
    if ($product->get_name() === 'Failed creation cache probe') {
        $failedCreationId = $product->get_id();
        get_post($failedCreationId);
        throw new RuntimeException('after product save probe');
    }
};
add_action('woocommerce_after_product_object_save', $failAfterCreate);
$creationFailed = false;
try { $db->insert('products', ['name' => 'Failed creation cache probe', 'price' => '1.00'], true, $admin); }
catch (RuntimeException $e) { $creationFailed = $e->getMessage() === 'after product save probe'; }
finally { remove_action('woocommerce_after_product_object_save', $failAfterCreate); }
check('a post-save creation failure preserves the original exception', $creationFailed && $failedCreationId > 0);
eq('a post-save creation failure rolls its database row back', (int) $site->scalar('SELECT COUNT(*) FROM {prefix}posts WHERE ID = ?', [$failedCreationId]), 0);
eq('a post-save creation failure clears the native post cache', get_post($failedCreationId), null);
eq('a post-save creation failure cannot load a ghost Woo product', wc_get_product($failedCreationId), false);
$beforeEdit = get_post_field('post_title', $guide['id']);
$editRolledBack = false;
try {
    $db->transaction(static function () use ($db, $guide, $admin): void {
        $db->update('products', ['name' => 'Uncommitted product name'], ['id' => $guide['id']], false, $admin);
        eq('a product edit reaches the native cache inside its transaction', get_post_field('post_title', $guide['id']), 'Uncommitted product name');
        throw new RuntimeException('rollback product edit probe');
    });
} catch (RuntimeException $e) { $editRolledBack = $e->getMessage() === 'rollback product edit probe'; }
check('the product edit rollback probe reaches its intended failure', $editRolledBack);
eq('a rolled-back product edit restores its database title', $site->scalar('SELECT post_title FROM {prefix}posts WHERE ID = ?', [$guide['id']]), $beforeEdit);
eq('a rolled-back product edit clears its native post cache', get_post_field('post_title', $guide['id']), $beforeEdit);
$wooTrashed = 0;
$vetoTrash = static fn ($check, $post) => (int) $post->ID === $retired['id'] ? false : $check;
add_filter('pre_trash_post', $vetoTrash, PHP_INT_MAX, 2);
$deleteFailed = false;
try { $db->delete('products', ['id' => $retired['id']], false, $admin); } catch (RuntimeException $e) { $deleteFailed = str_contains($e->getMessage(), 'Could not delete product'); }
check('a native trash veto refuses ordinary product deletion', $deleteFailed && get_post_status($retired['id']) === 'publish');
eq('a refused product delete rolls category relationships back', $db->findFirst('products', ['where' => ['id' => $retired['id']]])['categories'], $retired['categories']);
eq('a refused product delete clears stale native relationship caches', wp_get_object_terms($retired['id'], 'product_cat', ['fields' => 'ids']), $retired['categories']);
$batchFailed = false;
try {
    $db->transaction(static function () use ($db, $batchFirst, $retired, $admin): void {
        $db->delete('products', ['id' => $batchFirst['id']], false, $admin);
        eq('the first product is trashed before a later deletion veto', get_post_status($batchFirst['id']), 'trash');
        $db->delete('products', ['id' => $retired['id']], false, $admin);
    });
} catch (RuntimeException $e) { $batchFailed = str_contains($e->getMessage(), 'Could not delete product'); }
check('a later product veto rolls back the whole batch', $batchFailed);
eq('batch rollback restores the first product database status', $site->scalar('SELECT post_status FROM {prefix}posts WHERE ID = ?', [$batchFirst['id']]), 'publish');
eq('batch rollback clears the first product native post cache', get_post_status($batchFirst['id']), 'publish');
$trashFailed = false;
try { $db->transaction(static fn () => \TypedPress\Sync\Trash::trash('products', $spec, $retired, $admin)); } catch (RuntimeException $e) { $trashFailed = str_contains($e->getMessage(), 'Could not move post'); }
check('a vetoed native product trash is reported as a failure', $trashFailed && get_post_status($retired['id']) !== 'trash');
remove_filter('pre_trash_post', $vetoTrash, PHP_INT_MAX);
add_action('woocommerce_trash_product', static function ($id) use (&$wooTrashed, $retired): void { if ((int) $id === $retired['id']) { $wooTrashed++; } });
$db->transaction(static fn () => \TypedPress\Sync\Trash::trash('products', $spec, $retired, $admin));
eq('explicit sync retirement uses Woo CRUD and its lifecycle hook', [get_post_status($retired['id']), $wooTrashed], ['trash', 1]);
problem('trashed products retain ownership of their UID', fn () => $db->insert('products', ['name' => 'Duplicate trashed product UID', 'uid' => $retired['uid']], true, $admin), 409, 'unique_violation', '/uid');
eq('duplicate refusal preserves the trashed product identity', [get_post_status($retired['id']), get_post_meta($retired['id'], '_tp_uid', true)], ['trash', $retired['uid']]);

// A stock update bypasses post save; both the product and any page that listed it must purge.
$purged = [];
add_action('tp_purge_urls', static function ($urls) use (&$purged): void { $purged = array_merge($purged, $urls); });
$stocked = wc_get_product($guide['id']); $stocked->set_manage_stock(true); $stocked->save();
\TypedPress\Wp\Purges::flush(); $purged = [];
\TypedPress\Render\Cache::record('/products/field-guide', ['products' => ['ids' => [$guide['id']], 'listed' => false]]);
\TypedPress\Render\Cache::record('/catalog-stock-test', ['products' => ['ids' => [], 'listed' => true]]);
wc_update_product_stock($stocked, 3);
\TypedPress\Wp\Purges::flush();
$purgedPaths = array_map(static fn ($url) => rtrim($url, '/'), $purged);
check('native stock updates purge item and listing reads', in_array('/products/field-guide', $purgedPaths, true) && in_array('/catalog-stock-test', $purgedPaths, true), $purged);

// Real HTTP authentication: the administrator's capability never bypasses the credential's scope.
[$password, $item] = WP_Application_Passwords::create_new_application_password($site->userId('admin'), ['name' => 'Commerce test agent']);
\TypedPress\Wp\AgentScope::store($site->userId('admin'), $item['uuid'], \TypedPress\Wp\AgentScope::DEFAULT);
$request = static function (string $path, string $method = 'GET', ?array $body = null, array $headers = []) use ($site, $password): array {
    $ch = curl_init($site->url() . $path);
    $responseHeaders = [];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => ['Authorization: Basic ' . base64_encode('admin:' . $password), 'Content-Type: application/json', 'Accept: application/json, text/event-stream', ...$headers],
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$responseHeaders): int { $parts = explode(':', $line, 2); if (count($parts) === 2) { $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]); } return strlen($line); }]);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POSTFIELDS, wp_json_encode($body)); }
    $text = curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), json_decode((string) $text, true), $responseHeaders];
};
eq('scoped read credential reads public catalog', $request('/wp-json/typedpress/v1/products')[0], 200);
$scopedGuide = array_values(array_filter($request('/wp-json/typedpress/v1/products')[1]['data'], static fn ($p) => $p['sku'] === 'GUIDE-PDF'))[0];
check('a credential without personal scope cannot export download locations', !array_key_exists('file', $scopedGuide['downloads'][0]));
eq('orders need the personal grant on the facade', $request('/wp-json/typedpress/v1/orders')[0], 403);
eq('orders need the personal grant on native TypedPress REST', $request('/wp-json/wp/v2/tp_orders')[0], 403);
eq('orders need the personal grant on abilities', $request('/wp-json/wp-abilities/v1/abilities/shop/orders-list/run?input=%7B%7D')[0], 403);
eq('scoped credentials cannot run Woo abilities', $request('/wp-json/wp-abilities/v1/abilities/woocommerce/orders-query/run?input=%7B%7D')[0], 403);
$initialize = $request('/wp-json/mcp/typedpress-shop', 'POST', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => ['protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(), 'clientInfo' => ['name' => 'Commerce test', 'version' => '1']]]);
$tools = $request('/wp-json/mcp/typedpress-shop', 'POST', ['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list', 'params' => new stdClass()], ['Mcp-Session-Id: ' . ($initialize[2]['mcp-session-id'] ?? ''), 'Mcp-Protocol-Version: 2025-11-25']);
$names = array_column($tools[1]['result']['tools'] ?? [], 'name');
check('an agent without personal scope sees product and store tools, no order or Woo tools', $tools[0] === 200 && in_array('shop-products-list', $names, true) && in_array('shop-store-get', $names, true) && !array_filter($names, static fn ($n) => str_starts_with($n, 'shop-orders-') || str_starts_with($n, 'woocommerce-')), $tools);
eq('a read-only agent cannot edit a product', $request('/wp-json/typedpress/v1/products/' . $guide['id'], 'PATCH', ['name' => 'Refused'])[0], 403);
\TypedPress\Wp\AgentScope::store($site->userId('admin'), $item['uuid'], ['write' => true, 'personal' => false, 'abilities' => null]);
eq('a write grant alone cannot change protected download locations', $request('/wp-json/typedpress/v1/products/' . $guide['id'], 'PATCH', ['downloads' => [['id' => 'field-guide', 'name' => 'Field guide', 'file' => 'https://private.example.test/new.pdf']]])[0], 403);
$protectedCreate = ['name' => 'Scoped download create probe', 'virtual' => true, 'downloadable' => true, 'downloads' => [['id' => 'scoped-file', 'name' => 'Scoped file', 'file' => 'https://create-scope.example.test/files/file.pdf']]];
$beforeScopedApproval = $directories->count(true);
$refusedCreate = $request('/wp-json/typedpress/v1/products', 'POST', $protectedCreate);
eq('a write grant alone cannot create protected download locations, and the refusal names the missing grant', [$refusedCreate[0], $refusedCreate[1]['code'] ?? null], [403, 'scope']);
eq('refused scoped creation leaves no product', $db->findFirst('products', ['where' => ['name' => $protectedCreate['name']]]), null);
eq('refused scoped creation leaves download approvals unchanged', $directories->count(true), $beforeScopedApproval);
eq('a write grant can still create a product without protected fields', $request('/wp-json/typedpress/v1/products', 'POST', ['name' => 'Scoped ordinary create probe', 'price' => '1.00'])[0], 201);
eq('Woo REST cannot bypass the app scope', $request('/wp-json/wc/v3/orders')[0], 403);
eq('Woo core product REST aliases cannot bypass the app scope', $request('/wp-json/wp/v2/product')[0], 403);
eq('Woo core term REST aliases cannot bypass the app scope', $request('/wp-json/wp/v2/product_cat')[0], 403);
\TypedPress\Wp\AgentScope::store($site->userId('admin'), $item['uuid'], ['write' => true, 'personal' => true, 'abilities' => null]);
$protectedCreate['name'] = 'Personal download create probe';
eq('the personal grant permits protected product creation', $request('/wp-json/typedpress/v1/products', 'POST', $protectedCreate)[0], 201);
eq('authorized creation persists the protected download location', $db->findFirst('products', ['where' => ['name' => $protectedCreate['name']]])['downloads'][0]['file'], $protectedCreate['downloads'][0]['file']);
eq('personal grant permits authorized order reads', $request('/wp-json/typedpress/v1/orders')[0], 200);
$privateGuide = array_values(array_filter($request('/wp-json/typedpress/v1/products')[1]['data'], static fn ($p) => $p['sku'] === 'GUIDE-PDF'))[0];
check('an administrator credential with personal scope retains download management', is_string($privateGuide['downloads'][0]['file'] ?? null));
eq('even a personal write agent cannot use Woo REST', $request('/wp-json/wc/v3/orders')[0], 403);
eq('even a personal write agent cannot use Woo core aliases', $request('/wp-json/wp/v2/product')[0], 403);
eq('orders remain read-only with every grant', $request('/wp-json/typedpress/v1/orders', 'POST', [])[0], 405);
// An administrator who turns HPOS synchronization on closes the shop, not wp-admin. Woo itself
// refuses HPOS as the authoritative storage while orders are unsynchronized, so this is the first step.
foreach (['woocommerce_custom_orders_table_data_sync_enabled'] as $option) {
    update_option($option, 'yes');
    $login = curl_init($site->url() . '/wp-login.php');
    curl_setopt_array($login, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60]);
    curl_exec($login);
    eq('WordPress login survives ' . $option, (int) curl_getinfo($login, CURLINFO_RESPONSE_CODE), 200);
    $closed = $request('/wp-json/typedpress/v1/store');
    eq('the shop is unavailable under ' . $option, [$closed[0], $closed[1]['code'] ?? null], [503, 'unavailable']);
    check('the reason is logged for the administrator', str_contains($site->debugLog(), 'TypedPress commerce requires legacy order storage'));
    eq('native checkout is refused under ' . $option, $request('/wp-json/wc/store/v1/checkout', 'POST', [])[0], 503);
    update_option($option, 'no');
    eq('the shop returns once storage is changed back from ' . $option, $request('/wp-json/typedpress/v1/store')[0], 200);
}
// A request-time install failure refuses TypedPress and leaves core admin available for repairs.
\TypedPress\Wp\InstallMarker::forget(); delete_option('tp_shop_shipping');
add_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
\TypedPress\Commerce\Module::onInit($plugin);
check('request installation failure is caught and remains retryable', str_contains($plugin->unavailable() ?? '', 'Could not add source shipping method') && !get_option(\TypedPress\Wp\InstallMarker::OPTION));
foreach (['/wc/store/v1/checkout', '/wc/store/v1/checkout/' . $order->get_id()] as $route) {
    $response = rest_do_request(new WP_REST_Request('POST', $route));
    eq('unavailable shop refuses native checkout before payment', [$response->get_status(), $response->get_data()['code'] ?? null], [503, 'tp_unavailable']);
}
remove_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
\TypedPress\Commerce\Module::initialize($plugin);
eq('repair can finish shipping installation after the request failure', \TypedPress\Commerce\Module::plan($plugin), []);
$log = $site->debugLog();
check('commerce runtime has no PHP warnings or fatal errors', !preg_match('/PHP (Warning|Fatal error):/', $log), $log);
finish('commerce');
