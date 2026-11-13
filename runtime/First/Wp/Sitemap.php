<?php

declare(strict_types=1);

namespace First\Wp;

use First\Viewer;

/**
 * One sitemap for the site, through WordPress core's own (`wp-sitemap.xml`, `wp_sitemaps`):
 *
 * - core's `posts`, `taxonomies` and `users` providers list posts, pages, terms and authors as they
 *   always do, with the links First's kind `url` patterns filter;
 * - First adds one provider, `first`, with a sub-sitemap per kind that has a `url`
 *   (`wp-sitemap-first-<kind>-1.xml`) and one for `first/app/` pages
 *   (`wp-sitemap-first-app-pages-1.xml`; a kind's name has no `-`, so the two never collide).
 *
 * Only what an anonymous visitor may read is listed. A kind's rows are the ones its read rule and
 * draft visibility cover for a signed-out viewer, selected by First's own read pipeline (the same
 * query `posts.list()` runs for a visitor), so a draft, a row a filter rule hides and a kind readers
 * must sign in for never appear. An app page is listed when it is one `/llms.txt` lists (no
 * parameters, no layout `guard`, and it renders for a signed-out visitor) and does not ask robots to
 * stay away (`metadata.robots.index: false`). The home page is core's entry, never a second one.
 * A password-protected post or item is left out as well, from core's files and from First's.
 *
 * Front-end modes (spec §5): with `frontend: false` there are no public pages, so there is no
 * sitemap at all; with an external frontend every entry points at that site (the link filters of
 * {@see KindUrls} already move posts, pages, terms and kind items there), and the sitemap itself is
 * answered here for that site to serve or name in its robots.txt.
 *
 * Core renders the XML, the index, the stylesheets and the `robots.txt` line. Nothing here writes XML.
 * A write purges the sitemap files it changed with the item's other URLs ({@see Purges}).
 */
final class Sitemap
{
    /** The provider's name in core's registry and in its URLs. */
    public const NAME = 'first';
    /** The sub-sitemap that lists `first/app/` pages. */
    public const PAGES = 'app-pages';

    public static function register(Plugin $plugin): void
    {
        if ($plugin->schema->frontend() === false) {
            // No public HTML, so nothing to list: core answers its sitemap URLs with a 404.
            add_filter('wp_sitemaps_enabled', '__return_false', PHP_INT_MAX);

            return;
        }
        // Core builds its server on `init` and announces it here; providers register on this hook.
        add_action('wp_sitemaps_init', static function () use ($plugin): void {
            wp_register_sitemap_provider(self::NAME, self::provider($plugin));
        });
        // Answered before the front-end gates (an external frontend's redirect at -1, the app router
        // at 1): the sitemap is this site's own, like its feeds, whoever renders the pages.
        add_action('template_redirect', static function (): void {
            if (get_query_var('sitemap') || get_query_var('sitemap-stylesheet')) {
                wp_sitemaps_get_server()->render_sitemaps();
            }
        }, -2);
        // A password-protected post's content is not a visitor's to read: core lists such posts, this
        // sitemap does not.
        add_filter('wp_sitemaps_posts_query_args', static fn (mixed $args): mixed => is_array($args) ? $args + ['has_password' => false] : $args, PHP_INT_MAX);
        // Core lists the authors of public posts. With a users kind, a user is listed only when a
        // signed-out visitor may read their row.
        add_filter('wp_sitemaps_users_query_args', static fn (mixed $args): mixed => is_array($args) ? self::readableUsers($plugin, $args) : $args, PHP_INT_MAX);
        $frontend = $plugin->schema->frontend();
        if (is_string($frontend)) {
            // Core's own entries that no link filter reaches: the home page and author archives.
            $rebase = static function (mixed $entry) use ($frontend): mixed {
                if (is_array($entry) && is_string($entry['loc'] ?? null)) {
                    $entry['loc'] = KindUrls::rebase($entry['loc'], $frontend);
                }

                return $entry;
            };
            add_filter('wp_sitemaps_posts_show_on_front_entry', $rebase, PHP_INT_MAX);
            add_filter('wp_sitemaps_users_entry', $rebase, PHP_INT_MAX);
        }
    }

