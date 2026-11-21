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
     * URL gets `data-wp-on--click` for the router region's navigation once the router store is
     * on the page; without JavaScript it is an ordinary link. A path a `tp/app/` page serves is
     * written as that page's one address (`/docs/intro/` under `/%postname%/`, AppRouter::href),
     * so following it is never a redirect.
     *
     * @param array<string, mixed> $props
     */
    public static function link(array $props, mixed $children): Html
    {
        $prefetch = $props['prefetch'] ?? false;
        $requireAuth = $props['requireAuth'] ?? null;
        unset($props['prefetch'], $props['requireAuth']);
        $href = $props['href'] ?? null;
        $local = is_string($href) ? self::localHref($href) : null;
        if ($local !== null) {
            $props['href'] = home_url(\TypedPress\Wp\AppRouter::href($local));
            $path = (string) (wp_parse_url($local, PHP_URL_PATH) ?? '/');
            $router = \TypedPress\Wp\AppRouter::instance();
            if ($path === '/' && \TypedPress\Wp\AppRouter::wordPressHomeQuery($local)) {
                $router = null;
            }
            if (is_bool($requireAuth) ? $requireAuth : $router?->linkRequiresLogin($path)) {
                // Static HTML can be opened by anyone. An inferred guard will run at the destination.
                if (Prebuilt::prerendering()) {
                    if ($requireAuth === true) {
                        Prebuilt::viewerCall('Link requireAuth');
                    }
                    return Html::element('a', $props, $children);
                }
                if (!is_user_logged_in()) {
                    $props['href'] = wp_login_url($props['href']);
                    return Html::element('a', $props, $children);
                }
            }
            $template = $router?->linkTemplateFor($path);
            if ($template !== null) {
                Navigation::used();
                $props['data-wp-interactive'] = Navigation::NAMESPACE;
                $props['data-wp-on--click'] = 'actions.navigate';
                $props['data-tp-template'] = $template;
                if ($prefetch === true) {
                    $props['data-wp-init---tp-prefetch'] = 'callbacks.preparePrefetch';
                    $props['data-wp-on--mouseenter'] = 'actions.prefetch';
                }
            }
        }
        return Html::element('a', $props, $children);
    }

    /** A path below this site's home URL, including a same-site absolute URL's query and fragment. */
    private static function localHref(string $href): ?string
    {
        if (str_starts_with($href, '/') && !str_starts_with($href, '//')) {
            return $href;
        }
        $url = wp_parse_url($href);
        $home = wp_parse_url(home_url('/'));
        $scheme = strtolower($url['scheme'] ?? '');
        $homeScheme = strtolower($home['scheme']);
        if (!is_array($url) || isset($url['user']) || isset($url['pass'])
            || $scheme !== $homeScheme
            || strtolower($url['host'] ?? '') !== strtolower($home['host'])
            || ($url['port'] ?? ($scheme === 'https' ? 443 : 80)) !== ($home['port'] ?? ($homeScheme === 'https' ? 443 : 80))) {
            return null;
        }
        $path = $url['path'] ?? '/';
        $base = rtrim($home['path'] ?? '', '/');
        if ($base !== '' && $path !== $base && !str_starts_with($path, $base . '/')) {
            return null;
        }
        return (substr($path, strlen($base)) ?: '/') . substr($href, strcspn($href, '?#'));
    }

    private static function nullish(mixed $value): bool
    {
        return $value === null || $value === JsUndefined::Value;
    }
}
