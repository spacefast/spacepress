<?php

declare(strict_types=1);

namespace Zero\Wp\Media;

use Zero\Access;
use Zero\App;
use Zero\HttpError;
use Zero\Viewer;
use Zero\Wp\CoreAccess;
use Zero\Wp\Plugin;
use Zero\Wp\Runtime;
use Zero\Wp\WpAuth;
use Zero\Wp\WpMedia;

/** Additional Zero authority around core's media controller, after WP's own permission checks. */
final class Rest
{
    public static function boot(): void
    {
        add_filter('rest_dispatch_request', [self::class, 'dispatch'], 10, 4);
    }

    public static function dispatch(mixed $result, \WP_REST_Request $request, string $route, array $handler): mixed
    {
        $method = $request->get_method();
        if ($result !== null || in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)
            || !preg_match('#^/wp/v2/media(?:/(\d+))?(?:/(edit|post-process|sideload|finalize))?/?$#i', $request->get_route(), $match)) {
            return $result;
        }
        $plugin = Runtime::plugin();
        if ($plugin === null) {
            return $result;
        }
        try {
            if ($plugin->unavailable() !== null) {
                throw new HttpError(503, 'unavailable', Plugin::UNAVAILABLE);
            }
            $viewer = new Viewer(WpAuth::current());
            $id = isset($match[1]) ? (int) $match[1] : null;
            $endpoint = strtolower($match[2] ?? '');
            $operation = match (true) {
                $method === 'DELETE' => 'delete',
                $id === null, in_array($endpoint, ['post-process', 'sideload', 'finalize'], true) => 'create',
                $request->has_param('alt_text'), $endpoint === 'edit' => 'update',
                default => null, // Caption/title and other core fields retain WP's permissions.
            };
            if ($operation !== null) {
                Access::require(Access::MEDIA[$operation], $viewer, $operation, null, "$operation media");
            }
            $db = $plugin->db();
            $previous = $db->actor();
            $db->setActor($viewer->user);
            try {
                return $db->transaction(static function () use ($plugin, $db, $viewer, $id, $endpoint, $method, $request, $handler) {
                    // Keep core's file validation (multipart AND raw uploads), metadata, additional
                    // REST fields, plugin hooks, response links and status; never reconstruct them.
                    $run = static fn () => self::native($plugin, $handler, $request, $id === null, $endpoint === 'sideload');
                    if ($id !== null) {
                        $plugin->connection()->touchPost($id);
                    }
                    if ($method === 'DELETE' && $id !== null) {
                        // Shared authorization + reference writes (including hooks/revisions) finish
                        // before core removes the attachment. A native failure rolls those back.
                        $response = null;
                        $db->mediaDelete($id, $viewer, static function () use ($run, &$response): void {
                            $response = $run();
                        }) ?? throw HttpError::notFound("No media with id $id");

                        return $response;
                    }

                    return $run();
                });
            } finally {
                $db->setActor($previous);
            }
        } catch (Refused $e) {
            return $e->error;
        } catch (\Throwable $e) {
            $problem = App::problem($e);

            return CoreAccess::error(new HttpError($problem['status'], $problem['code'], $problem['detail'], $problem['pointer'] ?? null));
        }
    }

    /** Keep native local-file effects within the same commit/rollback boundary as Zero's writes. */
    private static function native(Plugin $plugin, array $handler, \WP_REST_Request $request, bool $upload, bool $sideload): mixed
    {
        $connection = $plugin->connection();
        $moved = static function (array $file) use ($connection): array {
            if (isset($file['file'])) {
                $path = $file['file'];
                $connection->onRollback(static fn () => @unlink($path));
            }

            return $file;
        };
        $inserted = static fn (int $id) => $connection->touchPost($id);
        $metadata = static function (array $meta, int $id) use ($connection): array {
            $file = (string) get_attached_file($id);
            $paths = [$file];
            foreach ($meta['sizes'] ?? [] as $size) {
                $paths[] = dirname($file) . '/' . $size['file'];
            }
            if (isset($meta['original_image'])) {
                $paths[] = dirname($file) . '/' . $meta['original_image'];
            }
            foreach ($paths as $path) {
                $connection->onRollback(static fn () => @unlink($path));
            }

            return $meta;
        };
        // Previous filters retain ownership (for example an offload plugin may return an empty
        // path). Defer only the local unlink core itself would have performed, without filtering twice.
        $delete = static function (string $path) use ($connection): string {
            if ($path !== '') {
                $connection->afterCommit(static fn () => @unlink($path));
            }

            return '';
        };
        if ($upload || $sideload) {
            add_filter('wp_handle_upload', $moved, PHP_INT_MAX);
        }
        if ($upload) {
            add_action('add_attachment', $inserted);
            add_filter('wp_generate_attachment_metadata', $metadata, PHP_INT_MAX, 2);
            // Core saves sub-size metadata incrementally, before the final generation filter.
            add_filter('wp_update_attachment_metadata', $metadata, PHP_INT_MAX, 2);
        }
        if ($request->get_method() === 'DELETE') {
            add_filter('wp_delete_file', $delete, PHP_INT_MAX);
        }
        try {
            $response = call_user_func($handler['callback'], $request);
            if (is_wp_error($response)) {
                throw new Refused($response);
            }
            WpMedia::requireRendered();

            return $response;
        } finally {
            remove_filter('wp_handle_upload', $moved, PHP_INT_MAX);
            remove_action('add_attachment', $inserted);
            remove_filter('wp_generate_attachment_metadata', $metadata, PHP_INT_MAX);
            remove_filter('wp_update_attachment_metadata', $metadata, PHP_INT_MAX);
            remove_filter('wp_delete_file', $delete, PHP_INT_MAX);
        }
    }
}

/** Preserve core's original error object while using a throwable to roll back the operation. */
final class Refused extends \RuntimeException
{
    public function __construct(public readonly \WP_Error $error)
    {
        parent::__construct($error->get_error_message());
    }
}