    /**
     * The sitemap files a write to $post changes, for the purge of its URLs: the index (a sub-sitemap
     * may appear, vanish or gain a file) and the file that lists the item. Core and First both order
     * a sub-sitemap by id, so the item's file is the count of listed items up to its id.
     *
     * @return list<string>
     */
    public static function filesFor(\WP_Post $post): array
    {
        $plugin = Plugin::instance();
        if ($plugin === null || $plugin->schema->frontend() === false) {
            return [];
        }
        $server = function_exists('wp_sitemaps_get_server') ? wp_sitemaps_get_server() : null;
        if (!$server instanceof \WP_Sitemaps || !$server->sitemaps_enabled()) {
            return [];
        }
        $max = max(1, (int) wp_sitemaps_get_max_urls(self::NAME));
        foreach (self::subtypes($plugin) as $subtype => $kind) {
            if (isset($kind['kind']) && ($plugin->schema->collection($kind['kind'])['wp']['postType'] ?? null) === $post->post_type) {
                $before = self::count($plugin, $kind['kind'], [$plugin->schema->collection($kind['kind'])['primaryKey'] => ['lte' => $post->ID]]);

                return [(string) get_sitemap_url('index'), (string) get_sitemap_url(self::NAME, $subtype, max(1, (int) ceil($before / $max)))];
            }
        }
        $posts = $server->registry->get_provider('posts');
        if (!$posts instanceof \WP_Sitemaps_Provider || !isset($posts->get_object_subtypes()[$post->post_type])) {
            return [];
        }
        global $wpdb;
        $before = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s AND post_status = 'publish' AND ID <= %d",
            $post->post_type, $post->ID,
        ));

        return [(string) get_sitemap_url('index'), (string) get_sitemap_url('posts', $post->post_type, max(1, (int) ceil($before / $max)))];
    }

    /**
     * The provider, as an anonymous subclass of core's: `WP_Sitemaps_Provider` exists only once
     * WordPress is loaded, and this file must stay loadable (and lintable) without it.
     */
    private static function provider(Plugin $plugin): \WP_Sitemaps_Provider
    {
        return new class($plugin) extends \WP_Sitemaps_Provider {
            public function __construct(private readonly Plugin $plugin)
            {
                $this->name = Sitemap::NAME;
                $this->object_type = Sitemap::NAME;
            }

            /** @return array<string, array{label: string}> one sub-sitemap per kind with URLs, and one for app pages */
            public function get_object_subtypes()
            {
                return Sitemap::subtypes($this->plugin);
            }

            /** @return list<array{loc: string, lastmod?: string}> */
            public function get_url_list($page_num, $object_subtype = '')
            {
                return Sitemap::urls($this->plugin, (string) $object_subtype, max(1, (int) $page_num));
            }

            public function get_max_num_pages($object_subtype = '')
            {
                return Sitemap::pages($this->plugin, (string) $object_subtype);
            }
        };
    }

    /**
     * The sub-sitemaps: each kind whose `url` gives its items public addresses, by a name core's
     * sitemap URLs can carry, then the app's pages.
     *
     * @return array<string, array{label: string, kind?: string}>
     */
    public static function subtypes(Plugin $plugin): array
    {
        $out = [];
        // While a build's migrations are pending its tables may not match it: list nothing of the app's.
        foreach ($plugin->unavailable() !== null ? [] : $plugin->schema->collections() as $name => $spec) {
            if (is_string($spec['url'] ?? null) && isset($spec['wp']['postType'])) {
                $out[self::slug((string) $name)] = ['label' => (string) ($spec['label'] ?? $name), 'kind' => (string) $name];
            }
        }
        // The app's pages are First's to list only while First renders them here.
        if (AppRouter::instance() !== null && $plugin->schema->frontend() === null) {
            $out[self::PAGES] = ['label' => 'Pages'];
        }

        return $out;
    }

    /** How many sitemap files a sub-sitemap needs; none when it has no public URL. */
    public static function pages(Plugin $plugin, string $subtype): int
    {
        $kind = self::subtypes($plugin)[$subtype] ?? null;
        if ($kind === null) {
            return 0;
        }
        $count = isset($kind['kind']) ? self::count($plugin, $kind['kind']) : count(self::appPages($plugin));

        return (int) ceil($count / wp_sitemaps_get_max_urls(self::NAME));
    }

    /**
     * One file of a sub-sitemap.
     *
     * @return list<array{loc: string, lastmod?: string}>
     */
    public static function urls(Plugin $plugin, string $subtype, int $page): array
    {
        $kind = self::subtypes($plugin)[$subtype] ?? null;
        if ($kind === null) {
            return [];
        }
        $max = wp_sitemaps_get_max_urls(self::NAME);
        $entries = isset($kind['kind'])
            ? self::items($plugin, $kind['kind'], $max, ($page - 1) * $max)
            : array_slice(self::appPages($plugin), ($page - 1) * $max, $max);
        $out = [];
        foreach ($entries as $entry) {
            /**
             * Filters one entry of First's sitemap, as core filters its own (`wp_sitemaps_posts_entry`).
             * Return an empty value to leave the URL out.
             *
             * @param array{loc: string, lastmod?: string} $entry
             * @param string $subtype the kind's sub-sitemap name, or `pages`
             */
            $entry = apply_filters('first_sitemap_entry', $entry, $subtype);
            if (is_array($entry) && is_string($entry['loc'] ?? null) && $entry['loc'] !== '') {
                $out[] = $entry;
            }
        }

        return $out;
    }

    // ================================================================ users

    /** Core's author query, narrowed to the users whose row the users kind's read rule shows a visitor. */
    private static function readableUsers(Plugin $plugin, array $args): array
    {
        $collection = $plugin->schema->auth()['collection'] ?? null;
        if (!is_string($collection) || $plugin->unavailable() !== null) {
            return $args;
        }
        try {
            $keys = $plugin->db()->permittedKeys($collection, 'read', new Viewer(null));
        } catch (\First\HttpError) {
            $keys = []; // the rule refuses signed-out visitors
        }
        if ($keys === null) {
            return $args;
        }
        // No readable user is no author at all: an empty `include` would mean "everyone" to core.
        $args['include'] = $keys === [] ? [0] : array_map('intval', $keys);

        return $args;
    }

    // ================================================================ kinds

    /** The rows of a kind an anonymous visitor reads: the read rule and draft visibility decide. */
    private static function count(Plugin $plugin, string $kind, ?array $where = null): int
    {
        try {
            return $plugin->db()->count($kind, $where, new Viewer(null), self::everyLocale($plugin, $kind));
        } catch (\First\HttpError) {
            return 0; // the read rule refuses signed-out visitors outright
        }
    }

    /**
     * @return list<array{loc: string, lastmod?: string}>
     */
    private static function items(Plugin $plugin, string $kind, int $limit, int $offset): array
    {
        $spec = $plugin->schema->collection($kind);
        $pk = $spec['primaryKey'];
        try {
            // First's read pipeline as a signed-out visitor picks the rows; only their ids are read.
            $rows = $plugin->db()->findMany($kind, ['columns' => [$pk => true], 'orderBy' => [$pk => 'asc'], 'limit' => $limit, 'offset' => $offset]
                + self::everyLocale($plugin, $kind), new Viewer(null));
        } catch (\First\HttpError) {
            return [];
        }
        $ids = array_map(static fn (array $row): int => (int) $row[$pk], $rows);
        if ($ids === []) {
            return [];
        }
        _prime_post_caches($ids, false, false);
        $out = [];
        foreach ($ids as $id) {
            $post = get_post($id);
            // A password-protected item is not a visitor's to read. The read above leaves it out for a
            // request without the password's cookie; the sitemap is the same document with one.
            if (!$post instanceof \WP_Post || $post->post_status !== 'publish' || $post->post_password !== '') {
                continue;
            }
            // The kind's pattern builds the link (`post_type_link`); an item whose pattern has an
            // empty placeholder has no address of its own, and core's `?p=` form is not listed.
            if (KindUrls::instance()?->path($kind, $post) === null) {
                continue;
            }
            $out[] = ['loc' => (string) get_permalink($post), 'lastmod' => (string) wp_date(DATE_W3C, (int) strtotime($post->post_modified_gmt . ' UTC'))];
        }

        return $out;
    }

    /** Every translation has its own URL, so a localized kind lists the rows of every locale. */
    private static function everyLocale(Plugin $plugin, string $kind): array
    {
        return $plugin->schema->locales() !== null && ($plugin->schema->collection($kind)['localized'] ?? false) ? ['locale' => '*'] : [];
    }

    // ================================================================ app pages

    /** @var ?list<array{loc: string}> the app's listed pages, once per request (finding them renders each) */
    private static ?array $appPages = null;

    /**
     * The app's public pages, in route order: the ones `/llms.txt` lists, less the home page (core's
     * pages sitemap has it) and any page whose metadata says `robots: { index: false }`.
     *
     * @return list<array{loc: string}>
     */
    private static function appPages(Plugin $plugin): array
    {
        if (self::$appPages !== null) {
            return self::$appPages;
        }
        $out = [];
        if ($plugin->unavailable() === null) {
            foreach (AppRouter::instance()?->pages() ?? [] as [$path]) {
                if ($path !== '/' && self::indexed($plugin, $path)) {
                    $out[] = ['loc' => user_trailingslashit(home_url($path))];
                }
            }
        }

        return self::$appPages = $out;
    }

    /** Whether a parameterless page asks to be indexed: its layouts' and its own `metadata.robots`. */
    private static function indexed(Plugin $plugin, string $pattern): bool
    {
        $app = $plugin->schema->app() ?? [];
        foreach ($app['routes'] ?? [] as $route) {
            if ($route['pattern'] !== $pattern || ($route['page'] ?? null) === null) {
                continue;
            }
            $metadata = [];
            foreach ([...$route['layouts'], $route['page']] as $file) {
                $meta = $app['files'][$file]['metadata'] ?? null;
                if (is_array($meta) && isset($meta['fn'])) {
                    // A function sees what an anonymous visitor's render gives it: no params here.
                    $props = new \First\JsObject(['params' => new \First\JsObject([])]);
                    try {
                        $meta = \First\Seam::asViewer(new Viewer(null), static fn () => \First\Seam::toPhp(('\\FirstApp\\' . $meta['fn'])($props)));
                    } catch (\Throwable) {
                        return false; // metadata a visitor's render can't produce: not listed
                    }
                }
                $metadata[] = is_array($meta) ? $meta : [];
            }

            return (AppRouter::head($metadata)['robots']['index'] ?? true) !== false;
        }

        return false;
    }

    /** A kind's name as core's sitemap URLs carry a subtype: lower-case letters, digits, `_` and `-`. */
    private static function slug(string $name): string
    {
        return strtolower((string) preg_replace('/[^A-Za-z0-9_-]+/', '-', $name));
    }
}
