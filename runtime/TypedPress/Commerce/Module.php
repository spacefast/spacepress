<?php

declare(strict_types=1);

namespace TypedPress\Commerce;

use TypedPress\Wp\Plugin;
use TypedPress\Wp\Runtime;

/** Source settings and deliberately small v1 Woo policy, active only with a store() export. */
final class Module
{
    public static function register(Plugin $plugin): void
    {
        $store = $plugin->schema->commerce();
        if ($store === null) { return; }
        \TypedPress\Extensions::route('store', static function ($method, $segments) use ($plugin): array {
            \TypedPress\App::allow($method, ['GET', 'HEAD']);
            if (count($segments) !== 1) { throw \TypedPress\HttpError::notFound('No such store route'); }
            return [200, self::information($plugin)];
        });
        \TypedPress\Extensions::normalizeWrite(static function (string $op, string $collection, array &$data) use ($plugin): void {
            if ($plugin->schema->hasCollection($collection) && ($plugin->schema->collection($collection)['commerce'] ?? '') === 'product' && array_key_exists('price', $data) && $data['price'] !== null && !is_string($data['price'])) { throw \TypedPress\HttpError::invalidInput('Price must be an exact decimal string', '/price'); }
        });
        \TypedPress\Extensions::beforeRead(static function (string $collection, array &$opts, ?\TypedPress\Viewer $viewer) use ($plugin): void {
            if (!$plugin->schema->hasCollection($collection)) { return; }
            $kind = $plugin->schema->collection($collection)['commerce'] ?? '';
            if (!in_array($kind, ['product', 'order'], true)) { return; }
            if ($kind === 'order' && !\TypedPress\Wp\AgentScope::may('personal')) { throw \TypedPress\Wp\AgentScope::refusal('personal'); }
            $fields = $kind === 'product' ? ['id', 'uid', 'name', 'slug', 'description', 'shortDescription', 'status', 'sku', 'price', 'availability', 'virtual', 'downloadable', 'categories', 'tags'] : ['id', 'status', 'createdAt', 'updatedAt', 'customer', 'total', 'currency'];
            $where = static function (array $filter) use (&$where, $fields): void {
                foreach ($filter as $key => $value) {
                    if (in_array($key, ['AND', 'OR'], true)) { foreach ($value as $part) { $where($part); } }
                    elseif ($key === 'NOT') { $where($value); }
                    elseif (!in_array($key, $fields, true)) { throw \TypedPress\HttpError::invalidInput('This commerce field is not filterable in v1', '/where/' . $key); }
                }
            };
            if (is_array($opts['where'] ?? null)) { $where($opts['where']); }
            foreach ($opts['orderBy'] ?? [] as $key => $value) {
                if (!in_array($key, $fields, true)) { throw \TypedPress\HttpError::invalidInput('This commerce field is not sortable in v1', '/orderBy/' . $key); }
            }
        }, true);
        add_filter('tp_ability_operations', static function (array $ops, string $app) use ($plugin): array {
            $ops[] = ['name' => $app . '/store-get', 'op' => 'get', 'agents' => true, 'typedpress' => ['store' => true], 'label' => 'Read store information', 'description' => 'Currency, precision, store country and checkout URL.', 'input' => ['type' => 'object', 'properties' => new \stdClass(), 'additionalProperties' => false], 'output' => ['type' => 'object'], 'annotations' => ['readonly' => true, 'idempotent' => true], 'rule' => [['role' => 'anyone'], 'read', 'read store'], 'run' => static fn () => self::information($plugin)];
            return $ops;
        }, 10, 2);
        global $wpdb;
        if (strlen($wpdb->prefix) > 20) { throw new \RuntimeException('WooCommerce requires a WordPress table prefix of at most 20 characters'); }
        if (!defined('WC_VERSION') || version_compare(WC_VERSION, '11.3.0', '<')) { throw new \RuntimeException('This store requires WooCommerce 11.3.0 or later'); }
        self::checkOrderStorage();
        $options = [
            'woocommerce_enable_coupons' => 'no', 'woocommerce_enable_reviews' => 'no', 'woocommerce_enable_review_rating' => 'no',
            'woocommerce_enable_signup_and_login_from_checkout' => 'no', 'woocommerce_enable_myaccount_registration' => 'no', 'woocommerce_enable_delayed_account_creation' => 'no',
            'woocommerce_enable_guest_checkout' => 'yes', 'woocommerce_calc_taxes' => 'no', 'woocommerce_coming_soon' => 'no',
            'woocommerce_currency' => $store['currency'], 'woocommerce_default_country' => $store['country'],
        ];
        foreach (['line1' => 'address', 'line2' => 'address_2', 'city' => 'city', 'postcode' => 'postcode'] as $field => $suffix) { if (isset($store['address'][$field])) { $options['woocommerce_store_' . $suffix] = $store['address'][$field]; } }
        foreach (['weight', 'dimension'] as $field) { if (isset($store['units'][$field])) { $options['woocommerce_' . $field . '_unit'] = $store['units'][$field]; } }
        foreach (['fromName' => 'name', 'fromAddress' => 'address'] as $field => $suffix) { if (isset($store['email'][$field])) { $options['woocommerce_email_from_' . $suffix] = $store['email'][$field]; } }
        if (isset($store['sellTo'])) {
            $options['woocommerce_allowed_countries'] = $store['sellTo'] === 'all' ? 'all' : 'specific';
            $options['woocommerce_specific_allowed_countries'] = $store['sellTo'] === 'all' ? [] : $store['sellTo'];
            $options['woocommerce_ship_to_countries'] = ''; // Woo: ship to every selling country.
        }
        foreach ($options as $name => $value) { add_filter('pre_option_' . $name, static fn () => $value, PHP_INT_MAX); }
        foreach (['woocommerce_coupons_enabled', 'wc_tax_enabled', 'woocommerce_product_backorders_allowed', 'woocommerce_product_is_on_sale'] as $hook) { add_filter($hook, '__return_false', PHP_INT_MAX); }
        add_filter('woocommerce_product_get_backorders', static fn () => 'no', PHP_INT_MAX);
        add_filter('woocommerce_product_get_stock_status', static fn ($status) => $status === 'onbackorder' ? 'outofstock' : $status, PHP_INT_MAX);
        add_filter('woocommerce_product_get_sale_price', static fn () => '', PHP_INT_MAX);
        add_filter('woocommerce_product_get_price', static fn ($price, $product) => $product->get_regular_price(), PHP_INT_MAX, 2);
        add_filter('woocommerce_create_pages', '__return_empty_array', PHP_INT_MAX);
        add_filter('woocommerce_get_cart_url', static fn () => home_url('/cart'));
        add_filter('woocommerce_get_checkout_page_id', static fn ($id) => self::checkoutPage($plugin) ?: $id);
        if (isset($store['payments'])) {
            add_filter('woocommerce_available_payment_gateways', static function (array $gateways) use ($store): array {
                $out = []; foreach ($store['payments'] as $id) { if (isset($gateways[$id])) { $out[$id] = $gateways[$id]; } } return $out;
            }, PHP_INT_MAX);
            // Source enables built-in offline gateways too; credentials for other gateways remain Woo's.
            foreach ($store['payments'] as $id) {
                if (in_array($id, ['cod', 'bacs', 'cheque'], true)) { foreach (['option_', 'default_option_'] as $prefix) { add_filter($prefix . 'woocommerce_' . $id . '_settings', static fn ($settings) => array_replace(is_array($settings) ? $settings : [], ['enabled' => 'yes'])); } }
            }
        }
        add_action('init', static fn () => self::onInit($plugin), 20);
        // Source-owned fields are visibly locked, including disabled v1 features.
        add_filter('woocommerce_get_settings_products', static fn ($settings) => self::settings($settings, $options), PHP_INT_MAX);
        foreach (['general', 'tax', 'accounts', 'email'] as $section) { add_filter('woocommerce_get_settings_' . $section, static fn ($settings) => self::settings($settings, $options), PHP_INT_MAX); }
        if (array_key_exists('shipping', $store)) {
            foreach (['shipping_zones_save_changes', 'shipping_zone_add_method', 'shipping_zone_remove_method', 'shipping_zone_methods_save_changes', 'shipping_zone_methods_save_settings'] as $action) {
                add_action('wp_ajax_woocommerce_' . $action, static function (): void { wp_send_json_error(['message' => 'Shipping zones are managed by TypedPress source.'], 403); }, 0);
            }
            add_action('woocommerce_settings_shipping', static function (): void {
                echo '<div class="notice notice-info inline"><p>Shipping zones are managed by TypedPress source.</p></div><script>document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll("#mainform input,#mainform button,#mainform select,#mainform textarea,.wc-shipping-zone-methods .wc-shipping-zone-method-settings").forEach(function(el){el.disabled=true;el.setAttribute("aria-disabled","true");});});</script>';
            }, 1);
        }
        foreach (['pre_delete_post', 'pre_trash_post'] as $hook) { add_filter($hook, static fn ($check, $post) => $post instanceof \WP_Post && $post->ID === self::checkoutPage($plugin) ? false : $check, PHP_INT_MAX, 2); }
        add_filter('wp_insert_post_data', static function (array $data, array $input) use ($plugin): array {
            $id = (int) ($input['ID'] ?? 0);
            if ($id > 0 && $id === self::checkoutPage($plugin) && !self::containsCheckout(parse_blocks(wp_unslash($data['post_content'] ?? '')))) {
                $data['post_content'] = wp_slash(get_post_field('post_content', $id, 'raw'));
            }
            return $data;
        }, PHP_INT_MAX, 2);
        add_filter('tp_markdown_twin', static fn ($has, $post) => (int) $post->ID === self::checkoutPage($plugin) ? false : $has, 10, 2);
        add_filter('wp_sitemaps_posts_query_args', static function (array $args, string $type) use ($plugin): array {
            if ($type === 'page' && ($id = self::checkoutPage($plugin)) > 0) { $args['post__not_in'] = [...($args['post__not_in'] ?? []), $id]; }
            return $args;
        }, 10, 2);
        add_filter('wp_robots', static function ($robots) use ($plugin) { if (self::privatePath($plugin, (string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH))) { $robots['noindex'] = true; } return $robots; });
        foreach (['woocommerce_new_product', 'woocommerce_update_product', 'woocommerce_delete_product'] as $hook) { add_action($hook, static fn ($id) => self::changed($plugin, 'product', (int) $id)); }
        foreach (['created_term', 'edited_term', 'delete_term'] as $hook) { add_action($hook, static function ($id, $tt, $taxonomy) use ($plugin): void { $kind = ['product_cat' => 'productCategory', 'product_tag' => 'productTag'][$taxonomy] ?? null; if ($kind) { self::changed($plugin, $kind, (int) $id); } }, 10, 3); }
        add_action('template_redirect', static function () use ($plugin): void {
            $canonical = is_singular('product') ? get_permalink() : ((is_tax('product_cat') || is_tax('product_tag')) ? get_term_link(get_queried_object()) : (is_post_type_archive('product') ? home_url('/shop') : null));
            if ($canonical === null) { return; }
            if (!is_string($canonical) || !\TypedPress\Wp\AppRouter::instance()?->serves($canonical)) {
                $GLOBALS['wp_query']->set_404(); status_header(404); return;
            }
            $path = (string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
            if (rtrim($path, '/') !== rtrim((string) wp_parse_url($canonical, PHP_URL_PATH), '/')) { wp_safe_redirect($canonical, 301); exit; }
        }, 0);
        foreach (['woocommerce_product_set_stock', 'woocommerce_product_set_stock_status'] as $hook) {
            add_action($hook, static function ($subject) use ($plugin): void { $id = $subject instanceof \WC_Product ? $subject->get_id() : (int) $subject; $post = get_post($id); if ($post) { \TypedPress\Wp\Purges::saved($plugin, $id, $post); self::changed($plugin, 'product', $id); } }, 10, 1);
        }
    }

    /** Request-time installation keeps wp-admin usable on failure; managed initialization still throws. */
    public static function onInit(Plugin $plugin): void
    {
        $type = get_post_type_object('product'); if ($type) { $type->show_in_abilities = false; }
        try {
            if (Runtime::installs()) { self::initialize($plugin); }
            if (!Runtime::managed() && is_file($plugin->dir . '/tp/app/seed-version.php') && $plugin->unavailable() === null) {
                $version = require $plugin->dir . '/tp/app/seed-version.php';
                if (!is_array($version) && !(is_string($version) && preg_match('/^[a-f0-9]{64}$/D', $version))) {
                    throw new \RuntimeException('Invalid commerce seed version');
                }
                $key = 'tp_' . $plugin->schema->name() . '_seed';
                if (get_option($key) !== $version) {
                    \TypedPress\Wp\Migrator::locked($plugin->connection(), 'commerce_seed', static function () use ($plugin, $key, $version): void {
                        // A request waiting for the first seed must see its committed marker.
                        wp_cache_delete($key, 'options'); wp_cache_delete('alloptions', 'options'); wp_cache_delete('notoptions', 'options');
                        if (get_option($key) === $version) { return; }
                        $seed = $plugin->dir . '/tp/app/seed';
                        if (is_dir($seed)) {
                            // Older compiler versions emitted one digest and one PHP file per synced kind.
                            if (is_string($version)) {
                                foreach ($plugin->schema->kinds() as $kind => $spec) {
                                    if (isset($spec['sync']) && !is_file("$seed/$kind.php")) {
                                        throw new \RuntimeException("Missing commerce seed file for $kind");
                                    }
                                }
                            }
                            \TypedPress\Sync\Seed::run($plugin, $seed, false, is_array($version) ? $version : null);
                        } elseif ($version !== [] && $version !== hash('sha256', '')) {
                            throw new \RuntimeException('Missing commerce seed directory for a nonempty seed version');
                        }
                        update_option($key, $version, false);
                    });
                }
            }
        } catch (\Throwable $e) {
            $problem = $e->getMessage();
            $plugin->refuse($problem); \TypedPress\Wp\InstallMarker::forget();
            error_log('[typedpress] ' . $problem);
            add_action('admin_notices', static function () use ($problem): void {
                if (current_user_can('manage_options')) { printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('TypedPress: ' . $problem)); }
            });
        }
    }

