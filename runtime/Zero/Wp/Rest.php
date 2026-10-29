<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\App;

/**
 * `/wp-json/zero/v1/*` (§4.8): one catch-all route that hands the request to App::handle(). Zero's
 * access rules decide; core has already resolved the user (cookie + nonce or application password).
 * The body App produced is served verbatim (problem documents included) instead of being re-encoded
 * through WP_Error/wp_json_encode, so both targets answer byte-for-byte the same shapes.
 */
final class Rest
{
    public const NAMESPACE = 'zero/v1';

    /** @var array<int, string|\Closure> response object id → body to serve after the operation commits */
    private static array $bodies = [];

    public static function register(callable $app): void
    {
        register_rest_route(self::NAMESPACE, '/(?P<path>.*)', [
            'methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
            'permission_callback' => '__return_true',
            'callback' => static fn (\WP_REST_Request $request) => self::dispatch($app(), $request),
            'args' => [],
        ]);
    }

    public static function boot(): void
    {
        add_filter('rest_pre_serve_request', [self::class, 'serve'], 10, 2);
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
        self::$bodies[spl_object_id($response)] = $body;

        return $response;
    }

    /** rest_pre_serve_request: echo Zero's own body for Zero responses. */
    public static function serve(mixed $served, mixed $result): mixed
    {
        if ($served || !is_object($result) || !isset(self::$bodies[spl_object_id($result)])) {
            return $served;
        }
        $body = self::$bodies[spl_object_id($result)];
        unset(self::$bodies[spl_object_id($result)]);
        \Zero\Response::emit($body);

        return true;
    }
}
