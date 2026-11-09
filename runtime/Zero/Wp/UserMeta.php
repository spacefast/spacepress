<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\HttpError;
use Zero\Js;
use Zero\Viewer;
use Zero\Wp\Abilities\JsonSchema;

/**
 * Core `/wp/v2/users` for the users kind (spec §2.2, §3a): every member field is registered user meta
 * (`show_in_rest` under its own name, with its JSON Schema), read and written as Zero does.
 *
 * - Reads: `meta` holds the member row as Zero's read pipeline gives it to this viewer, so the read
 *   rule and field masks decide; a member the viewer can't read shows no member fields.
 * - Writes: member fields in `meta` are taken out of core's generic meta path and applied with
 *   `Db::update` as the viewer, in one transaction with core's own user save: the update rule, field
 *   rules, validation and hooks run, and a refusal rolls the whole request back.
 * - Lists: `where` and `orderBy` run through Zero as the viewer and narrow core's `include`.
 */
final class UserMeta
{
    private const CORE = ['email', 'name', 'role'];
    private const ROUTE = '#^/wp/v2/users(?:/(me|\d+))?$#i';

    /** @var ?array{request: \WP_REST_Request, fields: array<string, mixed>, error: ?HttpError, began: bool} */
    private static ?array $open = null;

    public static function register(): void
    {
        add_action('init', [self::class, 'registerMeta']);
        add_filter('rest_prepare_user', [self::class, 'prepare'], 20, 3);
        add_filter('rest_user_query', [self::class, 'query'], 20, 2);
        add_filter('rest_request_before_callbacks', [self::class, 'before'], 20, 3);
        add_filter('rest_dispatch_request', [self::class, 'dispatch'], 20, 4);
        add_action('rest_after_insert_user', [self::class, 'inserted'], 10, 3);
    }

    public static function registerMeta(): void
    {
        foreach (self::fields() as $col => $def) {
            $schema = ['default' => null] + JsonSchema::column($def, true);
            $types = array_values(array_diff((array) $schema['type'], ['null']));
            register_meta('user', WpUserStore::META . $col, [
                'single' => true,
                'type' => count($types) === 1 ? $types[0] : 'object',
                'show_in_rest' => ['name' => $col, 'schema' => $schema, 'prepare_callback' => static fn () => null],
                // Never written through core's generic meta path (before() takes these out).
                'auth_callback' => '__return_false',
            ]);
        }
    }

    /** @return array<string, array> member fields kept in usermeta, by name */
    public static function fields(): array
    {
        $collection = self::collection();
        if ($collection === null) {
            return [];
        }
        $spec = self::plugin()->schema->collection($collection);

        return array_filter($spec['columns'], static fn (array $def, $col) => $col !== $spec['primaryKey']
            && !in_array($col, self::CORE, true) && !($def['system'] ?? false), ARRAY_FILTER_USE_BOTH);
    }

    // ================================================================ reads

    public static function prepare(mixed $response, mixed $user, mixed $request): mixed
    {
        $collection = self::collection();
        if ($collection === null || !$response instanceof \WP_REST_Response || !$user instanceof \WP_User
            || !is_array($data = $response->get_data()) || !is_array($data['meta'] ?? null)) {
            return $response;
        }
        $fields = self::fields();
        $viewer = CoreAccess::viewer();
        $row = null;
        if ($viewer !== null) {
            try {
                $row = self::plugin()->db()->findFirst($collection, ['where' => ['id' => (int) $user->ID]], $viewer);
            } catch (HttpError) {
                $row = null; // the read rule denies this viewer: no member fields
            }
        }
        $data['meta'] = array_diff_key($data['meta'], $fields);
        if ($row !== null) {
            $data['meta'] = PostMeta::values($collection, $row, array_keys(array_intersect_key($fields, $row))) + $data['meta'];
        }
        $response->set_data($data);

        return $response;
    }

    /** @var array{\WP_REST_Request, list<int>, bool}|null the ids Zero selected for a users list */
    private static ?array $selected = null;

    /** `where`/`orderBy` on the users list: Zero selects the ids, core keeps its pagination. */
    public static function query(mixed $args, mixed $request): mixed
    {
        if (!is_array($args) || self::$selected === null || self::$selected[0] !== $request) {
            return $args;
        }
        [, $keys, $ordered] = self::$selected;
        $include = empty($args['include']) ? $keys : array_values(array_intersect($keys, array_map('intval', (array) $args['include'])));

        return ['include' => $include === [] ? [0] : $include] + ($ordered ? ['orderby' => 'include'] : []) + $args;
    }

    /** A users list with `where`/`orderBy`: run it through Zero as the viewer before core's query. */
    private static function select(\WP_REST_Request $request): ?\WP_Error
    {
        $collection = self::collection() ?? throw new \LogicException('No users kind');
        try {
            $keys = ZeroQuery::keys($collection, $request, CoreAccess::viewer() ?? new Viewer(null), search: false);
        } catch (HttpError $e) {
            return CoreAccess::error($e);
        }
        self::$selected = $keys === null ? null : [$request, $keys, $request['orderBy'] !== null];

        return null;
    }

