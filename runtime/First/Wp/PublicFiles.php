<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * The project's `public/` folder at the site root (spec §1: "static files, served as-is"): a GET or
 * HEAD for `/logo.svg` answers with the app plugin's `public/logo.svg`.
 *
 * A web server that serves the files itself is faster, and a host should map `/` to the plugin's
 * `public/` before PHP where it can. This answers when nothing did, on `do_parse_request`, before
 * WordPress resolves the URL, so the same project serves the same files on `first dev`, a WordPress
 * host and a Space:
 *
 * - only a path to a regular file inside `public/`, resolved without following a link out of it;
 * - never a path WordPress or First owns (`/wp-admin`, `/wp-json`, `/__first/…`), whatever
 *   `public/` holds, and never PHP or a dotfile (except `/.well-known/`);
 * - never a path a `first/app/` page or route serves: the app's code wins over a file;
 * - a `.md` file is served as Markdown, so a project can ship hand-written twins;
 * - `index.html` answers for its folder (`/files/` → `public/files/index.html`), except at the
 *   site root, where WordPress's home page stays (`public/index.html` is `/index.html`).
 *
 * The answer carries the type by extension, a validator, and `public, max-age=300`; a file whose
 * name has a content hash in it can be served longer by the host.
 */
final class PublicFiles
{
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
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mp3' => 'audio/mpeg', 'wav' => 'audio/wav',
    ];

    /** Never served, whatever their place in `public/`: code WordPress would run, and server config. */
    private const REFUSED = ['php', 'phtml', 'phar', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'htaccess', 'htpasswd', 'ini', 'user.ini'];

    public static function register(Plugin $plugin): void
    {
        if (!is_dir($plugin->dir . '/public')) {
            return;
        }
        // After the facade (0) and the app router's handlers (0), before the Markdown twins (1):
        // a file the app ships wins over a twin of the same name, and never over First's own paths.
        add_filter('do_parse_request', static function (bool $parse) use ($plugin): bool {
            if ($parse) {
                self::serve($plugin);
            }

            return $parse;
        }, 0);
    }

    private static function serve(Plugin $plugin): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method !== 'GET' && $method !== 'HEAD') {
            return;
        }
        $file = self::file($plugin->dir . '/public', $plugin->schema->reserved());
        if ($file === null || self::page($plugin)) {
            return;
        }
        $etag = '"' . md5_file($file) . '"';
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $headers = [
            'Content-Type' => self::TYPES[$extension] ?? 'application/octet-stream',
            'Cache-Control' => 'public, max-age=300',
            'ETag' => $etag,
            'X-Content-Type-Options' => 'nosniff',
        ];
        if ($extension === 'svg') {
            // An SVG opened on its own runs no script.
            $headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
        }
        // WordPress slashes $_SERVER (wp_magic_quotes), so an ETag's quotes arrive escaped.
        if (trim(wp_unslash((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''))) === $etag) {
            self::emit(304, $headers, null);
        }
        $headers['Content-Length'] = (string) filesize($file);
        self::emit(200, $headers, $method === 'HEAD' ? null : $file);
    }

    /** Whether a `first/app/` page or route serves the request's path: the app's code wins over a file. */
    private static function page(Plugin $plugin): bool
    {
        $app = $plugin->schema->app();
        if (!is_array($app)) {
            return false;
        }
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '' && str_starts_with($path, $base)) {
            $path = substr($path, strlen($base)) ?: '/';
        }
        $match = AppRouter::match($app['routes'] ?? [], $path);
        // A catch-all at the root (`[...path]`) would take every path; it serves only what it
        // matches by a literal segment or a kind item, so a file still answers beside it.
        return $match !== null && !self::catchAllOnly($match['route']);
    }

    /** @param array<string, mixed> $route a route that is a catch-all and nothing more (`/*rest`, `/**rest`) */
    private static function catchAllOnly(array $route): bool
    {
        $parts = explode('/', trim((string) ($route['pattern'] ?? ''), '/'));
        return count($parts) === 1 && str_starts_with($parts[0], '*');
    }

    /**
     * The file in `$root` the request's path names, or null. The path is decoded once; a segment
     * that is empty, `.`, `..`, a dotfile or has a NUL is refused, and the result must resolve
     * (links followed) to a regular file under the resolved root.
     *
     * @param list<string> $reserved first path segments WordPress or First owns
     */
    public static function file(string $root, array $reserved): ?string
    {
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '') {
            if ($path !== $base && !str_starts_with($path, $base . '/')) {
                return null;
            }
            $path = substr($path, strlen($base)) ?: '/';
        }
        $index = str_ends_with($path, '/');
        $segments = [];
        foreach (explode('/', trim($path, '/')) as $raw) {
            if ($raw === '') {
                continue;
            }
            if (preg_match('/%(?![0-9A-Fa-f]{2})/', $raw) === 1) {
                return null;
            }
            $segment = rawurldecode($raw);
            // A dotfile or dot-folder stays private (`.env`, `.git`), except `/.well-known/` (RFC 8615).
            $dot = str_starts_with($segment, '.') && !($segments === [] && $segment === '.well-known');
            if ($segment === '.' || $segment === '..' || $dot || str_contains($segment, "\0") || str_contains($segment, '/') || str_contains($segment, '\\')) {
                return null;
            }
            $segments[] = $segment;
        }
        // The home page is WordPress's (its theme, or the app's `page.tsx`), never a file: a
        // `public/index.html` answers at `/index.html`.
        if ($segments === []) {
            return null;
        }
        $first = strtolower($segments[0] ?? '');
        if ($first !== '' && $first !== '.well-known' && (in_array($first, $reserved, true) || str_starts_with($first, 'wp-'))) {
            return null;
        }
        if ($index) {
            $segments[] = 'index.html';
        }
        $name = strtolower((string) end($segments));
        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (in_array($extension, self::REFUSED, true) || in_array($name, self::REFUSED, true)) {
            return null;
        }
        $real = realpath($root . '/' . implode('/', $segments));
        $top = realpath($root);
        if ($real === false || $top === false || !str_starts_with($real, $top . DIRECTORY_SEPARATOR) || !is_file($real)) {
            return null;
        }

        return $real;
    }

    /** @param array<string, string> $headers */
    private static function emit(int $status, array $headers, ?string $file): never
    {
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
