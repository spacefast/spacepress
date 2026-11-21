<?php

declare(strict_types=1);

namespace TypedPress\Wp;

/**
 * The project's `public/` folder, stored under `wp-content/` and symlinked into the document root
 * (`tp_public_root`, default `ABSPATH`, skipped on multisite or read-only roots) so the web server
 * serves direct root requests (e.g. `/favicon.ico`, `/logo.svg`, `/files/blog.json`) straight off
 * disk without booting PHP:
 * - Static assets imported from TSX/TS or referenced by relative CSS `url(...)` live under
 *   `wp-content/.../tp/app/assets/<stem>-<hash>.<ext>` (immutable, 1-year cache).
 * - `public/` holds untouched root-URL files symlinked into the document root pointing into
 *   `wp-content/`. `metadata.scripts` appends `?tpv=<hash>` from `tp/app/public-files.json`.
 * - `/.well-known/*` is the one exception kept on `do_parse_request` in PHP, so `/.well-known/`
 *   files work at the site root even on hosts with a read-only document root.
 */
final class PublicFiles
{
    public const MANIFEST = 'tp/app/public-files.json';
    public const SYMLINKS_OPTION = 'tp_public_symlinks';

    /** By extension; anything else is `application/octet-stream`. */
    private const TYPES = [
        'html' => 'text/html; charset=utf-8', 'htm' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
        'json' => 'application/json', 'map' => 'application/json', 'webmanifest' => 'application/manifest+json',
        'txt' => 'text/plain; charset=utf-8', 'md' => 'text/markdown; charset=utf-8', 'xml' => 'application/xml', 'csv' => 'text/csv; charset=utf-8',
        'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif',
        'webp' => 'image/webp', 'avif' => 'image/avif', 'ico' => 'image/x-icon',
        'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf',
        'wasm' => 'application/wasm', 'pdf' => 'application/pdf', 'zip' => 'application/zip', 'gz' => 'application/gzip',
    ];

    /** `/.well-known/` names WordPress plugins and hosts answer: TypedPress Identity's discovery, the host's. */
    private const WELL_KNOWN = ['openid-configuration', 'oauth-authorization-server', 'jwks.json', 'spacefast-runtime', 'stattic-runtime'];

