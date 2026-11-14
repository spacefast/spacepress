<?php

declare(strict_types=1);

namespace First\Render;

use First\HttpError;
use First\Js;
use First\Seam;
use First\Viewer;
use First\Wp\AppRouter;
use First\Wp\KindUrls;
use First\Wp\MarkdownTwins;
use First\Wp\Plugin;
use First\Wp\WpFiles;

/**
 * Prebuilt `first/app/` pages (docs/decisions/2026-11-13-static-output.md).
 *
 * A prebuilt page is an anonymous visitor's render through the router, fetched over HTTP with the
 * `X-First-Prerender` header (an HMAC of the path, keyed by the site's runtime secret). The router
 * answers such a request as a signed-out visitor, past Batcache and the file lane, records what it
 * read, and says which viewer function it called.
 *
 * - `urls()`: what to build, as the site sees it now (literal routes, a kind route's published items,
 *   `staticParams`), with the old URLs of those items that should redirect.
 * - In `output: "server"`, the `first_prebuild` Action Scheduler action renders URLs into
 *   `wp-content/cache/first-prebuilt/<build>/` and `serve()` answers from there before the request
 *   is parsed. A write that would purge a prebuilt URL deletes its files and schedules the action
 *   for it (on-demand regeneration); until it has run, the URL renders per request.
 * - `GET /__first/api/v1/prerender` lists the URLs for `first export`, to an editor.
 */
final class Prebuilt
{
    public const HEADER = 'X-First-Prerender';
    public const REFUSED = 'X-First-Prerender-Refused';
    public const ACTION = 'first_prebuild';
    public const ROUTE = 'prerender';
    /** URLs one action renders; the rest go to a following action. */
    public const BATCH = 50;

    private static ?Plugin $plugin = null;
    /** @var ?string the viewer function this prerender request called, reported in REFUSED */
    private static ?string $refused = null;

    public static function register(): void
    {
        \First\Extensions::route(self::ROUTE, self::route(...));
    }

    /** Called by the app plugin as it boots: the file lane, the regeneration action and its triggers. */
    public static function boot(Plugin $plugin): void
    {
        $app = $plugin->schema->app();
        if (!is_array($app) || !self::any($app)) {
            return;
        }
        self::$plugin = $plugin;
        if (self::prerendering()) {
            // The render as any signed-out visitor sees it, whatever cookies came with the request.
            add_filter('determine_current_user', static fn (): int => 0, PHP_INT_MAX);
            if (function_exists('batcache_cancel')) {
                batcache_cancel();
            }
            return;
        }
        if (($app['output'] ?? 'server') !== 'server') {
            return;
        }
        add_action('plugins_loaded', self::serve(...), PHP_INT_MAX);
        add_action(self::ACTION, self::build(...), 10, 1);
        // After a build is initialized (first request, migrate, activation) the files are made.
        add_action('init', static function (): void {
            if (!get_option(self::option()) && self::$plugin?->unavailable() === null && function_exists('as_enqueue_async_action')
                && !as_has_scheduled_action(self::ACTION, null, 'first')) {
                update_option(self::option(), 'scheduled', false);
                as_enqueue_async_action(self::ACTION, [[]], 'first');
            }
        }, 20);
    }

    /** Prebuilt files are served here and kept current: the build is `output: "server"` with a prebuilt page. */
    public static function active(): bool
    {
        return self::$plugin !== null && !self::prerendering() && ((self::$plugin->schema->app()['output'] ?? 'server') === 'server');
    }

    /** Whether any route of the table is prebuilt. */
    private static function any(array $app): bool
    {
        foreach ($app['routes'] as $route) {
            if ($route['prerender'] ?? false) {
                return true;
            }
        }
        return false;
    }

    /** The option that says this build's files have been scheduled. */
    private static function option(): string
    {
        return 'first_prebuilt_' . substr(self::build_id(), 0, 16);
    }

