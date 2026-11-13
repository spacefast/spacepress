<?php

declare(strict_types=1);

namespace First;

/**
 * `GET /__first/api/v1/openapi.json`: the app's API as an OpenAPI 3.1 document. `first build` writes
 * the document from the app's schema (the same data as schema.php and the typed client) into the
 * app plugin; this serves that file, with the site's own address as its server. It says nothing a
 * caller can't already read at `GET /__first/api/v1`, so it is public and the same for everyone.
 */
final class OpenApi
{
    /** The document's path segment below the API prefix. */
    public const ROUTE = 'openapi.json';

    public static function register(): void
    {
        if (Extensions::routeHandler(self::ROUTE) === null) {
            Extensions::route(self::ROUTE, self::route(...));
        }
    }

    public static function route(string $method, array $segments): Response
    {
        if (count($segments) !== 1) {
            throw HttpError::notFound('No such route');
        }
        App::allow($method, ['GET', 'HEAD']);
        $document = self::document() ?? throw HttpError::notFound('This build has no OpenAPI document; build the app again with this First version');

        return Response::raw((string) json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    /** The built document with this site as its server, or null when the build carries none. */
    public static function document(): ?\stdClass
    {
        $plugin = Wp\Plugin::instance();
        $file = $plugin === null ? null : $plugin->dir . '/first/app/openapi.json';
        if ($file === null || !is_file($file)) {
            return null;
        }
        // Decoded to objects, so an empty schema `{}` stays an object when it is encoded again.
        $document = json_decode((string) file_get_contents($file), false);
        if (!$document instanceof \stdClass) {
            return null;
        }
        $document->servers = [['url' => Wp\Facade::url(), 'description' => (string) get_bloginfo('name')]];

        return $document;
    }
}
