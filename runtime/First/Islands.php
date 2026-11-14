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

    /**
     * The server render of a reactive list or conditional's items: each top-level element marked
     * `data-wp-each-child="<namespace>::<path>"`, so the Interactivity runtime takes the elements
     * over as the template's children instead of rendering a second copy (WordPress 6.9 +).
     */
    public static function eachChild(mixed $rendered, string $source): Html
    {
        $html = Html::child($rendered);
        if ($html === '' || !class_exists(\WP_HTML_Tag_Processor::class)) {
            return Html::raw($html);
        }
        $p = new \WP_HTML_Tag_Processor($html);
        $depth = 0;
        while ($p->next_token()) {
            if ($p->get_token_type() !== '#tag') {
                continue;
            }
            if ($p->is_tag_closer()) {
                $depth--;
                continue;
            }
            if ($depth === 0) {
                $p->set_attribute('data-wp-each-child', $source);
            }
            if (!$p->has_self_closing_flag() && !in_array($p->get_tag(), self::VOID, true)) {
                $depth++;
            }
        }

        return Html::raw($p->get_updated_html());
    }

    /** HTML void elements: they have no closer, so they never open a level. */
    private const VOID = ['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR'];

    /**
     * The `<template>` a reactive list or conditional renders from in the browser: `$each` is the
     * directive's name (`data-wp-each--item`), `$path` the state it reads, `$key` how each item is
     * keyed. Its content is the item's element with every browser-computed value left empty.
     */
    public static function template(string $each, string $path, mixed $content, ?string $key = null): Html
    {
        $attributes = ' ' . $each . '="' . Html::escape($path) . '"' . ($key === null ? '' : ' data-wp-each-key="' . Html::escape($key) . '"');

        return Html::raw('<template' . $attributes . '>' . Html::child($content) . '</template>');
    }

    /** @return list<string> */
    public static function used(): array
    {
        return array_keys(self::$used);
    }

    /** The script module id of the app's typed client in the browser. */
    public const CLIENT = '@first/client';

    /**
     * Registers the app's typed client (`first/_generated/client/client.js`, built into the app
     * plugin) as the script module `@first/client`, for modules that import it. Registering doesn't
     * load it: a page loads it only when a module it enqueues depends on it.
     */
    public static function registerClient(): bool
    {
        $plugin = Wp\Runtime::plugin();
        if ($plugin === null || !function_exists('wp_register_script_module') || !is_file($plugin->dir . '/first/app/client/first-client.js')) {
            return false;
        }
        wp_register_script_module(self::CLIENT, $plugin->url('first/app/client/first-client.js'), [], null);

        return true;
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
            wp_interactivity_config($namespace, ['actions' => (object) $actions, 'nonce' => wp_create_nonce('wp_rest')]);
        }
    }
}
