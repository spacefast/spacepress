<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * Default `first_purge_urls` listeners for the page caches WordPress sites already run, so purges
 * reach them without a host of its own (docs/runtime-contract.md, "Purges"):
 * - Batcache (`batcache_clear_url()`): it keys a page on `http://<host><path>`, with no query
 *   string except `?p=`, so each path is cleared in that form;
 * - the VIP edge cache (`wpvip_purge_edge_cache_for_url()`, or `wpcom_vip_purge_edge_cache_for_url()`
 *   on older VIP mu-plugins): absolute URLs, query strings dropped by VIP itself;
 * - Jetpack Boost's page cache, through its public `jetpack_boost_clear_page_cache_url` action.
 * A whole-host purge (`/*`) bans the VIP site and clears Boost's whole cache; Batcache has no
 * whole-site clear, so its entries run out with the cache window.
 *
 * Nothing listens when none of them is loaded, so on a site without a page cache First records and
 * announces nothing (`has_action('first_purge_urls')` stays false).
 */
final class PageCaches
{
    public static function register(): void
    {
        // After every plugin (Batcache, Jetpack Boost) and mu-plugin (VIP) has defined its functions.
        add_action('plugins_loaded', static function (): void {
            if (self::present() !== []) {
                add_action('first_purge_urls', [self::class, 'purge']);
            }
        }, PHP_INT_MAX);
    }

    /** @return list<string> the page caches loaded on this site */
    private static function present(): array
    {
        return array_keys(array_filter([
            'batcache' => function_exists('batcache_clear_url'),
            'vip' => function_exists('wpvip_purge_edge_cache_for_url') || function_exists('wpcom_vip_purge_edge_cache_for_url'),
            'jetpack-boost' => has_action('jetpack_boost_clear_page_cache_url') !== false,
        ]));
    }

    /** @param list<string> $paths root-relative paths with their query, as `first_purge_urls` gives them */
    public static function purge(array $paths): void
    {
        $origin = self::origin();
        foreach ($paths as $path) {
            if ($path === '/*') {
                if (function_exists('wpvip_purge_edge_cache_for_site')) {
                    wpvip_purge_edge_cache_for_site();
                }
                do_action('jetpack_boost_clear_page_cache_all');
                continue;
            }
            $url = $origin . $path;
            if (function_exists('batcache_clear_url')) {
                batcache_clear_url(self::batcacheUrl($url));
            }
            if (function_exists('wpvip_purge_edge_cache_for_url')) {
                wpvip_purge_edge_cache_for_url($url);
            } elseif (function_exists('wpcom_vip_purge_edge_cache_for_url')) {
                wpcom_vip_purge_edge_cache_for_url($url);
            }
            do_action('jetpack_boost_clear_page_cache_url', $url);
        }
    }

    /** `https://example.com` (with its port): what a root-relative path is joined to. */
    private static function origin(): string
    {
        $home = (array) wp_parse_url(home_url('/'));
        $port = isset($home['port']) ? ':' . $home['port'] : '';

        return ($home['scheme'] ?? 'http') . '://' . ($home['host'] ?? '') . $port;
    }

    /** The URL as Batcache keys it: its query string goes, except a `?p=<id>` permalink. */
    private static function batcacheUrl(string $url): string
    {
        [$bare, $query] = array_pad(explode('?', $url, 2), 2, '');
        parse_str($query, $args);

        return $bare . (isset($args['p']) && is_scalar($args['p']) ? '?p=' . $args['p'] : '');
    }
}
