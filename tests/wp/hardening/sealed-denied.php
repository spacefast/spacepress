<?php
/**
 * Plugin Name: Block data (test stand-in)
 * Description: Stands in for a plugin a sealed site never runs: one route that answers a post's stored content after an item-level check only.
 * Version: 0.0.0
 */

declare(strict_types=1);

add_action('rest_api_init', static function (): void {
    register_rest_route('vip-block-data-api/v1', '/posts/(?P<id>\\d+)/blocks', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => static fn (WP_REST_Request $request): array => ['content' => (string) get_post((int) $request['id'])?->post_content],
    ]);
});
