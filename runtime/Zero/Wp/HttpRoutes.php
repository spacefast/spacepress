<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * `routes` from zero.config.ts on the site's own URLs (`GET /api/feed.json`, `POST /webhooks/stripe`),
 * outside `/wp-json`. Matched on `do_parse_request` before WordPress resolves a query, served from
 * the compiled handler in one transaction, and exited: no theme, no template, no rewrite rules.
 *
 * Who calls: the WordPress user of the request (cookie session, suspension refused like every other
 * channel). A cookie only authenticates GET and HEAD; an unsafe method needs the REST nonce in
 * `X-WP-Nonce`, otherwise the request runs anonymously, so a cross-site form cannot act as a
 * signed-in visitor. A `signature` route ignores the session entirely.
 */
final class HttpRoutes
{
    public static function register(Plugin $plugin): void
    {
        if ($plugin->schema->routes() === []) {
            return;
        }
        add_filter('do_parse_request', static function (bool $parse) use ($plugin): bool {
            if (!$parse || $plugin->unavailable() !== null) {
                return $parse;
            }
            self::serve($plugin);

            return $parse;
        }, 0);
    }

    private static function serve(Plugin $plugin): void
    {
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = (string) (parse_url($uri, PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '') {
            if ($path !== $base && !str_starts_with($path, $base . '/')) {
                return;
            }
            $path = substr($path, strlen($base)) ?: '/';
        }
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $app = $plugin->app();
        $match = $app->matchRoute($method, $path);
        if ($match === null) {
            if ($app->routePathKnown($path)) {
                self::emit(405, ['Content-Type' => 'application/problem+json'], (string) \Zero\Js::jsonStringify([
                    'type' => 'about:blank', 'title' => 'Method not allowed', 'status' => 405, 'code' => 'method_not_allowed',
                    'detail' => "$method is not allowed on $path",
                ]));
            }
            return;
        }
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && str_starts_with((string) $key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr((string) $key, 5)))] = $value;
            }
        }
        foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $key => $name) {
            if (isset($_SERVER[$key]) && is_string($_SERVER[$key])) {
                $headers[$name] = $_SERVER[$key];
            }
        }
        try {
            $user = WpAuth::current();
            if ($user !== null && !in_array($method, ['GET', 'HEAD'], true)
                && wp_verify_nonce((string) ($headers['x-wp-nonce'] ?? ''), 'wp_rest') === false) {
                $user = null;
            }
        } catch (\Zero\HttpError $error) {
            $problem = \Zero\App::problem($error);
            self::emit($problem['status'], ['Content-Type' => 'application/problem+json'], (string) \Zero\Js::jsonStringify($problem));
        }
        // The raw query, not $_GET: PHP's parse_str renames `a.b` to `a_b`, drops `x[]` into arrays
        // and keeps the last of a repeated name.
        $query = (string) ($_SERVER['QUERY_STRING'] ?? (parse_url($uri, PHP_URL_QUERY) ?? ''));
        [$status, $out, $body] = $app->serveRoute($match, $method, $path, $query, (string) file_get_contents('php://input'), $headers, $user);
        self::emit($status, $out, $body);
    }

    /** @param array<string, string> $headers */
    private static function emit(int $status, array $headers, string $body): never
    {
        status_header($status);
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value, true);
        }
        echo $body;
        exit;
    }
}
