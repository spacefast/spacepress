<?php

declare(strict_types=1);

namespace First\Wp;

use First\App;

/**
 * `/wp-json/first/v1/*` (§4.8): one catch-all route that hands the request to App::handle(). First's
 * access rules decide; core has already resolved the user (cookie + nonce or application password).
 * The body App produced is served verbatim (problem documents included) instead of being re-encoded
 * through WP_Error/wp_json_encode, so REST and `wp first` answer byte-for-byte the same shapes.
 * WordPress still owns the transport: its CORS headers for the request's origin are sent before the
 * body.
 */
final class Rest
{
    public const NAMESPACE = 'first/v1';

    /** @var \WeakMap<\WP_REST_Response, string|\Closure>|null bodies to serve after the operation commits */
    private static ?\WeakMap $bodies = null;

    public static function register(callable $app): void
    {
        register_rest_route(self::NAMESPACE, '/(?P<path>.*)', [
            'methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
            'permission_callback' => '__return_true',
            'callback' => static fn (\WP_REST_Request $request) => self::dispatch($app(), $request),
            'args' => [],
        ]);
    }

    /** Registered instead of the app route while storage is behind the build: 503, retry shortly. */
    public static function unavailable(string $detail): void
    {
        register_rest_route(self::NAMESPACE, '/(?P<path>.*)', [
            'methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
            'permission_callback' => '__return_true',
            'callback' => static function () use ($detail): \WP_REST_Response {
                $response = new \WP_REST_Response(null, 503, ['Content-Type' => 'application/problem+json', 'Retry-After' => '5']);
                self::$bodies ??= new \WeakMap();
                self::$bodies[$response] = (string) \First\Js::jsonStringify([
                    'type' => 'about:blank', 'title' => 'Service unavailable', 'status' => 503, 'code' => 'unavailable', 'detail' => $detail,
                ]);

                return $response;
            },
            'args' => [],
        ]);
    }

    public static function boot(): void
    {
        // After `rest_send_cors_headers` (priority 10, added during rest_api_init): serve() echoes the
        // body, and a header set after output is lost. Served first, a cross-origin response carried
        // no `Access-Control-Allow-Origin`, `Allow-Credentials` or `Vary: Origin`, so the browser
        // discarded it. first-identity's own CORS callback runs at 20 for its routes only.
        add_filter('rest_pre_serve_request', [self::class, 'serve'], 11, 2);
    }

    public static function dispatch(App $app, \WP_REST_Request $request): \WP_REST_Response
    {
        $query = $request->get_query_params();
        unset($query['rest_route'], $query['_wpnonce'], $query['_envelope'], $query['_method']);
        $headers = [];
        foreach ($request->get_headers() as $name => $values) {
            $headers[str_replace('_', '-', strtolower((string) $name))] = implode(', ', (array) $values);
        }
        $form = str_starts_with($headers['content-type'] ?? '', 'multipart/') ? $request->get_body_params() : [];
        [$status, $out, $body] = $app->handle(
            $request->get_method(),
            '/' . ltrim((string) $request['path'], '/'),
            $query,
            (string) $request->get_body(),
            $headers,
            $request->get_file_params(),
            $form,
        );
        $response = new \WP_REST_Response(null, $status, $out);
        self::$bodies ??= new \WeakMap();
        self::$bodies[$response] = $body;

        return $response;
    }

    /** rest_pre_serve_request: echo First's own body for First responses. */
    public static function serve(mixed $served, mixed $result): mixed
    {
        if ($served || !is_object($result) || !isset(self::$bodies[$result])) {
            return $served;
        }
        $body = self::$bodies[$result];
        unset(self::$bodies[$result]);
        \First\Response::emit($body);

        return true;
    }
}
