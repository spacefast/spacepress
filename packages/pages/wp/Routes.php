<?php

declare(strict_types=1);

namespace Zero\Pages;

/**
 * Route table, hidden code-owned WordPress Pages, URL matching and permalinks.
 *
 * Static routes are WordPress Pages that Zero creates and owns: their ID is
 * the identity menus, SEO plugins and canonical URLs use. Each Page carries
 * `_zero_pages_app` and `_zero_pages_route` (the route ID), and the mapping
 * (app, route ID) → post ID lives in one autoloaded option so lookups never
 * scan post meta. Item routes map to the collection's existing posts.
 *
 * Matching is explicit and static-first: an exact static pattern wins over an
 * item route's `[param]`, and the collection cannot store a slug a static
 * sibling uses (enforced at Zero's write seam and at core's
 * `wp_insert_post_data`, so REST, wp-admin and Zero CRUD all refuse it).
 */
final class Routes
{
    public const META_APP = '_zero_pages_app';
    public const META_ROUTE = '_zero_pages_route';
    public const META_DIGEST = '_zero_pages_digest';

    /** @var array<string, array<string, mixed>> pattern → route */
    private array $static = [];
    /** @var list<array<string, mixed>> */
    private array $dynamic = [];
    /** @var array<string, array<string, mixed>> collection → item route */
    private array $items = [];
    /** True while the reconciler itself writes a code-owned Page. */
    private static bool $reconciling = false;

    /** @param array<string, mixed> $manifest */
    public function __construct(private readonly array $manifest)
    {
        foreach ($manifest['routes'] as $route) {
            if ($route['param'] === null) {
                $this->static[$route['pattern']] = $route;
            } else {
                $this->dynamic[] = $route;
                $this->items[(string) $route['collection']] = $route;
            }
        }
    }

    public static function reconciling(): bool
    {
        return self::$reconciling;
    }

    private function option(): string
    {
        return 'zero_pages_' . $this->manifest['app'];
    }

    /** @return list<string> static patterns another Page or front page already owns; never claimed */
    public function conflicts(): array
    {
        $conflicts = $this->state()['conflicts'] ?? [];
        return is_array($conflicts) ? array_values(array_map('strval', $conflicts)) : [];
    }

    /** @return array{digest?: string, pages?: array<string, int>, conflicts?: list<string>} */
    public function state(): array
    {
        $state = get_option($this->option(), []);
        return is_array($state) ? $state : [];
    }

    /** @return array<string, int> route ID → Page ID */
    public function pages(): array
    {
        $pages = $this->state()['pages'] ?? [];
        return is_array($pages) ? array_map('intval', $pages) : [];
    }

    public function pageId(string $routeId): int
    {
        return $this->pages()[$routeId] ?? 0;
    }

    /** @return ?array<string, mixed> the code route a Page belongs to */
    public function routeForPage(int $postId): ?array
    {
        $routeId = array_search($postId, $this->pages(), true);
        if ($routeId === false) {
            return null;
        }
        foreach ($this->static as $route) {
            if ($route['id'] === $routeId) {
                return $route;
            }
        }
        return null;
    }

    public function isCodePage(int $postId): bool
    {
        return $postId > 0 && in_array($postId, $this->pages(), true);
    }

    // ------------------------------------------------------------------ matching

