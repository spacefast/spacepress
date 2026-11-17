<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp = wpSite('commerce', ['wpContent' => $argv[1], 'users' => ['ed' => 'editor'], 'server' => true]);
$plugin = $wp->plugin();
$db = $wp->app()->db;
$admin = new \TypedPress\Viewer(['id' => $wp->userId('admin'), 'name' => 'Admin', 'role' => 'admin']);
$guest = new \TypedPress\Viewer(null);
$products = $db->findMany('products', ['orderBy' => ['id' => 'asc']], $guest);
eq('a fresh installation seeds both native products', count($products), 2);
$mug = array_values(array_filter($products, static fn ($p) => $p['sku'] === 'MUG-BLUE'))[0];
$guide = array_values(array_filter($products, static fn ($p) => $p['sku'] === 'GUIDE-PDF'))[0];
eq('price is an exact decimal string', $mug['price'], '24.00');
eq('source currency is live without admin setup', get_woocommerce_currency(), 'EUR');
eq('source country is live', WC()->countries->get_base_country(), 'PL');
eq('source terms resolve to native term identities', get_term($mug['categories'][0], 'product_cat')->name, 'Home');
eq('categories load through with', $db->findFirst('products', ['where' => ['id' => $mug['id']], 'with' => ['categories' => true]], $guest)['categories'][0]['name'], 'Home');
$child = $db->insert('categories', ['name' => 'Child category', 'parent' => $mug['categories'][0]], true, $admin)[0];
$termWire = \TypedPress\Sync\Wire::encode('categories', [$child])[0]['record'];
eq('term parents sync through portable UIDs', $termWire['fields']['parent'], get_term_meta($mug['categories'][0], '_tp_uid', true));
check('native taxonomy registration is retained', get_taxonomy('product_cat')->cap->manage_terms === 'manage_product_terms');
check('source enables COD', isset(WC()->payment_gateways()->get_available_payment_gateways()['cod']));
$zones = WC_Shipping_Zones::get_zones();
eq('source shipping zones are present', array_column($zones, 'zone_name'), ['Poland', 'Germany']);
foreach (['woocommerce_custom_orders_table_enabled', 'woocommerce_custom_orders_table_data_sync_enabled'] as $option) {
    update_option($option, 'yes');
    foreach ([static fn () => \TypedPress\Commerce\Module::checkOrderStorage(), static function () use ($plugin): void { require dirname($plugin->dir, 2) . '/mu-plugins/typedpress-commerce.php'; }] as $policy) {
        $refused = false;
        try { $policy(); } catch (RuntimeException $e) { $refused = str_contains($e->getMessage(), 'legacy order storage'); }
        check('existing HPOS or synchronization is refused without overriding ' . $option, $refused && get_option($option) === 'yes');
    }
    update_option($option, 'no');
}
foreach (['/%63art', '/%63heckout', '/%63heckout/order-received/123', '//checkout/'] as $path) {
    check('encoded or normalized private route stays private: ' . $path, \TypedPress\Commerce\Module::privatePath($plugin, $path));
}
update_option('woocommerce_checkout_pay_endpoint', 'pay');
eq('custom Woo endpoint resolves to checkout', \TypedPress\Commerce\Module::routePath($plugin, '/checkout/pay/123'), '/checkout');
eq('custom Woo endpoint populates the canonical query variable', get_query_var('order-pay'), '123');
delete_option('woocommerce_checkout_pay_endpoint');
check('Woo checkout is a real Page containing its native block', ($checkout = \TypedPress\Commerce\Module::checkoutPage($plugin)) > 0 && has_block('woocommerce/checkout', get_post($checkout)));
$originalCheckout = get_post_field('post_content', $checkout);
wp_update_post(['ID' => $checkout, 'post_content' => 'Removed checkout']);
eq('an editor cannot remove the Checkout Block', get_post_field('post_content', $checkout), $originalCheckout);
eq('checkout cannot be trashed', wp_trash_post($checkout), false);
$zoneIds = array_keys($zones);
$methodIds = array_map(static fn ($z) => array_keys($z['shipping_methods']), $zones);
\TypedPress\Commerce\Module::initialize($plugin);
eq('unchanged source does not recreate shipping methods', array_map(static fn ($z) => array_keys($z['shipping_methods']), WC_Shipping_Zones::get_zones()), $methodIds);
$extra = new WC_Shipping_Zone(); $extra->set_zone_name('Admin addition'); $extra->save();
eq('shipping drift is included in the install plan', array_column(\TypedPress\Commerce\Module::plan($plugin), 'id'), ['commerce-shipping']);
$noMethods = static fn () => [];
add_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
$shippingFailed = false;
try { \TypedPress\Commerce\Module::initialize($plugin); } catch (RuntimeException $e) { $shippingFailed = str_contains($e->getMessage(), 'Could not add source shipping method'); }
check('failed shipping writes do not record a completed installation', $shippingFailed && \TypedPress\Commerce\Module::plan($plugin) !== []);
remove_filter('woocommerce_shipping_methods', $noMethods, PHP_INT_MAX);
\TypedPress\Commerce\Module::initialize($plugin);
eq('source shipping restores its whole zone list after an admin edit', array_column(WC_Shipping_Zones::get_zones(), 'zone_name'), ['Poland', 'Germany']);
eq('successful shipping retry clears the install plan', \TypedPress\Commerce\Module::plan($plugin), []);
check('the API exposes storefront-visible products to guests', count($products) === 2);
problem('guests cannot write products', fn () => $db->insert('products', ['name' => 'No'], true, $guest), 401, 'unauthenticated');
problem('guests cannot read orders', fn () => $db->findMany('orders', [], $guest), 401, 'unauthenticated');
problem('editors cannot read orders', fn () => $db->findMany('orders', [], new \TypedPress\Viewer(['id' => $wp->userId('ed'), 'name' => 'Editor', 'role' => 'editor'])), 403, 'forbidden');
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
$categoryUid = \TypedPress\Sync\Uid::mint(); $productUid = \TypedPress\Sync\Uid::mint();
$seedProduct = $wire; $seedProduct['uid'] = $productUid;
$seedProduct['fields'] = array_replace($seedProduct['fields'], ['name' => 'Dry-run product', 'slug' => 'dry-run-product', 'sku' => 'DRY-RUN', 'categories' => [$categoryUid]]);
file_put_contents($seedDir . '/categories.json', wp_json_encode(['collection' => 'categories', 'format' => 'md', 'records' => [['uid' => $categoryUid, 'fields' => ['name' => 'Dry-run category', 'slug' => 'dry-run-category']]]]));
file_put_contents($seedDir . '/products.json', wp_json_encode(['collection' => 'products', 'format' => 'md', 'records' => [$seedProduct]]));
$dry = \TypedPress\Sync\Seed::run($plugin, $seedDir, true);
eq('a dry run resolves references between new seed collections', [$dry['categories']['created'], $dry['products']['created']], [1, 1]);
eq('the dry run rolls back terms and products together', [$db->findFirst('categories', ['where' => ['uid' => $categoryUid]]), $db->findFirst('products', ['where' => ['uid' => $productUid]])], [null, null]);
unlink($seedDir . '/categories.json'); unlink($seedDir . '/products.json'); rmdir($seedDir);
$uids = array_column($db->findMany('products'), 'uid');
$db->delete('products', ['id' => $mug['id']], false, $admin);
eq('product delete uses native Woo trash', get_post_status($mug['id']), 'trash');
check('orders are not removed by catalog retirement', wc_get_order($order->get_id()) instanceof WC_Order);
$retired = $db->insert('products', ['name' => 'Trash probe', 'price' => '1.00'], true, $admin)[0];
$wooTrashed = 0;
$vetoTrash = static fn ($check, $post) => (int) $post->ID === $retired['id'] ? false : $check;
add_filter('pre_trash_post', $vetoTrash, PHP_INT_MAX, 2);
$trashFailed = false;
try { $db->transaction(static fn () => \TypedPress\Sync\Trash::trash('products', $spec, $retired)); } catch (RuntimeException $e) { $trashFailed = str_contains($e->getMessage(), 'Could not move post'); }
check('a vetoed native product trash is reported as a failure', $trashFailed && get_post_status($retired['id']) !== 'trash');
remove_filter('pre_trash_post', $vetoTrash, PHP_INT_MAX);
add_action('woocommerce_trash_product', static function ($id) use (&$wooTrashed, $retired): void { if ((int) $id === $retired['id']) { $wooTrashed++; } });
$db->transaction(static fn () => \TypedPress\Sync\Trash::trash('products', $spec, $retired));
eq('explicit sync retirement uses Woo CRUD and its lifecycle hook', [get_post_status($retired['id']), $wooTrashed], ['trash', 1]);

