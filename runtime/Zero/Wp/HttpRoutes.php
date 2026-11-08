<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * `routes` from zero.config.ts on the site's own URLs (`GET /api/feed.json`, `POST /webhooks/stripe`),
 * outside `/wp-json`. Matched on `do_parse_request` before WordPress resolves a query, served from
 * the compiled handler in one transaction, and exited: no theme, no template, no rewrite rules.
 *
 * Who calls, as WordPress REST decides it (suspension refused like every other channel):
 * - a zero-identity Bearer token authenticates every method;
 * - a cookie session authenticates GET and HEAD, and an unsafe method only with the REST nonce in
 *   `X-WP-Nonce`, so a cross-site form cannot act as a signed-in visitor;
 * - an application password is never a route credential, on any method.
 * Anything else runs anonymously. A `signature` route ignores the session entirely.
 */
final class HttpRoutes
{
    public static function register(Plugin $plugin): void
    {
        if ($plugin->schema->routes() === []) {
            return;
        }
        add_filter('do_parse_request', static function (bool $parse) use ($plugin): bool {
            if ($parse) {
                self::serve($plugin);
            }

            return $parse;
        }, 0);
    }

    private static function serve(Plugin $plugin): void
    {
        $path = self::path();
        if ($path === null) {
            return;
        }
        // While storage is behind, a path a route claims answers 503 like /wp-json/zero/v1, so a
        // webhook sender retries instead of taking WordPress's 404 as a missing endpoint.
        if ($plugin->unavailable() !== null) {
            if (\Zero\App::routePathFor($plugin->schema, $path)) {
                self::emit(503, ['Content-Type' => 'application/problem+json', 'Retry-After' => '5'], (string) \Zero\Js::jsonStringify([
                    'type' => 'about:blank', 'title' => 'Service unavailable', 'status' => 503, 'code' => 'unavailable', 'detail' => Plugin::UNAVAILABLE,
                ]));
            }
            return;
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
            $user = self::caller($method, $headers);
        } catch (\Zero\HttpError $error) {
            $problem = \Zero\App::problem($error);
            self::emit($problem['status'], ['Content-Type' => 'application/problem+json'], (string) \Zero\Js::jsonStringify($problem));
        }
        // The raw query, not $_GET: PHP's parse_str renames `a.b` to `a_b`, drops `x[]` into arrays
        // and keeps the last of a repeated name.
        $query = self::query((string) ($_SERVER['QUERY_STRING'] ?? (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_QUERY) ?? '')));
        $url = self::url((string) ($_SERVER['HTTP_HOST'] ?? (wp_parse_url(home_url('/'), PHP_URL_HOST) ?? '')), (string) ($_SERVER['REQUEST_URI'] ?? '/'));
        [$status, $out, $body] = $app->serveRoute($match, $method, $path, $query, (string) file_get_contents('php://input'), $headers, $user, $url);
        self::emit($status, $out, $body);
    }

    /**
     * The route caller per the class comment. WpAuth::current() still runs first, so a failed
     * Bearer or a suspended account answers its problem rather than running anonymously.
     *
     * @param array<string, string> $headers
     */
    private static function caller(string $method, array $headers): ?array
    {
        $user = WpAuth::current();
        if ($user === null) {
            return null;
        }
        if (IdentityBridge::available() && \Zero\Identity\Bearer::token() !== null) {
            return $user;
        }
        // Core records an application password it accepted here; such a caller is refused below.
        $application = $GLOBALS['wp_rest_application_password_status'] ?? null;
        if ($application instanceof \WP_User) {
            return null;
        }
        // The remaining channel is the cookie: unsafe methods need the REST nonce.
        if (!in_array($method, ['GET', 'HEAD'], true)
            && wp_verify_nonce((string) ($headers['x-wp-nonce'] ?? ''), 'wp_rest') === false) {
            return null;
        }

        return $user;
    }

    /** The request path below the site's home path, or null when the request is outside it. */
    private static function path(): ?string
    {
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '') {
            if ($path !== $base && !str_starts_with($path, $base . '/')) {
                return null;
            }
            $path = substr($path, strlen($base)) ?: '/';
        }

        return $path;
    }

    /** The query parameter that carries a Spacefast share-link secret. */
    private const ACCESS_PARAM = '__';

    /**
     * `req.url`: `https://`, the hostname from `Host` (port and
     * trailing dots dropped, lowercase), then the request URI with share-link secrets redacted, so a
     * handler that echoes its own URL never echoes a share token: the `token=`, `purchaseToken=` and
     * `__=` query values and the `/__/<token>` path segment (the `/__/collab` shell is not a secret).
     */
    public static function url(string $host, string $uri): string
    {
        $host = trim($host, " \t\n\f\r");
        // Only a bracketed IPv6 literal may give up a trailing `:digits`; `::1` has no port.
        if (preg_match('/\A(.*):\d+\z/s', $host, $match) === 1 && (!str_contains($match[1], ':') || str_ends_with($match[1], ']'))) {
            $host = $match[1];
        }
        $host = strtolower(rtrim(trim($host, " \t\n\f\r"), '.'));
        $uri = str_starts_with($uri, '/') ? $uri : '/' . $uri;
        $uri = (string) preg_replace('~([?&](?:purchaseToken|token)=)[^&#]*~', '$1[redacted]', $uri);
        $uri = (string) preg_replace('~(^|[?&])' . self::ACCESS_PARAM . '=[^&#]*~', '$1' . self::ACCESS_PARAM . '=[redacted]', $uri);
        $uri = (string) preg_replace('~^/__/(?!collab([/?#]|$))[^/?#]+~', '/__/[redacted]', $uri);

        return 'https://' . $host . $uri;
    }

    /** `req.query` without the share-link secret, so it is not a second way to read the token. */
    public static function query(string $query): string
    {
        if ($query === '' || !str_contains($query, self::ACCESS_PARAM)) {
            return $query;
        }
        $kept = array_filter(explode('&', $query), static function (string $part): bool {
            $name = explode('=', $part, 2)[0];

            return rawurldecode(str_replace('+', ' ', $name)) !== self::ACCESS_PARAM;
        });

        return implode('&', $kept);
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
