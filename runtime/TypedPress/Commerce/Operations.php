<?php

declare(strict_types=1);

namespace TypedPress\Commerce;

use TypedPress\HttpError;
use TypedPress\Wp\AgentScope;
use TypedPress\Wp\Functions;
use TypedPress\Wp\Plugin;

/** Inventory and fulfilment operations over Woo's own records. */
final class Operations
{
    public static function register(Plugin $plugin): void
    {
        $hasOrders = in_array('order', array_column($plugin->schema->kinds(), 'commerce'), true);
        add_filter('tp_ability_operations', static function (array $ops, string $app) use ($plugin, $hasOrders): array {
            $shapes = json_decode(file_get_contents(__DIR__ . '/operations.json'), true, flags: JSON_THROW_ON_ERROR);
            $handlers = ['increase-product-stock' => [self::class, 'increase']];
            if ($hasOrders) {
                $handlers['complete-order'] = [self::class, 'complete'];
            }
            foreach ($handlers as $name => $run) {
                $ops[] = [
                    'name' => "$app/$name", 'op' => 'action', 'agents' => false,
                    'typedpress' => ['store' => true], 'label' => ucfirst(str_replace('-', ' ', $name)),
                    'description' => 'Update a native WooCommerce record.',
                    'input' => $shapes[$name]['input'], 'output' => $shapes[$name]['output'],
                    'annotations' => ['readonly' => false, 'idempotent' => false],
                    'rule' => [['role' => 'admin'], 'update', 'manage WooCommerce'],
                    'run' => static function (array $input) use ($plugin, $run): int {
                        if (!AgentScope::may('write')) { throw AgentScope::refusal('write'); }
                        return $run($plugin, $input);
                    },
                ];
            }
            return $ops;
        }, 10, 2);

        add_action('woocommerce_reduce_order_item_stock', static function ($item, array $change, \WC_Order $order): void {
            do_action('typedpress_woo_order_stock', $item->get_product_id(), $order->get_id(), $change['to'] - $change['from'], 'sale');
        }, 10, 3);
        add_action('woocommerce_restore_order_item_stock', static function ($item, $new, $old, \WC_Order $order): void {
            do_action('typedpress_woo_order_stock', $item->get_product_id(), $order->get_id(), $new - $old, 'return');
        }, 10, 4);
    }

    private static function increase(Plugin $plugin, array $input): int
    {
        $product = wc_get_product($input['id']);
        if (!$product || !$product->is_type('simple')) { throw HttpError::notFound('Drive not found'); }
        if (!$product->managing_stock()) {
            throw new HttpError(409, 'stock_unmanaged', 'Enable inventory tracking in WooCommerce first.');
        }

        return $plugin->connection()->transaction(static function () use ($plugin, $product, $input): int {
            $plugin->connection()->touchPost($product->get_id());
            $quantity = Functions::tracked(static fn () => wc_update_product_stock($product, $input['quantity'], 'increase'));
            if (!is_int($quantity)) {
                throw new HttpError(500, 'stock_update_failed', 'WooCommerce could not restock this product.');
            }
            return $quantity;
        });
    }

    private static function complete(Plugin $plugin, array $input): int
    {
        if (!AgentScope::may('personal')) { throw AgentScope::refusal('personal'); }
        $id = $input['id'];
        $db = $plugin->connection();
        return $db->transaction(static function () use ($db, $id): int {
            // The store uses Woo's legacy order storage. Lock the order through the native write.
            $posts = $db->wpdb()->posts;
            $current = $db->run("SELECT post_status FROM `$posts` WHERE ID = ? AND post_type = 'shop_order' FOR UPDATE", [$id])[0] ?? null;
            $order = $current ? wc_get_order($id) : false;
            if (!$order) { throw HttpError::notFound('Order not found'); }
            if ($current['post_status'] === 'wc-completed') { return $id; }
            if ($current['post_status'] !== 'wc-processing') {
                throw new HttpError(409, 'order_not_processing', 'Only processing orders can be marked shipped.');
            }
            if (!Functions::tracked(static fn () => $order->update_status('completed', 'Marked shipped.'))) {
                throw new HttpError(500, 'order_update_failed', 'WooCommerce could not complete this order.');
            }
            return $id;
        });
    }
}