    /** Never served or linked, whatever their place in `public/`: code WordPress would run, and server config. */
    private const REFUSED = ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'htaccess', 'htpasswd', 'ini', 'user.ini'];

    public static function register(Plugin $plugin): void
    {
        if (is_dir($plugin->dir . '/public/.well-known')) {
            // After the facade (0) and the app router's handlers (0), before the Markdown twins (1):
            // only `/.well-known/*` is served through PHP.
            add_filter('do_parse_request', static function (bool $parse) use ($plugin): bool {
                if ($parse) {
                    self::serveWellKnown($plugin);
                }

                return $parse;
            }, 0);
        }
        // Loose plugin installs (copied into wp-content/plugins without activation): sync root
        // symlinks whenever the public manifest changes. Managed builds sync in Runtime::install()
        // and Receiver::rollback().
        if (!Runtime::managed() && !Runtime::inspecting()) {
            add_action('init', static function () use ($plugin): void {
                self::maybeSyncSymlinks($plugin);
            }, 1);
        }
    }

    /** @return array<string, string> relative path below `public/` => 12-hex content version */
    public static function manifest(Plugin $plugin): array
    {
        return self::manifestForDir($plugin->dir);
    }

    /** @return array<string, string> */
    private static function manifestForDir(string $dir): array
    {
        static $parsed = [];
        if (!isset($parsed[$dir])) {
            $raw = self::manifestRaw($dir);
            $map = $raw === '' ? null : json_decode($raw, true);
            $parsed[$dir] = is_array($map) ? array_filter($map, static fn ($v, $k): bool => is_string($k) && is_string($v), ARRAY_FILTER_USE_BOTH) : [];
        }

        return $parsed[$dir];
    }

    public static function manifestHash(Plugin $plugin): ?string
    {
        $raw = self::manifestRaw($plugin->dir);

        return $raw === '' ? null : hash('sha256', $raw);
    }

    private static function manifestRaw(string $dir): string
    {
        static $maps = [];
        if (!isset($maps[$dir])) {
            // Read as data: a loose deploy that preserves mtime must not leave old opcodes in use.
            $file = $dir . '/' . self::MANIFEST;
            $maps[$dir] = is_file($file) ? (string) @file_get_contents($file) : '';
        }

        return $maps[$dir];
    }

    /** Content version (12-hex SHA-256) of a JavaScript file in `public/`, or null. */
    public static function scriptVersion(Plugin $plugin, string $relative): ?string
    {
        $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
        if ($ext !== 'js' && $ext !== 'mjs') {
            return null;
        }
        $manifest = self::manifest($plugin);

        return $manifest[$relative] ?? null;
    }

    /** Whether the app's `public/` folder serves a file at `$path` (below the home URL). */
    public static function serves(Plugin $plugin, string $path): bool
    {
        $rel = self::relativePath($path, $plugin->schema->reserved());
        if ($rel !== null && isset(self::manifest($plugin)[$rel])) {
            return true;
        }

        return is_dir($plugin->dir . '/public/.well-known')
            && self::wellKnownFile($plugin->dir . '/public', $path) !== null;
    }

    /**
     * The `wp-content/` directory holding `$plugin`'s public files on disk, or null when a managed
     * build has no public assets mirror configured (never expose a private build store via symlinks).
     */
    public static function publicDir(Plugin $plugin): ?string
    {
        if (Runtime::managed()) {
            $loaded = class_exists(\TypedPress\Loader\Loader::class, false) ? \TypedPress\Loader\Loader::loaded() : null;
            $assetsDir = is_array($loaded) && is_string($loaded['assetsDir'] ?? null) && $loaded['assetsDir'] !== ''
                ? rtrim($loaded['assetsDir'], '/\\')
                : null;
            $manifest = is_array($loaded['manifest'] ?? null) ? $loaded['manifest'] : null;
            if ($assetsDir === null || $manifest === null) {
                return null;
            }

            return $assetsDir . '/app/' . $manifest['app'] . '/plugins/typedpress-app-' . $manifest['name'] . '/public';
        }

        return $plugin->dir . '/public';
    }

    /** Sync root symlinks for a loose plugin when its manifest, source, or root changed. */
    private static function maybeSyncSymlinks(Plugin $plugin): void
    {
        $root = self::documentRoot();
        if ($root === null) {
            return;
        }
        $publicDir = self::publicDir($plugin);
        $source = $publicDir !== null ? (realpath($publicDir) ?: '') : '';
        $hash = self::manifestHash($plugin) ?? '';
        $stored = get_option(self::SYMLINKS_OPTION);
        if (is_array($stored)) {
            if (($stored['root'] ?? null) === $root && ($stored['source'] ?? null) === $source && ($stored['hash'] ?? null) === $hash) {
                return;
            }
        } elseif ($hash === '') {
            return;
        }
        self::syncSymlinks($plugin);
    }

    /**
     * Sync symlinks in the document root (`tp_public_root`, default `ABSPATH`) pointing to the app's
     * `public/` files under `wp-content/`, so direct requests like `/logo.svg` or `/files/blog.json`
     * are served directly by the web server without booting PHP. Skipped on multisite or when the
     * document root is not writable. Never overwrites existing non-symlink files, never links
     * top-level `index.html`, and cleans up stale symlinks from previous builds.
     */
    public static function syncSymlinks(Plugin $plugin): void
    {
        $publicDir = self::publicDir($plugin);
        if ($publicDir === null) {
            return;
        }
        self::syncSymlinksForDir($plugin->dir, $publicDir, $plugin->schema);
    }

    public static function syncSymlinksForDir(string $appDir, string $publicDir, \TypedPress\Schema $schema): void
    {
        $root = self::documentRoot();
        if ($root === null) {
            return;
        }
        $stored = get_option(self::SYMLINKS_OPTION);
        $prevRoot = is_array($stored) && is_string($stored['root'] ?? null) ? rtrim($stored['root'], '/\\') : $root;
        $prevLinks = is_array($stored) && is_array($stored['links'] ?? null) ? array_values(array_filter($stored['links'], 'is_string')) : [];
        $prevDirs = is_array($stored) && is_array($stored['dirs'] ?? null) ? array_values(array_filter($stored['dirs'], 'is_string')) : [];
        $prevLinkSet = array_fill_keys($prevLinks, true);

        $sourceTop = is_dir($publicDir) ? realpath($publicDir) : false;
        $manifest = self::manifestForDir($appDir);
        $raw = self::manifestRaw($appDir);
        $hash = $raw === '' ? '' : hash('sha256', $raw);
        $reserved = $schema->reserved();

        $desired = [];
        if ($sourceTop !== false && $manifest !== []) {
            foreach (array_keys($manifest) as $rel) {
                // Never symlink top-level index.html/htm: Apache/nginx DirectoryIndex would serve it for `/`.
                $lower = strtolower($rel);
                if ($lower === 'index.html' || $lower === 'index.htm') {
                    continue;
                }
                if (self::relativePath('/' . $rel, $reserved) !== $rel) {
                    continue;
                }
                $pagePath = '/' . (str_ends_with($lower, '/index.html') ? substr($rel, 0, -strlen('/index.html')) : $rel);
                if (self::literalPage($schema, $pagePath)) {
                    continue;
                }
                $real = realpath($sourceTop . '/' . $rel);
                if ($real === false || !str_starts_with($real, $sourceTop . DIRECTORY_SEPARATOR) || !is_file($real)) {
                    continue;
                }
                $resolved = strtolower(basename($real));
                if (in_array(strtolower(pathinfo($resolved, PATHINFO_EXTENSION)), self::REFUSED, true) || in_array($resolved, self::REFUSED, true)) {
                    continue;
                }
                $dot = false;
                foreach (explode(DIRECTORY_SEPARATOR, substr($real, strlen($sourceTop) + 1)) as $part) {
                    if (str_starts_with($part, '.')) {
                        $dot = true;
                        break;
                    }
                }
                if (!$dot) {
                    $desired[$rel] = $real;
                }
            }
        }

        // Remove symlinks from previous builds that are no longer desired (or moved root).
        foreach ($prevLinks as $old) {
            if ($prevRoot !== $root || !isset($desired[$old])) {
                $path = $prevRoot . '/' . $old;
                if (is_link($path)) {
                    @unlink($path);
                }
            }
        }

        $createdLinks = [];
        $ownedDirs = $prevRoot === $root ? array_fill_keys($prevDirs, true) : [];
        foreach ($desired as $rel => $target) {
            $dest = $root . '/' . $rel;
            $dirOk = true;
            $segments = explode('/', $rel);
            array_pop($segments);
            $cur = '';
            foreach ($segments as $seg) {
                $cur = $cur === '' ? $seg : $cur . '/' . $seg;
                $dirPath = $root . '/' . $cur;
                if (is_link($dirPath) || (file_exists($dirPath) && !is_dir($dirPath))) {
                    $dirOk = false;
                    break;
                }
                if (!is_dir($dirPath)) {
                    if (!@mkdir($dirPath, 0755)) {
                        $dirOk = false;
                        break;
                    }
                    $ownedDirs[$cur] = true;
                }
            }
            if (!$dirOk) {
                continue;
            }
            if (is_link($dest)) {
                if (@readlink($dest) === $target) {
                    $createdLinks[] = $rel;
                    continue;
                }
                if ($prevRoot === $root && isset($prevLinkSet[$rel])) {
                    @unlink($dest);
                    if (@symlink($target, $dest)) {
                        $createdLinks[] = $rel;
                    }
                }
                continue;
            }
            if (file_exists($dest)) {
                // Never overwrite a real file or directory already in the document root.
                continue;
            }
            if (@symlink($target, $dest)) {
                $createdLinks[] = $rel;
            }
        }

        // Prune empty directories TypedPress previously created that no remaining symlink uses.
        $neededDirs = [];
        foreach ($createdLinks as $rel) {
            $dir = dirname($rel);
            while ($dir !== '.' && $dir !== '') {
                $neededDirs[$dir] = true;
                $dir = dirname($dir);
            }
        }
        $pruneList = $prevRoot === $root ? array_keys($ownedDirs) : $prevDirs;
        usort($pruneList, static fn (string $a, string $b): int => substr_count($b, '/') <=> substr_count($a, '/') ?: strlen($b) <=> strlen($a));
        foreach ($pruneList as $dir) {
            if ($prevRoot !== $root || !isset($neededDirs[$dir])) {
                @rmdir($prevRoot . '/' . $dir);
                unset($ownedDirs[$dir]);
            }
        }
        $keptDirs = array_values(array_intersect(array_keys($ownedDirs), array_keys($neededDirs)));

        if ($createdLinks === [] && $keptDirs === [] && $hash === '') {
            delete_option(self::SYMLINKS_OPTION);
        } else {
            update_option(self::SYMLINKS_OPTION, [
                'root' => $root,
                'source' => $sourceTop ?: '',
                'hash' => $hash,
                'links' => $createdLinks,
                'dirs' => $keptDirs,
            ], true);
        }
    }

    /** Remove every symlink and empty directory TypedPress created in the document root. */
    public static function removeSymlinks(): void
    {
        $stored = get_option(self::SYMLINKS_OPTION);
        if (!is_array($stored) || !is_string($stored['root'] ?? null) || $stored['root'] === '') {
            delete_option(self::SYMLINKS_OPTION);

            return;
        }
        $root = rtrim($stored['root'], '/\\');
        foreach (is_array($stored['links'] ?? null) ? $stored['links'] : [] as $rel) {
            if (is_string($rel) && $rel !== '' && is_link($root . '/' . $rel)) {
                @unlink($root . '/' . $rel);
            }
        }
        $dirs = is_array($stored['dirs'] ?? null) ? array_values(array_filter($stored['dirs'], 'is_string')) : [];
        usort($dirs, static fn (string $a, string $b): int => substr_count($b, '/') <=> substr_count($a, '/') ?: strlen($b) <=> strlen($a));
        foreach ($dirs as $dir) {
            if ($dir !== '') {
                @rmdir($root . '/' . $dir);
            }
        }
        delete_option(self::SYMLINKS_OPTION);
    }

    /** Writable document root for root symlinks, or null on multisite / read-only hosts. */
    private static function documentRoot(): ?string
    {
        if (function_exists('is_multisite') && is_multisite()) {
            return null;
        }
        $default = rtrim(ABSPATH, '/\\');
        $root = function_exists('apply_filters') ? apply_filters('tp_public_root', $default) : $default;
        if (!is_string($root) || $root === '') {
            return null;
        }
        $root = rtrim($root, '/\\');
        if (!is_dir($root) && $root !== $default) {
            @mkdir($root, 0755, true);
        }

        return is_dir($root) && is_writable($root) ? $root : null;
    }

    /** Serve `/.well-known/*` files from `public/.well-known/` at the site root. */
    private static function serveWellKnown(Plugin $plugin): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method !== 'GET' && $method !== 'HEAD' || MarkdownTwins::negotiating()) {
            return;
        }
        $file = self::wellKnownFile($plugin->dir . '/public');
        if ($file === null || self::literalPage($plugin->schema, self::requestPath())) {
            return;
        }
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $size = (int) filesize($file);
        $etag = '"' . dechex($size) . '-' . dechex((int) filemtime($file)) . '"';
        $headers = [
            'Content-Type' => self::TYPES[$extension] ?? 'application/octet-stream',
            'Cache-Control' => 'public, max-age=300',
            'ETag' => $etag,
            'X-Content-Type-Options' => 'nosniff',
            'Access-Control-Allow-Origin' => '*',
        ];
        if ($extension === 'svg' || $extension === 'xml') {
            $headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
        }
        if (self::matches(wp_unslash((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')), $etag)) {
            self::emit(304, $headers, null);
        }
        $headers['Content-Length'] = (string) $size;
        self::emit(200, $headers, $method === 'HEAD' ? null : $file);
    }

    /**
     * Resolves a `/.well-known/*` path to a regular file strictly inside `$root/.well-known`, or
     * null for any other path, reserved `.well-known` name, dotfile, refused extension, or symlink
     * escaping `$root/.well-known`.
     */
    private static function wellKnownFile(string $root, ?string $relative = null): ?string
    {
        $path = $relative ?? self::requestPath();
        if ($path === null || !str_starts_with($path, '/.well-known/')) {
            return null;
        }
        $index = str_ends_with($path, '/');
        $segments = self::decodeSegments($path, allowWellKnown: true);
        if ($segments === null || count($segments) < 2 || strtolower($segments[0]) !== '.well-known') {
            return null;
        }
        if (in_array(strtolower($segments[1]), self::WELL_KNOWN, true)) {
            return null;
        }
        if ($index) {
            $segments[] = 'index.html';
        }
        $name = strtolower((string) end($segments));
        if (in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), self::REFUSED, true) || in_array($name, self::REFUSED, true)) {
            return null;
        }
        $top = realpath($root . '/.well-known');
        $real = realpath($root . '/' . implode('/', $segments));
        if ($real === false || $top === false || !str_starts_with($real, $top . DIRECTORY_SEPARATOR) || !is_file($real)) {
            return null;
        }
        $resolved = strtolower(basename($real));
        if (in_array(strtolower(pathinfo($resolved, PATHINFO_EXTENSION)), self::REFUSED, true) || in_array($resolved, self::REFUSED, true)) {
            return null;
        }
        foreach (explode(DIRECTORY_SEPARATOR, substr($real, strlen($top) + 1)) as $part) {
            if (str_starts_with($part, '.')) {
                return null;
            }
        }

        return $real;
    }

    /** Request path below `home_url('/')`, or null if outside the site's base path. */
    private static function requestPath(): ?string
    {
        $path = (string) (wp_parse_url(wp_unslash((string) ($_SERVER['REQUEST_URI'] ?? '/')), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '') {
            if ($path !== $base && !str_starts_with($path, $base . '/')) {
                return null;
            }
            $path = substr($path, strlen($base)) ?: '/';
        }

        return $path;
    }

    /**
     * Normalized relative path below `public/` for a non-well-known URL path, or null when invalid,
     * reserved, dotfile, or refused.
     *
     * @param list<string> $reserved
     */
    private static function relativePath(string $path, array $reserved): ?string
    {
        $index = str_ends_with($path, '/');
        $segments = self::decodeSegments($path, allowWellKnown: false);
        if ($segments === null || $segments === []) {
            return null;
        }
        $first = strtolower($segments[0]);
        if (in_array($first, $reserved, true) || str_starts_with($first, 'wp-')) {
            return null;
        }
        if ($index) {
            $segments[] = 'index.html';
        }
        $name = strtolower((string) end($segments));
        if (in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), self::REFUSED, true) || in_array($name, self::REFUSED, true)) {
            return null;
        }

        return implode('/', $segments);
    }

    /** @return ?list<string> */
    private static function decodeSegments(string $path, bool $allowWellKnown): ?array
    {
        $segments = [];
        foreach (explode('/', trim($path, '/')) as $raw) {
            if ($raw === '') {
                continue;
            }
            if (preg_match('/%(?![0-9A-Fa-f]{2})/', $raw) === 1) {
                return null;
            }
            $segment = rawurldecode($raw);
            $dot = str_starts_with($segment, '.') && !($allowWellKnown && $segments === [] && $segment === '.well-known');
            if ($segment === '.' || $segment === '..' || $dot || str_contains($segment, "\0") || str_contains($segment, '/') || str_contains($segment, '\\')
                || str_contains($segment, ':') || str_ends_with($segment, '.') || str_ends_with($segment, ' ')) {
                return null;
            }
            $segments[] = $segment;
        }

        return $segments;
    }

    /** Whether a literal `tp/app/` page or route matches `$path`: the app's code wins over a file. */
    private static function literalPage(\TypedPress\Schema $schema, ?string $path): bool
    {
        $app = $schema->app();
        if (!is_array($app) || $path === null) {
            return false;
        }
        if (isset($app['routeIndex'])) {
            $literalOnly = ['literal' => $app['routeIndex']['literal'], 'dynamic' => []];

            return AppRouter::match($app['routes'], $path, $literalOnly) !== null;
        }
        foreach ($app['routes'] ?? [] as $route) {
            $pattern = (string) ($route['pattern'] ?? '');
            if (!str_contains($pattern, ':') && !str_contains($pattern, '*') && AppRouter::match([$route], $path) !== null) {
                return true;
            }
        }

        return false;
    }

    /** Whether `If-None-Match` names this ETag: `*`, a list, weak forms (`W/"…"`) included. */
    private static function matches(string $header, string $etag): bool
    {
        foreach (explode(',', $header) as $tag) {
            $tag = trim($tag);
            if ($tag === '*' || (str_starts_with($tag, 'W/') ? substr($tag, 2) : $tag) === $etag) {
                return true;
            }
        }

        return false;
    }

    /** @param array<string, string> $headers */
    private static function emit(int $status, array $headers, ?string $file): never
    {
        if (function_exists('batcache_cancel')) {
            batcache_cancel();
        }
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        status_header($status);
        foreach ($headers as $name => $value) {
            header("$name: $value");
        }
        if ($file !== null) {
            readfile($file);
        }
        exit;
    }
}