    private static function build_id(): string
    {
        return (string) self::$plugin?->buildHash();
    }

    // ------------------------------------------------------------------ the prerender request

    /** The header value that proves a request comes from this site's own prebuild or `first export`. */
    public static function token(string $path): string
    {
        return hash_hmac('sha256', 'first-prerender:' . $path, WpFiles::ensureSecret());
    }

    /** This request carries a valid prerender header for its own path. */
    public static function prerendering(): bool
    {
        static $answer = null;
        if ($answer !== null) {
            return $answer;
        }
        $given = $_SERVER['HTTP_X_FIRST_PRERENDER'] ?? null;
        if (!is_string($given) || $given === '' || !function_exists('get_option')) {
            return $answer = false;
        }
        $path = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        return $answer = hash_equals(self::token($path), $given);
    }

    /** A viewer function ran while prerendering: the page can't be one file for everyone. */
    public static function viewerCall(string $function): void
    {
        if (self::prerendering() && self::$refused === null) {
            self::$refused = $function;
            if (!headers_sent()) {
                header(self::REFUSED . ': ' . $function);
            }
        }
    }

    // ------------------------------------------------------------------ what to build

    /**
     * Every URL to prebuild, as root-relative paths below the home URL, with the route that serves it;
     * and old URLs of listed kind items that redirect to them.
     *
     * @return array{urls: list<array{path: string, route: string}>, redirects: list<array{from: string, to: string}>, build: string}
     */
    public static function urls(Plugin $plugin): array
    {
        $app = $plugin->schema->app() ?? ['routes' => [], 'files' => []];
        $plugin->app();
        $urls = [];
        $redirects = [];
        $anonymous = new Viewer(null);
        foreach ($app['routes'] as $route) {
            if (!($route['prerender'] ?? false) || ($route['page'] ?? null) === null) {
                continue;
            }
            $pattern = (string) $route['pattern'];
            if (!str_contains($pattern, ':') && !str_contains($pattern, '*')) {
                $urls[] = ['path' => $pattern, 'route' => (string) $route['id']];
                continue;
            }
            if (($route['kind'] ?? null) !== null) {
                foreach (self::items($plugin, (string) $route['kind']['name'], $anonymous) as [$path, $old]) {
                    $urls[] = ['path' => $path, 'route' => (string) $route['id']];
                    foreach ($old as $from) {
                        $redirects[] = ['from' => $from, 'to' => $path];
                    }
                }
                continue;
            }
            $fn = $app['files'][$route['page']]['staticParams'] ?? null;
            if (!is_string($fn)) {
                continue;
            }
            $callable = '\\FirstApp\\' . $fn;
            $list = Seam::asViewer($anonymous, static fn () => Seam::toPhp(\First\JsJobs::await($callable())));
            foreach (is_array($list) ? $list : [] as $i => $params) {
                $urls[] = ['path' => self::fill($pattern, is_array($params) ? $params : [], (string) $route['page'], $i), 'route' => (string) $route['id']];
            }
        }
        $seen = [];
        $urls = array_values(array_filter($urls, static function (array $u) use (&$seen): bool {
            if (isset($seen[$u['path']])) {
                return false;
            }
            return $seen[$u['path']] = true;
        }));
        return ['urls' => $urls, 'redirects' => $redirects, 'build' => $plugin->buildHash()];
    }

