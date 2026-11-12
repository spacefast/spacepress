<?php

declare(strict_types=1);

namespace First\Render;

/**
 * Region navigation for `<Link>` (docs/spec/rendering.md §4.3): the root layout's content region is
 * a router region, and a link click fetches the next page and swaps that region with
 * `@wordpress/interactivity-router`. The store module is enqueued only on pages that render a link.
 */
final class Navigation
{
    public const NAMESPACE = 'first/router';
    public const REGION = 'first/main';
    private static bool $used = false;

    public static function used(): void
    {
        self::$used = true;
    }

    public static function reset(): void
    {
        self::$used = false;
    }

    public static function enqueue(string $url): void
    {
        if (!self::$used || !function_exists('wp_register_script_module')) {
            return;
        }
        wp_register_script_module('first-router', $url, [['id' => '@wordpress/interactivity', 'import' => 'static'], ['id' => '@wordpress/interactivity-router', 'import' => 'dynamic']], null);
        wp_enqueue_script_module('first-router');
    }
}