    private static function changed(Plugin $plugin, string $resource, int $id): void
    {
        foreach ($plugin->schema->kinds() as $name => $spec) {
            if (($spec['commerce'] ?? '') === $resource) {
                $plugin->app();
                \TypedPress\Render\Cache::written('update', (string) $name, ['id' => $id], null);
                return;
            }
        }
    }

    private static function settings(array $settings, array $options): array
    {
        foreach ($settings as &$setting) { if (array_key_exists($setting['id'] ?? '', $options)) { $setting['custom_attributes']['disabled'] = 'disabled'; $setting['desc'] = ($setting['desc'] ?? '') . ' Managed by TypedPress source.'; } } unset($setting); return $settings;
    }
    public static function checkOrderStorage(): void
    {
        global $wpdb;
        foreach (['woocommerce_custom_orders_table_enabled', 'woocommerce_custom_orders_table_data_sync_enabled'] as $option) {
            $value = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $option));
            if ($wpdb->last_error !== '') {
                throw new \RuntimeException('Unable to verify WooCommerce order storage');
            }
            if ($value === 'yes') {
                throw new \RuntimeException('TypedPress commerce requires legacy order storage with HPOS synchronization disabled. Change storage in WooCommerce after completing synchronization.');
            }
        }
    }

    /** The same pending work is used by managed inspection and installation. */
    public static function plan(Plugin $plugin): array
    {
        $store = $plugin->schema->commerce(); if ($store === null || !array_key_exists('shipping', $store)) { return []; }
        $key = 'tp_' . $plugin->schema->name() . '_shipping';
        $hash = hash('sha256', (string) wp_json_encode($store['shipping']));
        wp_cache_delete($key, 'options'); wp_cache_delete('alloptions', 'options'); wp_cache_delete('notoptions', 'options');
        return get_option($key) === ['source' => $hash, 'state' => self::shippingState()] ? [] : [Runtime::step('commerce-shipping', 'commerce-shipping')];
    }
    public static function initialize(Plugin $plugin): void
    {
        if (self::plan($plugin) === []) { return; }
        $connection = $plugin->connection();
        \TypedPress\Wp\Migrator::locked($connection, 'commerce_shipping', static function () use ($plugin, $connection): void {
            $connection->transaction(static fn () => \TypedPress\Wp\Functions::tracked(static fn () => self::reconcileShipping($plugin)));
        });
    }
    private static function reconcileShipping(Plugin $plugin): void
    {
        if (self::plan($plugin) === []) { return; }
        $store = $plugin->schema->commerce();
        $key = 'tp_' . $plugin->schema->name() . '_shipping';
        $hash = hash('sha256', (string) wp_json_encode($store['shipping']));
        $existing = \WC_Shipping_Zones::get_zones(); $kept = [];
        foreach ($store['shipping'] as $index => $zone) {
            $id = 0;
            if ($zone['countries'] !== 'rest') {
                if ($zone['name'] === '0' || wc_clean($zone['name']) !== $zone['name']) {
                    throw new \RuntimeException('Shipping zone names must match their WooCommerce representation');
                }
                foreach ($existing as $candidate) { if ($candidate['zone_name'] === $zone['name']) { $id = (int) $candidate['zone_id']; break; } }
                $z = new \WC_Shipping_Zone($id ?: null);
                $z->set_zone_name($zone['name']); $z->set_zone_order($index);
                $z->set_zone_locations(array_map(static fn ($code) => (object) ['code' => $code, 'type' => 'country'], $zone['countries']));
                if (!$z->save()) { throw new \RuntimeException('Could not save source shipping zone ' . $zone['name']); }
                $id = $z->get_id();
                $saved = new \WC_Shipping_Zone($id);
                $locations = array_map(static fn ($loc) => $loc->type . ':' . $loc->code, $saved->get_zone_locations('edit'));
                $expected = array_unique(array_map(static fn ($code) => 'country:' . $code, $zone['countries']));
                sort($locations); sort($expected);
                if ($locations !== $expected) { throw new \RuntimeException('Could not persist source shipping locations'); }
                if ($saved->get_zone_order('edit') !== $index || $saved->get_zone_name('edit') !== $zone['name']) {
                    throw new \RuntimeException('Could not persist source shipping zone order or name');
                }
                $kept[] = $id;
            } else { $z = new \WC_Shipping_Zone(0); }
            self::clearMethods($z);
            foreach ($zone['methods'] as $method) {
                $type = ['flatRate' => 'flat_rate', 'freeShipping' => 'free_shipping', 'localPickup' => 'local_pickup'][$method['type']];
                $instance = $z->add_shipping_method($type);
                if (!$instance) { throw new \RuntimeException('Could not add source shipping method ' . $type); }
                $settings = ['title' => $method['title'], 'enabled' => 'yes', 'tax_status' => 'none'];
                if (isset($method['cost'])) { $settings['cost'] = $method['cost']; }
                if (isset($method['minimum'])) { $settings['requires'] = 'min_amount'; $settings['min_amount'] = $method['minimum']; }
                $option = 'woocommerce_' . $type . '_' . $instance . '_settings';
                update_option($option, $settings);
                if (get_option($option) !== $settings) { throw new \RuntimeException('Could not save source shipping method settings'); }
            }
        }
        foreach ($existing as $zone) { if (!in_array((int) $zone['zone_id'], $kept, true)) { (new \WC_Shipping_Zone($zone['zone_id']))->delete(); } }
        global $wpdb;
        $rows = \WC_Data_Store::load('shipping-zone')->get_zones();
        if ($wpdb->last_error !== '' || array_map('intval', array_column($rows ?? [], 'zone_id')) !== $kept) {
            throw new \RuntimeException('Persisted shipping zones do not match the source');
        }
        if (!array_filter($store['shipping'], static fn ($z) => $z['countries'] === 'rest')) { $rest = new \WC_Shipping_Zone(0); self::clearMethods($rest); }
        \WC_Cache_Helper::get_transient_version('shipping', true);
        update_option($key, ['source' => $hash, 'state' => self::shippingState()], false);
    }
    private static function persistedMethods(\WC_Shipping_Zone $zone): array
    {
        global $wpdb;
        $methods = $zone->get_data_store()->get_methods($zone->get_id(), false);
        if ($wpdb->last_error !== '') { throw new \RuntimeException('Could not read shipping methods'); }
        return $methods;
    }
    private static function clearMethods(\WC_Shipping_Zone $zone): void
    {
        foreach (self::persistedMethods($zone) as $method) { $zone->delete_shipping_method($method->instance_id); }
        if (self::persistedMethods($zone) !== []) { throw new \RuntimeException('Could not remove shipping methods'); }
    }
    private static function shippingState(): string
    {
        $state = [];
        foreach ([...array_keys(\WC_Shipping_Zones::get_zones()), 0] as $id) {
            $zone = new \WC_Shipping_Zone($id);
            $methods = [];
            $registered = $zone->get_shipping_methods();
            foreach ($registered as $method) { $methods[] = [$method->id, $method->enabled, get_option($method->get_instance_option_key())]; }
            foreach (self::persistedMethods($zone) as $row) {
                if (!isset($registered[$row->instance_id])) { $methods[] = ['unregistered', $row->method_id, $row->instance_id]; }
            }
            // Zone zero has no stored name. Retain the original English receipt across locales.
            $name = (int) $id === 0 ? 'Locations not covered by your other zones' : $zone->get_zone_name('edit');
            $state[] = [$name, $zone->get_zone_order(), $zone->get_zone_locations(), $methods];
        }
        return hash('sha256', (string) wp_json_encode($state));
    }

    private static function containsCheckout(array $blocks): bool
    {
        foreach ($blocks as $block) {
            if ($block['blockName'] === 'woocommerce/checkout' || self::containsCheckout($block['innerBlocks'])) {
                return true;
            }
        }
        return false;
    }

    public static function checkoutPage(Plugin $plugin): int
    {
        $path = $plugin->schema->commerce()['checkout'] ?? '/checkout';
        foreach ($plugin->schema->app()['content'] ?? [] as $route => $page) {
            if (rtrim($page['path'], '/') === rtrim($path, '/')) {
                $posts = get_posts(['post_type' => 'page', 'post_status' => 'any', 'meta_key' => \TypedPress\Wp\ContentPages::META, 'meta_value' => $route, 'numberposts' => 1]);
                return (int) ($posts[0]->ID ?? 0);
            }
        }
        return 0;
    }
    public static function privatePath(Plugin $plugin, string $path): bool
    {
        if ($plugin->schema->commerce() === null) { return false; }
        $path = '/' . implode('/', array_map('rawurldecode', array_values(array_filter(explode('/', $path), static fn ($part) => $part !== ''))));
        $base = rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($base !== '' && str_starts_with($path, $base . '/')) { $path = substr($path, strlen($base)); }
        $checkout = rtrim($plugin->schema->commerce()['checkout'] ?? '/checkout', '/');
        return rtrim($path, '/') === '/cart' || rtrim($path, '/') === $checkout || str_starts_with($path, $checkout . '/');
    }
    /** Only native Woo endpoints may extend checkout's Page route. */
    public static function routePath(Plugin $plugin, string $path): string
    {
        if ($plugin->schema->commerce() === null) { return $path; }
        $checkout = rtrim($plugin->schema->commerce()['checkout'] ?? '/checkout', '/');
        foreach (['order-pay' => 'woocommerce_checkout_pay_endpoint', 'order-received' => 'woocommerce_checkout_order_received_endpoint'] as $var => $option) {
            $slug = (string) get_option($option, $var);
            if ($slug !== '' && preg_match('#^' . preg_quote($checkout, '#') . '/' . preg_quote($slug, '#') . '/([0-9]+)/?$#', rawurldecode($path), $m)) {
                $GLOBALS['wp']->query_vars[$var] = $m[1]; set_query_var($var, $m[1]);
                return $checkout;
            }
        }
        return $path;
    }
    public static function downloadDirectory(string $file): string
    {
        try { $parent = (new \Automattic\WooCommerce\Internal\Utilities\URL($file))->get_parent_url(); }
        catch (\Automattic\WooCommerce\Internal\Utilities\URLException $e) { throw \TypedPress\HttpError::invalidInput($e->getMessage(), '/downloads'); }
        if (!is_string($parent) || mb_strlen(trailingslashit($parent)) > 256) { throw \TypedPress\HttpError::invalidInput('Downloads need a valid directory URL of at most 256 characters', '/downloads'); }
        return $parent;
    }
    public static function approveDownload(string $file): void
    {
        $register = wc_get_container()->get(\Automattic\WooCommerce\Internal\ProductDownloads\ApprovedDirectories\Register::class);
        try {
            $id = $register->add_approved_directory(self::downloadDirectory($file), true); $register->enable_by_id($id);
        } catch (\Automattic\WooCommerce\Internal\Utilities\URLException | \Automattic\WooCommerce\Internal\ProductDownloads\ApprovedDirectories\ApprovedDirectoriesException $e) {
            throw \TypedPress\HttpError::invalidInput($e->getMessage(), '/downloads');
        }
    }
    public static function information(Plugin $plugin): array
    {
        return [
            'currency' => get_woocommerce_currency(), 'precision' => wc_get_price_decimals(), 'country' => WC()->countries->get_base_country(),
            'display' => ['symbol' => get_woocommerce_currency_symbol(), 'position' => get_option('woocommerce_currency_pos'), 'decimalSeparator' => wc_get_price_decimal_separator(), 'thousandSeparator' => wc_get_price_thousand_separator()],
            'units' => ['weight' => get_option('woocommerce_weight_unit'), 'dimension' => get_option('woocommerce_dimension_unit')],
            'sellTo' => array_keys(WC()->countries->get_allowed_countries()), 'productTypes' => ['simple'],
            'checkoutAvailable' => self::checkoutPage($plugin) > 0, 'checkout' => wc_get_checkout_url(), 'cart' => wc_get_cart_url(),
        ];
    }
}