    /**
     * A kind's items a signed-out visitor may read, as (path, old paths): the path its `url` gives
     * it, and the paths it had before a slug change (core's `_wp_old_slug`).
     *
     * @return list<array{string, list<string>}>
     */
    private static function items(Plugin $plugin, string $kind, Viewer $viewer): array
    {
        $spec = $plugin->schema->collection($kind);
        $urls = KindUrls::instance();
        $postType = $spec['wp']['postType'] ?? null;
        if ($urls === null || !is_string($postType)) {
            return [];
        }
        $pk = (string) $spec['primaryKey'];
        $out = [];
        $after = null;
        do {
            $where = $after === null ? [] : [$pk => ['gt' => $after]];
            $rows = Seam::asViewer($viewer, static fn () => \First\Db::instance()->findMany($kind, ['where' => $where, 'orderBy' => [$pk => 'asc'], 'limit' => 500], $viewer));
            foreach ($rows as $row) {
                $after = $row[$pk];
                $post = get_post((int) $row[$pk]);
                if (!$post instanceof \WP_Post || !is_post_publicly_viewable($post)) {
                    continue;
                }
                $path = $urls->path($kind, $post);
                if ($path === null) {
                    continue;
                }
                $old = [];
                foreach ((array) get_post_meta($post->ID, '_wp_old_slug') as $slug) {
                    if (!is_string($slug) || $slug === '' || $slug === $post->post_name) {
                        continue;
                    }
                    $moved = clone $post;
                    $moved->post_name = $slug;
                    $from = $urls->path($kind, $moved);
                    if ($from !== null && $from !== $path) {
                        $old[] = $from;
                    }
                }
                $out[] = [$path, $old];
            }
        } while (count($rows) === 500);
        return $out;
    }

    /** A route pattern with one `staticParams` entry's values: `/tags/:tag` + `{tag: "a b"}` → `/tags/a%20b`. */
    private static function fill(string $pattern, array $params, string $file, int $index): string
    {
        $out = [];
        foreach (explode('/', trim($pattern, '/')) as $part) {
            if (!str_starts_with($part, ':') && !str_starts_with($part, '*')) {
                $out[] = $part;
                continue;
            }
            $name = ltrim($part, ':*');
            $value = $params[$name] ?? null;
            $values = is_array($value) ? $value : [$value];
            foreach ($values as $v) {
                if (!is_string($v) || $v === '' || str_contains($v, '/') || $v === '.' || $v === '..') {
                    throw new \RuntimeException("staticParams in $file: entry $index needs `$name` as " . (is_array($value) || str_starts_with($part, '*') ? 'a list of path segments' : 'one path segment') . ', not ' . json_encode($value));
                }
                $out[] = rawurlencode($v);
            }
        }
        return '/' . implode('/', $out);
    }

    /** `GET /__first/api/v1/prerender`: the URLs to build, to someone who may edit the site. */
    public static function route(string $method, array $parts, array $query, string $body, Viewer $viewer): array
    {
        \First\App::allow($method, ['GET']);
        $plugin = class_exists(\First\Wp\Runtime::class, false) ? \First\Wp\Runtime::plugin() : null;
        if ($plugin === null || count($parts) !== 1 || !is_array($plugin->schema->app())) {
            throw HttpError::notFound('This app has no first/app/ pages');
        }
        if ($viewer->user === null) {
            throw new HttpError(401, 'unauthenticated', 'Sign in as an editor to list the pages to prebuild (FIRST_APP_PASSWORD or FIRST_TOKEN)');
        }
        if (!in_array($viewer->user['role'] ?? null, ['editor', 'admin'], true)) {
            throw new HttpError(403, 'forbidden', 'Only an editor or administrator lists the pages to prebuild');
        }
        $answer = self::urls($plugin);
        $answer['output'] = $plugin->schema->app()['output'] ?? 'server';
        // The header each render needs: the export fetches with it, and the site checks it.
        foreach ($answer['urls'] as &$url) {
            $url['token'] = self::token(self::full($url['path']));
        }
        unset($url);
        $answer['notFound'] = ['path' => '/__first-not-found', 'token' => self::token(self::full('/__first-not-found'))];
        return [200, ['data' => $answer]];
    }

    /** A path below the home URL as the request will carry it (with the home path in front). */
    private static function full(string $path): string
    {
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        return $base . ($path === '/' ? '/' : $path);
    }

    // ------------------------------------------------------------------ files (output: "server")