    // ================================================================ writes

    /** A users list with `where`/`orderBy`: Zero selects the ids before core's query. */
    public static function before(mixed $response, mixed $handler, mixed $request): mixed
    {
        if ($response === null && $request instanceof \WP_REST_Request && $request->get_method() === 'GET'
            && strtolower($request->get_route()) === '/wp/v2/users' && self::collection() !== null) {
            return self::select($request);
        }

        return $response;
    }

    /**
     * rest_dispatch_request: a user create or update that carries member fields runs core's callback
     * inside Zero's transaction. Here, after core's permission check, nothing is open until the save
     * starts, and the callback runs under try/catch so a throw (core, another plugin's hook) can't
     * leave the transaction or this save open.
     */
    public static function dispatch(mixed $result, mixed $request, mixed $route, mixed $handler): mixed
    {
        if ($result !== null || !$request instanceof \WP_REST_Request || self::$open !== null || !is_array($handler)
            || !in_array($request->get_method(), ['POST', 'PUT', 'PATCH'], true)
            || !preg_match(self::ROUTE, $request->get_route(), $m) || self::collection() === null) {
            return $result;
        }
        $meta = PostMeta::input($request);
        $fields = is_array($meta) ? array_intersect_key($meta, self::fields()) : [];
        if ($fields === []) {
            return $result;
        }
        $request->set_param('meta', array_diff_key((array) $request->get_param('meta'), $fields));
        $connection = self::plugin()->connection();
        $began = !$connection->inTransaction();
        if ($began) {
            $connection->begin();
        }
        self::$open = ['request' => $request, 'fields' => $fields, 'error' => null, 'began' => $began];
        try {
            $id = isset($m[1]) ? (strtolower($m[1]) === 'me' ? get_current_user_id() : (int) $m[1]) : 0;
            if ($id > 0) {
                // An update: Zero decides before core writes anything.
                self::apply($id);
                if (self::$open['error'] !== null) {
                    return self::finish(null);
                }
            }
            $response = call_user_func($handler['callback'], $request);
        } catch (\Throwable $e) {
            self::$open = null;
            if ($began) {
                $connection->rollback();
            }
            throw $e; // inside an enclosing transaction, the throw is what rolls it back
        }

        return self::finish($response);
    }

    /** rest_after_insert_user: a create's member fields, once the user exists. */
    public static function inserted(mixed $user, mixed $request, mixed $creating): void
    {
        if ($creating && $user instanceof \WP_User && self::$open !== null && self::$open['request'] === $request) {
            self::apply((int) $user->ID);
        }
    }

    private static function apply(int $id): void
    {
        $collection = self::collection() ?? throw new \LogicException('No users kind');
        try {
            $viewer = CoreAccess::viewer() ?? throw new HttpError(403, 'suspended', 'This account is suspended');
            $db = self::plugin()->db();
            $updated = $db->update($collection, self::$open['fields'], ['id' => $id], true, $viewer);
            if ($updated === []) {
                // The update rule doesn't cover this member: the facade's answer to the same write.
                throw HttpError::notFound("No $collection row with id $id");
            }
        } catch (HttpError | \Zero\JsError $e) {
            $problem = \Zero\App::problem($e);
            self::$open['error'] = new HttpError($problem['status'], $problem['code'], $problem['detail'], $problem['pointer'] ?? null);
        }
    }

    private static function finish(mixed $response): mixed
    {
        ['error' => $error, 'began' => $began] = self::$open;
        self::$open = null;
        $failed = $error !== null || is_wp_error($response)
            || ($response instanceof \WP_REST_Response && $response->get_status() >= 400);
        $connection = self::plugin()->connection();
        if ($failed) {
            if ($began) {
                $connection->rollback();
            } else {
                // Core or a plugin may fail after the user or member fields were written: the enclosing
                // transaction is the only rollback point, so its work is abandoned, not half-committed.
                throw $error ?? self::failure($response);
            }
        } elseif ($began) {
            $connection->commit();
        }

        return $error === null ? $response : CoreAccess::error($error);
    }

    /** A failed core response as Zero's error, to abort the enclosing transaction with. */
    private static function failure(mixed $response): HttpError
    {
        $error = $response instanceof \WP_Error ? $response : ($response instanceof \WP_REST_Response ? $response->as_error() : null);
        $data = $error?->get_error_data();
        $status = is_array($data) && is_int($data['status'] ?? null) ? $data['status'] : ($response instanceof \WP_REST_Response ? $response->get_status() : 500);

        return new HttpError($status, (string) ($error?->get_error_code() ?: 'rest_error'), (string) ($error?->get_error_message() ?: 'The user save failed'));
    }

    private static function collection(): ?string
    {
        return Plugin::instance()?->schema->auth()['collection'] ?? null;
    }

    private static function plugin(): Plugin
    {
        return Plugin::instance() ?? throw new \LogicException('No Zero app');
    }
}
