<?php

declare(strict_types=1);

namespace TypedPress\Render;

use TypedPress\Html;
use TypedPress\JsUndefined;

/**
 * The markup components of "typedpress/app" (docs/decisions/2026-11-08-tsx-to-php.md, "Raw HTML"):
 * `<Content>` runs a post body through `the_content`, `<Html>` places author literals as they are
 * and runs anything else through `wp_kses_post`, and `<Link>` is an `<a>` the router region can
 * take over (rendering.md §4.3).
 */
final class Markup
{
    public static function content(mixed $value): Html
    {
        return Html::raw(self::nullish($value) ? '' : (string) apply_filters('the_content', (string) $value));
    }

    public static function trusted(mixed $value): Html
    {
        return Html::raw(self::nullish($value) ? '' : (string) $value);
    }

    public static function kses(mixed $value): Html
    {
        return Html::raw(self::nullish($value) ? '' : wp_kses_post((string) $value));
    }

    /**
     * `<Link href prefetch?>children</Link>`: an `<a>` with React's attribute rules. A same-site
     * path gets `data-wp-on--click` for the router region's navigation once the router store is
     * on the page; without JavaScript it is an ordinary link. A path a `tp/app/` page serves is
     * written as that page's one address (`/docs/intro/` under `/%postname%/`, AppRouter::canonical),
     * so following it is never a redirect.
     *
     * @param array<string, mixed> $props
     */
    public static function link(array $props, mixed $children): Html
    {
        $prefetch = $props['prefetch'] ?? false;
        unset($props['prefetch']);
        $href = $props['href'] ?? null;
        if (is_string($href) && str_starts_with($href, '/') && !str_starts_with($href, '//')) {
            $path = (string) strtok($href, '?#');
            $router = \TypedPress\Wp\AppRouter::instance();
            $props['href'] = home_url(($router?->canonical($path) ?? $path) . substr($href, strlen($path)));
            Navigation::used();
            $props['data-wp-interactive'] = Navigation::NAMESPACE;
            $props['data-wp-on--click'] = 'actions.navigate';
            if ($prefetch === true) {
                $props['data-wp-on--mouseenter'] = 'actions.prefetch';
            }
        }
        return Html::element('a', $props, $children);
    }

    private static function nullish(mixed $value): bool
    {
        return $value === null || $value === JsUndefined::Value;
    }
}
