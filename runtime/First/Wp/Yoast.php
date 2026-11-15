<?php

declare(strict_types=1);

namespace First\Wp;

/** Yoast Free 28.8 on claimed TSX routes. Other WordPress requests keep Yoast's normal hooks. */
final class Yoast
{
    public static function active(): bool
    {
        return function_exists('YoastSEO');
    }

    /** Preserve the page when its readable fields cannot safely feed the native SEO provider. */
    public static function suppress(): void
    {
        add_filter('wpseo_frontend_presenters', static fn (): array => []);
        add_action('wp_head', 'wp_robots', 1);
    }

    /**
     * Install metadata before Yoast resolves its presentation. An item's editor overrides win;
     * otherwise supplied metadata wins over plugin defaults. First emits the presented title once.
     *
     * @param array<string, mixed> $head
     * @param array<string, mixed> $app
     */
    public static function prepare(array $head, int $status, bool $collection, array $app): string
    {
        $post = get_queried_object();
        if ($post instanceof \WP_Post) {
            foreach (['title' => 'title', 'description' => 'metadesc', 'canonical' => 'canonical'] as $key => $meta) {
                if (get_post_meta($post->ID, '_yoast_wpseo_' . $meta, true) !== '') {
                    unset($head[$key]);
                    if ($key === 'title') {
                        $head['titleExplicit'] = false;
                    }
                }
            }
            foreach (['title' => 'opengraph-title', 'description' => 'opengraph-description', 'image' => 'opengraph-image'] as $key => $meta) {
                if (get_post_meta($post->ID, '_yoast_wpseo_' . $meta, true) !== '') {
                    unset($head['openGraph'][$key]);
                }
            }
        }
        add_filter('wpseo_frontend_presenters', static fn (array $presenters): array => array_values(array_filter(
            $presenters,
            static fn ($presenter): bool => !$presenter instanceof \Yoast\WP\SEO\Presenters\Title_Presenter,
        )));
        if ($head['titleExplicit'] ?? true) {
            add_filter('wpseo_title', static fn (): string => (string) $head['title']);
        }
        foreach (['description' => 'wpseo_metadesc', 'canonical' => 'wpseo_canonical'] as $key => $filter) {
            if (is_string($head[$key] ?? null)) {
                $value = $key === 'canonical' ? self::absolute($head[$key]) : $head[$key];
                add_filter($filter, static fn (): string => $value);
            }
        }
        // Canonical is also the base for schema IDs. A presenter-only canonical filter leaves
        // WebPage, Article and BreadcrumbList pointing at a different document.
        add_filter('wpseo_frontend_presentation', static function ($presentation, $context) use ($head) {
            if (is_string($head['canonical'] ?? null)) {
                $presentation->canonical = self::absolute($head['canonical']);
            }
            if (($head['titleExplicit'] ?? true) && isset($head['title'])) {
                $context->title = $head['title'];
            }
            if (is_string($head['description'] ?? null)) {
                $context->description = $head['description'];
            }
            if (is_string($head['openGraph']['image'] ?? null)) {
                $image = $head['openGraph']['image'];
                $presentation->open_graph_images = $image === '' ? [] : [['url' => self::absolute($image)]];
            }
            return $presentation;
        }, 10, 2);
        add_filter('wpseo_robots_array', static function (array $robots) use ($head, $status): array {
            foreach (['index', 'follow'] as $key) {
                if (($status !== 200 && $key === 'index') || ($head['robots'][$key] ?? true) === false) {
                    $robots[$key] = 'no' . $key;
                }
            }
            return $robots;
        });
        self::social($head);

        $public = $status === 200 && !is_user_logged_in() && $post instanceof \WP_Post && $post->post_status === 'publish' && $post->post_password === '';
        // An explicit Article card opts a collection route in. Static pages never inherit this
        // opt-in, even from a layout. Preserve an editor's chosen Article subtype or None.
        add_filter('wpseo_schema_article_type', static function (string|array $type) use ($head, $collection, $public, $post): string|array {
            if (!$public) {
                return 'None';
            }
            if ($collection && (!post_type_supports($post->post_type, 'author') || !get_userdata((int) $post->post_author))) {
                return 'None';
            }
            if ($collection && ($head['openGraph']['type'] ?? null) === 'article') {
                return get_post_meta($post->ID, '_yoast_wpseo_schema_article_type', true) === '' ? 'Article' : $type;
            }
            return $type;
        });
        if (!$public) {
            // A draft preview, error or password gate must not publish article data in JSON-LD.
            add_filter('wpseo_schema_graph', static fn (): array => []);
        } elseif ($collection) {
            self::breadcrumbs($app, $post);
        }
        // Context can have been requested earlier by a theme/plugin before First selected its
        // code Page or rejected a collection item. Rebuild it against the final main query.
        \YoastSEO()->classes->get(\Yoast\WP\SEO\Memoizers\Meta_Tags_Context_Memoizer::class)->clear();
        // Collection types stay non-public to native bulk readers. Qualify the already-authorized
        // post through Yoast's inclusion filter only while its current-page context is built.
        $include = static fn (array $types): array => array_values(array_unique([...$types, $post->post_type]));
        $save = static fn (bool $save, $indexable): bool => $indexable->object_type === 'post' && (int) $indexable->object_id === $post->ID ? false : $save;
        if ($collection && $public) {
            add_filter('wpseo_indexable_forced_included_post_types', $include);
            // Viewer-qualified metadata must not become an alternate public, persisted reader.
            add_filter('wpseo_should_save_indexable', $save, 10, 2);
        }
        try {
            $title = \YoastSEO()->meta->for_current_page()->title;
        } finally {
            remove_filter('wpseo_indexable_forced_included_post_types', $include);
            remove_filter('wpseo_should_save_indexable', $save);
        }
        return html_entity_decode((string) $title, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /** @param array<string, mixed> $head */
    private static function social(array $head): void
    {
        foreach ([
            'openGraph' => ['title' => 'wpseo_opengraph_title', 'description' => 'wpseo_opengraph_desc', 'type' => 'wpseo_opengraph_type'],
            'twitter' => ['card' => 'wpseo_twitter_card_type'],
        ] as $group => $fields) {
            foreach ($fields as $key => $filter) {
                if (is_string($head[$group][$key] ?? null)) {
                    $value = $head[$group][$key];
                    add_filter($filter, static fn (): string => $value);
                }
            }
        }
        if (is_string($head['canonical'] ?? null)) {
            add_filter('wpseo_opengraph_url', static fn (): string => self::absolute($head['canonical']));
        }
    }

    /** Only actual public code Pages are virtual parents. URL segments alone imply no hierarchy. */
    private static function breadcrumbs(array $app, \WP_Post $post): void
    {
        $path = wp_parse_url(get_permalink($post), PHP_URL_PATH);
        $parents = [];
        $pages = RoutePages::instance()?->pages() ?? [];
        foreach ($app['routes'] as $route) {
            $id = $pages[$route['id']] ?? null;
            $parent = $id === null ? null : get_post($id);
            if (!$parent instanceof \WP_Post || $parent->post_status !== 'publish' || $parent->post_password !== '') {
                continue;
            }
            $url = get_permalink($parent);
            $prefix = wp_parse_url($url, PHP_URL_PATH);
            if ($route['pattern'] !== '/' && is_string($prefix) && is_string($path) && str_starts_with($path, rtrim($prefix, '/') . '/')) {
                $parents[$prefix] = ['url' => $url, 'text' => get_post_meta($id, '_yoast_wpseo_bctitle', true) ?: $parent->post_title];
            }
        }
        if ($parents === []) {
            return;
        }
        uksort($parents, static fn (string $a, string $b): int => strlen($a) <=> strlen($b));
        add_filter('wpseo_breadcrumb_links', static function (array $crumbs) use ($parents): array {
            // Keep Yoast's Home and current editor label. Replace its native intermediate trail
            // with the code Pages that actually exist at the virtual route's prefixes.
            if ($crumbs === []) {
                return [];
            }
            $current = array_pop($crumbs);
            $home = array_values(array_filter($crumbs, static fn (array $crumb): bool =>
                isset($crumb['url']) && untrailingslashit($crumb['url']) === untrailingslashit(home_url('/'))
            ));
            return [...$home, ...array_values($parents), $current];
        });
    }

    private static function absolute(string $url): string
    {
        return str_starts_with($url, '/') && !str_starts_with($url, '//') ? home_url($url) : $url;
    }
}