    /**
     * The route for a request path relative to the home URL.
     *
     * @return ?array{route: array<string, mixed>, params: array<string, string>}
     */
    public function match(string $path): ?array
    {
        $segments = [];
        foreach (explode('/', trim($path, '/')) as $raw) {
            if ($raw === '') {
                continue;
            }
            // Decode once; refuse malformed escapes, encoded separators and dot segments.
            if (preg_match('/%(?![0-9A-Fa-f]{2})/', $raw) === 1) {
                return null;
            }
            $decoded = rawurldecode($raw);
            if ($decoded === '.' || $decoded === '..' || str_contains($decoded, '/') || !mb_check_encoding($decoded, 'UTF-8')) {
                return null;
            }
            $segments[] = $decoded;
        }
        $pattern = '/' . implode('/', $segments);
        if (isset($this->static[$pattern])) {
            return ['route' => $this->static[$pattern], 'params' => []];
        }
        if ($segments === []) {
            return null;
        }
        $parent = '/' . implode('/', array_slice($segments, 0, -1));
        foreach ($this->dynamic as $route) {
            $prefix = substr((string) $route['pattern'], 0, -3); // strip '/[]'
            if (($prefix === '' ? '/' : $prefix) === $parent) {
                return ['route' => $route, 'params' => [(string) $route['param'] => (string) end($segments)]];
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ URLs

    public function urlFor(string $pattern): string
    {
        return $this->url($pattern);
    }

    private function url(string $path): string
    {
        $encoded = implode('/', array_map('rawurlencode', array_filter(explode('/', $path), static fn ($s) => $s !== '')));
        $url = home_url($encoded === '' ? '/' : '/' . $encoded);
        return $encoded === '' ? trailingslashit($url) : user_trailingslashit($url);
    }

    /** A routed row's permalink from its slug, or null when it has no slug yet. */
    public function itemUrl(string $collection, array $row): ?string
    {
        $route = $this->items[$collection] ?? null;
        $slug = $route === null ? null : ($row[(string) $route['slugColumn']] ?? null);
        if (!is_string($slug) || $slug === '') {
            return null;
        }
        return $this->url(str_replace('[]', $slug, (string) $route['pattern']));
    }

    /** @return ?array<string, mixed> */
    public function itemRoute(string $postType): ?array
    {
        foreach ($this->items as $route) {
            if ($route['postType'] === $postType) {
                return $route;
            }
        }
        return null;
    }

    /** @return array<string, list<string>> post type → slugs reserved by static siblings */
    public function reservedSlugs(): array
    {
        $out = [];
        foreach ($this->dynamic as $route) {
            if ($route['postType'] !== null && $route['reserved'] !== []) {
                $out[(string) $route['postType']] = array_values($route['reserved']);
            }
        }
        return $out;
    }

    /** @return array<string, list<string>> collection → reserved slugs */
    public function reservedByCollection(): array
    {
        $out = [];
        foreach ($this->dynamic as $route) {
            if ($route['reserved'] !== []) {
                $out[(string) $route['collection']] = array_values($route['reserved']);
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ reconciliation

    /**
     * Make the hidden Pages match the manifest: create missing ones, refresh
     * code-owned title and body when the build changed, trash retired ones.
     * Runs under a lock; a second request waits or skips.
     */
    public function reconcile(string $directory): void
    {
        $state = $this->state();
        if (($state['digest'] ?? null) === $this->manifest['digest'] && $this->pagesIntact()) {
            return;
        }
        $lock = 'zero_pages_lock_' . $this->manifest['app'];
        if (!add_option($lock, (string) time(), '', false)) {
            $since = (int) get_option($lock);
            if ($since > time() - 60) {
                return;
            }
            update_option($lock, (string) time(), false);
        }
        self::$reconciling = true;
        try {
            $pages = $this->pages();
            $wanted = [];
            $conflicts = [];
            foreach ($this->static as $route) {
                $owner = $this->foreignOwner($route, $pages);
                if ($owner !== null) {
                    // Never take over a URL or the front page that other content already owns.
                    $conflicts[] = (string) $route['pattern'];
                    continue;
                }
                $body = (string) file_get_contents($directory . '/' . $route['body']);
                $id = $pages[$route['id']] ?? 0;
                $post = $id > 0 ? get_post($id) : null;
                if (!$post instanceof \WP_Post || $post->post_type !== 'page' || $post->post_status === 'trash') {
                    $id = $this->adopt((string) $route['id']);
                    $post = $id > 0 ? get_post($id) : null;
                }
                $fields = [
                    'post_type' => 'page',
                    'post_status' => 'publish',
                    'post_title' => (string) $route['title'],
                    'post_content' => wp_slash($body),
                    'post_name' => $route['pattern'] === '/' ? 'zero-home-' . substr((string) $route['key'], 0, 8) : basename((string) $route['pattern']),
                    'post_parent' => 0,
                    'comment_status' => 'closed',
                    'ping_status' => 'closed',
                ];
                if ($post instanceof \WP_Post) {
                    $fields['ID'] = $post->ID;
                    $result = wp_update_post($fields, true);
                } else {
                    $result = wp_insert_post($fields, true);
                }
                if (is_wp_error($result)) {
                    throw new \RuntimeException('Zero pages: cannot write the Page for ' . $route['pattern'] . ': ' . $result->get_error_message());
                }
                $id = (int) $result;
                update_post_meta($id, self::META_APP, $this->manifest['app']);
                update_post_meta($id, self::META_ROUTE, $route['id']);
                update_post_meta($id, self::META_DIGEST, $route['bodyDigest']);
                $wanted[$route['id']] = $id;
            }
            foreach ($pages as $routeId => $id) {
                if (!isset($wanted[$routeId]) && get_post($id) instanceof \WP_Post) {
                    update_post_meta($id, '_zero_pages_retired', gmdate('c'));
                    wp_trash_post($id);
                }
            }
            update_option($this->option(), ['digest' => $this->manifest['digest'], 'pages' => $wanted, 'conflicts' => $conflicts], true);
            $root = $wanted[$this->static['/']['id'] ?? ''] ?? 0;
            if ($root > 0) {
                update_option('show_on_front', 'page');
                update_option('page_on_front', $root);
            }
        } finally {
            self::$reconciling = false;
            delete_option($lock);
        }
    }

    /** Another published Page at this path, or a non-Zero static front page for `/`. */
    private function foreignOwner(array $route, array $pages): ?int
    {
        $mine = array_values($pages);
        if ($route['pattern'] === '/') {
            $front = (int) get_option('page_on_front');
            return get_option('show_on_front') === 'page' && $front > 0 && !in_array($front, $mine, true)
                && get_post_meta($front, self::META_APP, true) !== $this->manifest['app'] ? $front : null;
        }
        $page = get_page_by_path(ltrim((string) $route['pattern'], '/'), OBJECT, 'page');
        if ($page instanceof \WP_Post && $page->post_status === 'publish' && !in_array($page->ID, $mine, true)
            && get_post_meta($page->ID, self::META_APP, true) !== $this->manifest['app']) {
            return $page->ID;
        }
        return null;
    }

    private function pagesIntact(): bool
    {
        foreach ($this->pages() as $id) {
            $post = get_post($id);
            if (!$post instanceof \WP_Post || $post->post_status !== 'publish') {
                return false;
            }
        }
        return count($this->pages()) + count($this->conflicts()) === count($this->static);
    }

    /** A Page this app created earlier for the route (found by meta), so a lost option never duplicates Pages. */
    private function adopt(string $routeId): int
    {
        $found = get_posts([
            'post_type' => 'page',
            'post_status' => ['publish', 'draft', 'private', 'pending'],
            'meta_query' => [
                ['key' => self::META_APP, 'value' => $this->manifest['app']],
                ['key' => self::META_ROUTE, 'value' => $routeId],
            ],
            'fields' => 'ids',
            'numberposts' => 1,
            'suppress_filters' => true,
        ]);
        return (int) ($found[0] ?? 0);
    }
}