    /** This build's directory of prebuilt files; `first_prebuilt_dir` moves it. */
    public static function dir(): string
    {
        return (string) apply_filters('first_prebuilt_dir', WP_CONTENT_DIR . '/cache/first-prebuilt') . '/' . substr(self::build_id(), 0, 16);
    }

    /**
     * The two files of a path: `/` → index.html, `/a/b` → a/b.html (and .md). Each segment is named by
     * its percent-encoded form, so `/tags/lab notes` and `/tags/lab%20notes` are one file.
     */
    private static function files(string $path): array
    {
        $stem = $path === '/' ? 'index' : implode('/', array_map(static fn (string $s): string => rawurlencode(rawurldecode($s)), explode('/', trim($path, '/'))));
        return [self::dir() . '/' . $stem . '.html', self::dir() . '/' . $stem . '.md'];
    }

    /**
     * plugins_loaded: answer a GET or HEAD for a prebuilt path from its file, before WordPress parses
     * the request. Anything that could make the answer differ (a query string, a signed-in, preview or
     * comment-author cookie, a missing file) falls through to the router.
     */
    public static function serve(): void
    {
        if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true) || (string) ($_SERVER['QUERY_STRING'] ?? '') !== '' || is_admin()) {
            return;
        }
        foreach (array_keys($_COOKIE) as $name) {
            if (preg_match('/^(wordpress_logged_in_|wordpress_sec_|wp-postpass_|comment_author_|wp_lang$|zi_session|__Host-zi_session)/', (string) $name) === 1) {
                return;
            }
        }
        $uri = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '' && $uri !== $base && !str_starts_with($uri, $base . '/')) {
            return;
        }
        $path = substr($uri, strlen($base)) ?: '/';
        $markdown = str_ends_with($path, '.md');
        $html = $markdown ? (substr($path, 0, -3) === '/index' ? '/' : substr($path, 0, -3)) : $path;
        if ($html !== '/' && (str_ends_with($html, '/') || str_contains(rawurldecode($html), '..') || str_contains(rawurldecode($html), "\0") || str_contains(rawurldecode($html), '\\'))) {
            return;
        }
        $file = self::files($html)[$markdown ? 1 : 0];
        if (!is_file($file)) {
            return;
        }
        [$control] = Cache::policy(200, true, false);
        header('Cache-Control: ' . $control);
        header('X-First-Prebuilt: 1');
        if ($markdown) {
            header('Content-Type: ' . MarkdownTwins::CONTENT_TYPE);
            header('X-Content-Type-Options: nosniff');
            header('Link: <' . home_url($html) . '>; rel="canonical"');
        } else {
            header('Content-Type: text/html; charset=' . get_option('blog_charset'));
            header('Link: <' . MarkdownTwins::twin(home_url($html)) . '>; rel="alternate"; type="text/markdown"');
        }
        $signal = MarkdownTwins::contentSignal();
        if ($signal !== '') {
            header('Content-Signal: ' . $signal);
        }
        header('Content-Length: ' . (string) filesize($file));
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
            readfile($file);
        }
        exit;
    }

    /**
     * The `first_prebuild` action: render paths (all of this build's when `$paths` is empty) and
     * write their files. More than BATCH paths continue in another action.
     *
     * @param list<string> $paths
     */
    public static function build(array $paths = []): void
    {
        $plugin = self::$plugin;
        if ($plugin === null || $plugin->unavailable() !== null) {
            return;
        }
        $all = $paths === [];
        if ($all) {
            self::sweep();
            $paths = array_column(self::urls($plugin)['urls'], 'path');
        }
        $rest = array_slice($paths, self::BATCH);
        if ($rest !== []) {
            as_enqueue_async_action(self::ACTION, [$rest], 'first');
        }
        foreach (array_slice($paths, 0, self::BATCH) as $path) {
            self::render((string) $path);
        }
        if ($all) {
            update_option(self::option(), 'built', false);
        }
    }

    /** One path, rendered by loopback and written, or its files removed when it no longer renders. */
    private static function render(string $path): void
    {
        [$html, $md] = self::files($path);
        $fetch = static fn (string $url, string $signed) => wp_remote_get((string) apply_filters('first_prebuild_url', $url), [
            'timeout' => 30, 'redirection' => 0, 'sslverify' => false,
            'headers' => [self::HEADER => self::token($signed)],
        ]);
        $page = $fetch(home_url($path), self::full($path));
        $code = is_wp_error($page) ? 0 : (int) wp_remote_retrieve_response_code($page);
        $refused = is_wp_error($page) ? '' : (string) wp_remote_retrieve_header($page, strtolower(self::REFUSED));
        if ($code !== 200 || $refused !== '') {
            @unlink($html);
            @unlink($md);
            if ($refused !== '') {
                error_log("First: $path is prebuilt, and its render called $refused; it renders per request instead");
            }
            return;
        }
        $twin = MarkdownTwins::twin(home_url($path));
        $markdown = $fetch($twin, (string) (wp_parse_url($twin, PHP_URL_PATH) ?? ''));
        self::write($html, (string) wp_remote_retrieve_body($page));
        if (!is_wp_error($markdown) && (int) wp_remote_retrieve_response_code($markdown) === 200) {
            self::write($md, (string) wp_remote_retrieve_body($markdown));
        } else {
            @unlink($md);
        }
    }

    /** Write by rename, so a reader sees the old file or the new one, never part of one. */
    private static function write(string $file, string $bytes): void
    {
        $dir = dirname($file);
        if (!is_dir($dir) && !wp_mkdir_p($dir)) {
            return;
        }
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (file_put_contents($tmp, $bytes) === strlen($bytes)) {
            rename($tmp, $file);
        } else {
            @unlink($tmp);
        }
    }

    /** Removes other builds' directories: files from another build are never served, and are a cache. */
    private static function sweep(): void
    {
        $root = dirname(self::dir());
        foreach (is_dir($root) ? (array) scandir($root) : [] as $entry) {
            if ($entry !== '.' && $entry !== '..' && preg_match('/^[0-9a-f]{16}$/', (string) $entry) === 1 && $root . '/' . $entry !== self::dir()) {
                self::remove($root . '/' . $entry);
            }
        }
    }

    private static function remove(string $dir): void
    {
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST) as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($dir);
    }

    /**
     * After a committed write: the prebuilt paths among the URLs it changed lose their files now (so
     * they render per request at once) and are rebuilt by a `first_prebuild` action.
     *
     * @param list<string> $paths root-relative paths with their query, as purges name them
     */
    public static function stale(array $paths): void
    {
        $plugin = self::$plugin;
        $app = $plugin?->schema->app();
        if (!is_array($app)) {
            return;
        }
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        $hit = [];
        $all = in_array('/*', $paths, true);
        foreach ($paths as $p) {
            $path = (string) (wp_parse_url($p, PHP_URL_PATH) ?? '');
            if ($path === '' || (string) (wp_parse_url($p, PHP_URL_QUERY) ?? '') !== '' || str_ends_with($path, '.md')) {
                continue;
            }
            if ($base !== '' && str_starts_with($path, $base)) {
                $path = substr($path, strlen($base)) ?: '/';
            }
            $path = $path === '/' ? '/' : rtrim($path, '/');
            $match = AppRouter::match($app['routes'], $path);
            if ($match !== null && ($match['route']['prerender'] ?? false)) {
                $hit[$path] = true;
            }
        }
        if ($all) {
            self::remove(self::dir());
            delete_option(self::option());
            return;
        }
        foreach (array_keys($hit) as $path) {
            foreach (self::files($path) as $file) {
                @unlink($file);
            }
        }
        if ($hit !== [] && function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action(self::ACTION, [array_keys($hit)], 'first');
        }
    }
}