// A stock update bypasses post save; both the product and any page that listed it must purge.
$purged = [];
add_action('tp_purge_urls', static function ($urls) use (&$purged): void { $purged = array_merge($purged, $urls); });
\TypedPress\Render\Cache::record('/products/field-guide', ['products' => ['ids' => [$guide['id']], 'listed' => false]]);
\TypedPress\Render\Cache::record('/catalog-stock-test', ['products' => ['ids' => [], 'listed' => true]]);
$stocked = wc_get_product($guide['id']); $stocked->set_manage_stock(true); $stocked->save();
wc_update_product_stock($stocked, 3);
\TypedPress\Wp\Purges::flush();
check('native stock updates purge item and listing reads', in_array('/products/field-guide', $purged, true) && in_array('/catalog-stock-test', $purged, true), $purged);

// Real HTTP authentication: the administrator's capability never bypasses the credential's scope.
[$password, $item] = WP_Application_Passwords::create_new_application_password($wp->userId('admin'), ['name' => 'Commerce test agent']);
\TypedPress\Wp\AgentScope::store($wp->userId('admin'), $item['uuid'], \TypedPress\Wp\AgentScope::DEFAULT);
$request = static function (string $path, string $method = 'GET', ?array $body = null, array $headers = []) use ($wp, $password): array {
    $ch = curl_init($wp->url() . $path);
    $responseHeaders = [];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => ['Authorization: Basic ' . base64_encode('admin:' . $password), 'Content-Type: application/json', 'Accept: application/json, text/event-stream', ...$headers],
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$responseHeaders): int { $parts = explode(':', $line, 2); if (count($parts) === 2) { $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]); } return strlen($line); }]);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POSTFIELDS, wp_json_encode($body)); }
    $text = curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), json_decode((string) $text, true), $responseHeaders];
};
eq('scoped read credential reads public catalog', $request('/__tp/api/v1/products')[0], 200);
eq('orders need the personal grant on the facade', $request('/__tp/api/v1/orders')[0], 403);
eq('orders need the personal grant on native TypedPress REST', $request('/wp-json/wp/v2/tp_orders')[0], 403);
eq('orders need the personal grant on abilities', $request('/wp-json/wp-abilities/v1/abilities/shop/orders-list/run?input=%7B%7D')[0], 403);
eq('scoped credentials cannot run Woo abilities', $request('/wp-json/wp-abilities/v1/abilities/woocommerce/orders-query/run?input=%7B%7D')[0], 403);
$initialize = $request('/wp-json/mcp/typedpress-shop', 'POST', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize', 'params' => ['protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(), 'clientInfo' => ['name' => 'Commerce test', 'version' => '1']]]);
$tools = $request('/wp-json/mcp/typedpress-shop', 'POST', ['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list', 'params' => new stdClass()], ['Mcp-Session-Id: ' . ($initialize[2]['mcp-session-id'] ?? ''), 'Mcp-Protocol-Version: 2025-11-25']);
$names = array_column($tools[1]['result']['tools'] ?? [], 'name');
check('an agent without personal scope sees product and store tools, no order or Woo tools', $tools[0] === 200 && in_array('shop-products-list', $names, true) && in_array('shop-store-get', $names, true) && !array_filter($names, static fn ($n) => str_starts_with($n, 'shop-orders-') || str_starts_with($n, 'woocommerce-')), $tools);
eq('a read-only agent cannot edit a product', $request('/__tp/api/v1/products/' . $guide['id'], 'PATCH', ['name' => 'Refused'])[0], 403);
eq('Woo REST cannot bypass the app scope', $request('/wp-json/wc/v3/orders')[0], 403);
eq('Woo core product REST aliases cannot bypass the app scope', $request('/wp-json/wp/v2/product')[0], 403);
eq('Woo core term REST aliases cannot bypass the app scope', $request('/wp-json/wp/v2/product_cat')[0], 403);
\TypedPress\Wp\AgentScope::store($wp->userId('admin'), $item['uuid'], ['write' => true, 'personal' => true, 'abilities' => null]);
eq('personal grant permits authorized order reads', $request('/__tp/api/v1/orders')[0], 200);
eq('even a personal write agent cannot use Woo REST', $request('/wp-json/wc/v3/orders')[0], 403);
eq('even a personal write agent cannot use Woo core aliases', $request('/wp-json/wp/v2/product')[0], 403);
eq('orders remain read-only with every grant', $request('/__tp/api/v1/orders', 'POST', [])[0], 405);
$log = $wp->debugLog();
check('commerce runtime has no PHP warnings or fatal errors', !preg_match('/PHP (Warning|Fatal error):/', $log), $log);
finish('commerce');
