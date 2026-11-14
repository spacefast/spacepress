<?php

declare(strict_types=1);

namespace First;

/**
 * Compiled `"use client"` components on a page (docs/decisions/2026-11-08-tsx-to-php.md,
 * generator B). The server HTML of each one calls context() for its root element, which records
 * its namespace; enqueue() then loads the store module of every namespace the page rendered, and
 * nothing for pages that rendered none.
 *
 * WordPress's own directive pass (`wp_interactivity_process_directives`) never runs on these
 * elements: the compiler already printed every value, with JavaScript's own formatting.
 */
final class Islands
{
    /** @var array<string, true> namespaces rendered by this request */
    private static array $used = [];

    /**
     * The `data-wp-context` value of a component's root: its state and props as JSON, in the shape
     * the store reads with getContext(). Records that the page needs the namespace's store.
     *
     * @param array<string, mixed> $context
     */
    public static function context(string $namespace, array $context): string
    {
        self::$used[$namespace] = true;
        return (string) Js::jsonStringify(new JsObject($context));
    }

    /** @return list<string> */
    public static function used(): array
    {
        return array_keys(self::$used);
    }

    /** Registers and enqueues each rendered component's store, with its action endpoints and a REST nonce. */
    public static function enqueue(): void
    {
        $plugin = Wp\Runtime::plugin();
        if (self::$used === [] || $plugin === null || !function_exists('wp_register_script_module')) {
            return;
        }
        $islands = $plugin->schema->islands();
        foreach (array_keys(self::$used) as $namespace) {
            $island = $islands[$namespace] ?? null;
            if (!is_array($island)) {
                continue;
            }
            $handle = 'first-island-' . sanitize_key(str_replace('/', '-', $namespace));
            wp_register_script_module($handle, $plugin->url('first/app/client/' . $island['file']), ['@wordpress/interactivity'], null);
            wp_enqueue_script_module($handle);
            $actions = [];
            foreach ($island['actions'] as $action) {
                $actions[$action] = Wp\Facade::url('/actions/' . rawurlencode((string) $action));
            }
            // A prebuilt page is the same file for days, past a nonce's lifetime, and only signed-out
            // visitors get it: they need no nonce, and an expired one would refuse their calls.
            $config = ['actions' => (object) $actions];
            if (!\First\Render\Prebuilt::prerendering()) {
                $config['nonce'] = wp_create_nonce('wp_rest');
            }
            wp_interactivity_config($namespace, $config);
        }
    }
}
