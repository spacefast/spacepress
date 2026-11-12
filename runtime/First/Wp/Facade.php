<?php

declare(strict_types=1);

namespace First\Wp;

use First\HttpError;
use First\Js;

/**
 * `/__first/api/v1` (spec §3a): one clean HTTP shape over core's routes. Every request is dispatched
 * to the core route with `rest_do_request()` as the caller, and only input and output are mapped, so
 * there is no second permission check, query path or write path to disagree with core:
 *
 *   GET    /__first/api/v1/<kind>          → GET  /wp/v2/<base>        { data: rows, cursor }
 *   GET    /__first/api/v1/<kind>/<id>     → GET  /wp/v2/<base>/<id>   { data: row } (`?format=md`: markdown)
 *   POST   /__first/api/v1/<kind>          → POST /wp/v2/<base>        First input → core input
 *   PATCH  /__first/api/v1/<kind>/<id>     → POST /wp/v2/<base>/<id>
 *   DELETE /__first/api/v1/<kind>/<id>     → DELETE /wp/v2/<base>/<id> (post kinds: force)
 *   GET    /__first/api/v1/me              → GET  /wp/v2/users/me
 *   POST   /__first/api/v1/actions/<name>  → /wp-abilities/v1/abilities/<app>/<name>/run (GET if readonly)
 *   GET    /__first/api/v1                 → the app's schema: kinds, fields, actions (`first pull`)
 *
 * Errors are RFC 9457 problem documents mapped from core's `WP_Error`. Callers authenticate as core
 * accepts: the cookie with `X-WP-Nonce`, an application password, or a First Identity bearer token.
 * It sits outside `/wp-json` (like `/__spacefast/`), served on `do_parse_request` before the theme.
 * 0.8's `/__zero/config`, `/__zero/run`, `/__zero/auth/*` and `/__zero/realtime/events` are not
 * this facade's and are never answered here.
 */
final class Facade
{
    public const PREFIX = '/__first/api/v1';

    /** The absolute URL of a facade path (`/media/42`), below the site's home URL. */
    public static function url(string $path = ''): string
    {
        return home_url(self::PREFIX . $path);
    }

    /**
     * First's row of a post kind as $viewer reads it (field masks, system fields), or null when the
     * read rule doesn't cover it. Core has already decided the item is readable; this only gives the
     * facade First's own shape of it (PostsController puts it on the facade's dispatches).
     */
    public static function firstRow(string $collection, int $id, \First\Viewer $viewer): ?object
    {
        $db = Plugin::instance()?->db() ?? throw new \LogicException('No First app');
        $pk = $db->schema()->collection($collection)['primaryKey'];
        $all = \First\Locale\Module::localized($collection) ? ['locale' => '*'] : [];
        try {
            $row = $db->findFirst($collection, ['where' => [$pk => $id]] + $all, $viewer);
        } catch (HttpError) {
            return null;
        }

        return $row === null ? null : (object) PostMeta::values($collection, $row, array_map('strval', array_keys($row)));
    }

    private const LIMIT = 50;
    private const MAX_LIMIT = 100;

    public static function register(Plugin $plugin): void
    {
        add_filter('do_parse_request', static function (bool $parse) use ($plugin): bool {
            if ($parse) {
                self::serve($plugin);
            }

            return $parse;
        }, 0);
        // Core accepts application passwords on REST requests only; the facade is one.
        add_filter('application_password_is_api_request', static fn (bool $api): bool => $api || self::path() !== null);
    }

    private static function serve(Plugin $plugin): void
    {
        $path = self::path();
        if ($path === null) {
            return;
        }
        if (!defined('REST_REQUEST')) {
            define('REST_REQUEST', true); // core's REST behaviour (auth, caching headers) for the dispatches
        }
        try {
            if ($plugin->unavailable() !== null) {
                throw new HttpError(503, 'unavailable', Plugin::UNAVAILABLE);
            }
            $auth = self::authenticate();
            if ($auth instanceof \WP_Error) {
                self::problem($auth);
            }
            $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
            $query = self::query();
            [$status, $headers, $body] = self::route($plugin, $method, $path, $query, (string) file_get_contents('php://input'));
            self::emit($status, $headers, $body);
        } catch (HttpError | \First\JsError $e) {
            $problem = \First\App::problem($e);
            self::emit($problem['status'], ['Content-Type' => 'application/problem+json'] + self::PRIVATE, (string) Js::jsonStringify($problem));
        }
    }

    /**
     * @param array<string, mixed> $query
     * @return array{int, array<string, string>, string}
     */
    public static function route(Plugin $plugin, string $method, string $path, array $query, string $body): array
    {
        $segments = array_map('rawurldecode', array_values(array_filter(explode('/', $path), static fn ($s) => $s !== '')));
        $kinds = Kinds::all($plugin);
        $name = $segments[0] ?? null;

        if ($name === null) {
            \First\App::allow($method, ['GET', 'HEAD']);

            return self::json(200, ['data' => Kinds::describe($plugin)]);
        }
        if ($name === 'me' && count($segments) === 1) {
            \First\App::allow($method, ['GET', 'HEAD']);
            if (get_current_user_id() === 0) {
                return self::json(200, ['data' => null]);
            }
            $users = $kinds['users'] ?? null;
            $response = self::dispatch('GET', '/wp/v2/users/me', ['context' => 'edit']);

            return self::json(200, ['data' => $users === null ? $response : Kinds::row($users, $response)]);
        }
        if ($name === 'actions' && count($segments) === 2) {
            return self::action($plugin, $method, $segments[1], $query, $body);
        }
        if ($name === 'settings' && count($segments) === 1 && !isset($kinds['settings'])) {
            return self::settings($method, $body);
        }
        $kind = $kinds[$name] ?? throw HttpError::notFound("Unknown kind '$name'");
        if ($kind['type'] === 'menus') {
            return self::menus($method, $segments);
        }
        $base = $kind['route'];
        if (count($segments) === 1) {
            \First\App::allow($method, ['GET', 'HEAD', 'POST']);
            if ($method === 'POST') {
                $row = self::dispatch('POST', $base, self::context($kind), Kinds::input($kind, self::body($body), create: true), 201);

                return self::json(201, ['data' => Kinds::row($kind, $row)]);
            }

            return self::list($kind, $query);
        }
        if (count($segments) !== 2) {
            throw HttpError::notFound("No route for $path");
        }
        $id = self::id($kind, $segments[1]);
        \First\App::allow($method, ['GET', 'HEAD', 'PATCH', 'DELETE']);
        $item = "$base/" . rawurlencode((string) $id);
        if ($method === 'PATCH') {
            $row = self::dispatch('POST', $item, self::context($kind), Kinds::input($kind, self::body($body)));

            return self::json(200, ['data' => Kinds::row($kind, $row)]);
        }
        if ($method === 'DELETE') {
            // First's delete is permanent: core trashes posts without `force`, and refuses users without it.
            $out = self::dispatch('DELETE', $item, match ($kind['type']) {
                'post', 'wp-post', 'comments', 'media', 'term' => ['force' => true],
                'users' => ['force' => true, 'reassign' => false], // the member's posts are kept, unowned
                default => [],
            });

            return self::json(200, ['data' => Kinds::row($kind, $out['previous'] ?? $out)]);
        }
        $row = self::dispatch('GET', $item, self::context($kind) + array_intersect_key($query, Kinds::first($kind) ? ['with' => true, 'locale' => true] : ['password' => true]));
        if (Kinds::first($kind) && Kinds::row($kind, $row) === null) {
            throw HttpError::notFound("No {$kind['name']} row with id $id"); // First's read rule doesn't cover it
        }
        if (($query['format'] ?? null) === 'md') {
            $markdown = Kinds::markdown($kind, $row) ?? throw HttpError::notFound("{$kind['name']} has no Markdown form");

            return [200, ['Content-Type' => MarkdownTwins::CONTENT_TYPE, 'X-Content-Type-Options' => 'nosniff'] + self::PRIVATE, $markdown];
        }

        return self::json(200, ['data' => Kinds::row($kind, $row)]);
    }

    /** A list: First's `where`/`orderBy`/`with`/`search`, `limit` and an opaque `cursor` (the next page). */
    private static function list(array $kind, array $query): array
    {
        $limit = isset($query['limit']) ? (int) $query['limit'] : self::LIMIT;
        if ($limit < 1 || (string) $limit !== (string) ($query['limit'] ?? $limit)) {
            throw HttpError::invalidQuery('limit must be a positive integer', '/limit');
        }
        $limit = min($limit, self::MAX_LIMIT);
        $page = 1;
        if (isset($query['cursor'])) {
            $decoded = json_decode((string) base64_decode(strtr((string) $query['cursor'], '-_', '+/'), true), true);
            if (!is_array($decoded) || !is_int($decoded['page'] ?? null) || $decoded['page'] < 2) {
                throw HttpError::invalidQuery('cursor is not one this API issued', '/cursor');
            }
            $page = $decoded['page'];
        }
        if (Kinds::first($kind)) {
            // `where` is always First's (an empty filter when none was given): First's pipeline picks the
            // rows, so its read rule and draft visibility decide, not core's default status filter.
            $params = array_intersect_key($query, array_flip(['where', 'orderBy', 'with', 'search', 'locale']))
                + ['where' => '{}', 'per_page' => $limit, 'page' => $page] + self::context($kind);
        } else {
            // A WordPress kind: core's own filters (`search`, `post`, `parent`, `status`, ...), as core
            // accepts them for this viewer.
            $params = array_diff_key($query, ['limit' => 1, 'cursor' => 1, 'format' => 1, 'per_page' => 1, 'page' => 1, 'context' => 1])
                + ['per_page' => $limit, 'page' => $page] + self::context($kind);
        }
        $response = self::run(self::request('GET', $kind['route'], $params));
        $rows = self::unwrap($response);
        $pages = (int) ($response->get_headers()['X-WP-TotalPages'] ?? 0);
        $cursor = $page < $pages ? rtrim(strtr(base64_encode((string) json_encode(['page' => $page + 1])), '+/', '-_'), '=') : null;

        $rows = array_values(array_filter(array_map(static fn (array $r) => Kinds::row($kind, $r), $rows), static fn ($r) => $r !== null));

        return self::json(200, ['data' => $rows, 'cursor' => $cursor]);
    }

    /**
     * `POST /actions/<name>` (`GET` when readonly): the action's Ability, run as core runs it (its
     * input validation, its permission callback, its output validation), `{ data }` back. Through
     * `WP_Ability::execute()` rather than the run route's REST discovery, so an `agents: false`
     * action (hidden from REST and MCP listings) is still the app's own to call, as on `/first/v1`.
     */
    private static function action(Plugin $plugin, string $method, string $name, array $query, string $body): array
    {
        $action = $plugin->schema->actions()[$name] ?? throw HttpError::notFound("Unknown action '$name'");
        if (($action['signature'] ?? null) !== null) {
            throw HttpError::notFound("Unknown action '$name'"); // a signed webhook is a route, not an action
        }
        \First\App::allow($method, ($action['readonly'] ?? false) ? ['GET', 'HEAD', 'POST'] : ['POST']);
        $ability = wp_get_ability(\First\Wp\Abilities\Register::kebab($plugin->schema->name()) . '/' . \First\Wp\Abilities\Register::kebab($name))
            ?? throw HttpError::notFound("Unknown action '$name'");
        $input = $method === 'POST' ? $body : (string) Js::jsonStringify(self::queryInput($query));
        $decoded = self::body($input);
        $result = \First\Wp\Abilities\Register::withSentInput($ability->get_name(), $input, static function () use ($ability, $decoded) {
            // The ability's own check first, so a refusal keeps First's status and code; execute()
            // checks again and reduces any refusal to a generic one.
            $allowed = $ability->check_permissions($decoded);

            return $allowed instanceof \WP_Error ? $allowed : $ability->execute($decoded);
        });
        if ($result instanceof \WP_Error) {
            throw self::fromWpError($result, 403);
        }

        return self::json(200, ['data' => $result]);
    }

    // ================================================================ dispatch

    /**
     * One internal core dispatch as the current user: its data, or its `WP_Error` thrown as First's
     * problem. $expect is the success status core answers with.
     */
    private static function dispatch(string $method, string $route, array $params, mixed $body = null, int $expect = 200): mixed
    {
        return self::unwrap(self::run(self::request($method, $route, $params, $body)), $expect);
    }

    private static int $depth = 0;

    /** Whether a core route is answering one of the facade's own dispatches right now. */
    public static function dispatching(): bool
    {
        return self::$depth > 0;
    }

    private static function run(\WP_REST_Request $request): \WP_REST_Response
    {
        self::$depth++;
        try {
            return rest_do_request($request);
        } finally {
            self::$depth--;
        }
    }

    private static function request(string $method, string $route, array $params, mixed $body = null): \WP_REST_Request
    {
        $request = new \WP_REST_Request($method, $route);
        if ($method === 'GET' || $method === 'DELETE' || $body === null) {
            $request->set_query_params($params);
        } else {
            $request->set_query_params($params);
            $request->set_header('content-type', 'application/json');
            $request->set_body((string) Js::jsonStringify($body));
        }
        foreach (['idempotency-key'] as $header) {
            $value = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $header))] ?? null;
            if (is_string($value)) {
                $request->set_header($header, $value);
            }
        }

        return $request;
    }

    private static function unwrap(\WP_REST_Response $response, int $expect = 200): mixed
    {
        $data = rest_get_server()->response_to_data($response, false);
        if ($response->is_error() || $response->get_status() >= 400) {
            $error = $response->as_error();
            throw self::fromWpError($error, $response->get_status());
        }

        return $data;
    }

    /** RFC 9457 from core's `WP_Error`: First's own codes keep their name, core's keep theirs. */
    private static function fromWpError(\WP_Error $error, int $status): HttpError
    {
        $data = $error->get_error_data();
        $code = (string) $error->get_error_code();
        $code = str_starts_with($code, 'first_') ? substr($code, strlen('first_')) : $code;
        $code = match ($code) {
            'rest_forbidden', 'rest_cannot_create', 'rest_cannot_edit', 'rest_cannot_delete', 'rest_cannot_read', 'rest_forbidden_context',
            'rest_cannot_create_user', 'rest_user_cannot_delete', 'rest_user_cannot_view', 'rest_cannot_edit_roles',
            'rest_ability_cannot_execute' => get_current_user_id() === 0 ? 'unauthenticated' : 'forbidden',
            'rest_post_invalid_id', 'rest_user_invalid_id', 'rest_no_route', 'rest_ability_not_found' => 'not_found',
            'rest_invalid_param', 'rest_missing_callback_param' => 'invalid_input',
            'rest_no_route_method', 'rest_ability_invalid_method' => 'method_not_allowed',
            default => $code,
        };
        $status = is_array($data) && is_int($data['status'] ?? null) ? $data['status'] : $status;
        if ($code === 'unauthenticated') {
            $status = 401;
        }

        return new HttpError($status, $code, $error->get_error_message(), is_array($data) && is_string($data['pointer'] ?? null) ? $data['pointer'] : null);
    }

    // ================================================================ request parsing

    /** The facade path below its prefix ('' for the schema), or null when the request isn't the facade's. */
    public static function path(): ?string
    {
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '' && str_starts_with($path, $base . '/')) {
            $path = substr($path, strlen($base));
        }
        if ($path !== self::PREFIX && !str_starts_with($path, self::PREFIX . '/')) {
            return null;
        }

        return substr($path, strlen(self::PREFIX));
    }

    /** Core's REST authentication, as `/wp-json` runs it: cookie + nonce, application password, bearer. */
    private static function authenticate(): ?\WP_Error
    {
        $result = apply_filters('rest_authentication_errors', null);

        return $result instanceof \WP_Error ? $result : null;
    }

    /** The raw query string, decoded as the facade's query arguments (no PHP renaming). */
    private static function query(): array
    {
        $out = [];
        foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $pair) {
            if ($pair === '') {
                continue;
            }
            [$k, $v] = array_pad(explode('=', $pair, 2), 2, '');
            $out[urldecode($k)] = urldecode($v);
        }

        return $out;
    }

    /** A readonly action's GET input: `?input=<json>`, or the query's other arguments as strings. */
    private static function queryInput(array $query): array
    {
        if (isset($query['input'])) {
            return self::body((string) $query['input']);
        }

        return $query;
    }

    private static function body(string $body): array
    {
        if (trim($body) === '') {
            return [];
        }
        try {
            $decoded = \First\Seam::container(Js::decodeJson($body));
        } catch (\JsonException $e) {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage());
        }
        if (!is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            throw HttpError::invalidInput('Body must be a JSON object', '');
        }

        return $decoded;
    }

    private static function id(array $kind, string $raw): int|string
    {
        if (str_starts_with($raw, 'slug:') && in_array($kind['type'], ['post', 'wp-post', 'term'], true)) {
            $rows = self::dispatch('GET', $kind['route'], ($kind['type'] === 'post'
                ? ['where' => (string) Js::jsonStringify([$kind['spec']['slug'] ?? 'slug' => substr($raw, 5)])]
                : ['slug' => substr($raw, 5)]) + ['_fields' => 'id']);

            return (int) ($rows[0]['id'] ?? throw HttpError::notFound("No {$kind['name']} with slug " . substr($raw, 5)));
        }

        return preg_match('/^\d{1,18}$/D', $raw) ? (int) $raw : $raw;
    }

    // ================================================================ output

    /**
     * The core context to ask for: `view`. Post kinds: PostsController carries the stored title and
     * content in it. Users: the row is First's own (UserMeta::prepare), whatever core's context shows.
     */
    private static function context(array $kind): array
    {
        return ['context' => 'view'];
    }

    /** `GET`/`PATCH /settings` (spec §2.1): core's settings for admins; the index's public fields for others. */
    private static function settings(string $method, string $body): array
    {
        \First\App::allow($method, ['GET', 'HEAD', 'PATCH']);
        if ($method === 'PATCH') {
            $settings = self::dispatch('POST', '/wp/v2/settings', [], Kinds::settingsInput(self::body($body)));
        } else {
            $response = self::run(self::request('GET', '/wp/v2/settings', []));
            $settings = $response->is_error() ? null : rest_get_server()->response_to_data($response, false);
        }
        $index = self::dispatch('GET', '/', ['_fields' => 'name,description,timezone_string,site_logo,site_icon']);

        return self::json(200, ['data' => Kinds::settings($index, is_array($settings) ? $settings : null)]);
    }

    /**
     * `GET /menus` and `/menus/<location>`: each registered location's menu as a tree. Read through core's
     * menu routes with read access opened for exactly these dispatches: a menu assigned to a theme
     * location is shown on the site to everyone, so its items are public (build plan §2).
     */
    private static function menus(string $method, array $segments): array
    {
        \First\App::allow($method, ['GET', 'HEAD']);
        if (count($segments) > 2) {
            throw HttpError::notFound('No such menus route');
        }
        $open = static fn (bool $access, mixed $request): bool => $access || ($request instanceof \WP_REST_Request
            && preg_match('#^/wp/v2/menu-(locations|items)#', $request->get_route()) && self::dispatching());
        add_filter('rest_menu_read_access', $open, 10, 2);
        try {
            $locations = self::dispatch('GET', '/wp/v2/menu-locations', []);
            $locations = is_array($locations) ? $locations : [];
            if (isset($segments[1])) {
                $locations = [$segments[1] => $locations[$segments[1]] ?? throw HttpError::notFound("No menu location '{$segments[1]}'")];
            }
            $menus = Kinds::menus($locations, static function (int $menu): array {
                $items = self::dispatch('GET', '/wp/v2/menu-items', ['menus' => $menu, 'per_page' => 100]);

                return is_array($items) ? $items : [];
            });
        } finally {
            remove_filter('rest_menu_read_access', $open, 10);
        }

        return self::json(200, ['data' => isset($segments[1]) ? $menus[0] : $menus]);
    }

    /** Every facade answer depends on who asks (cookie, application password, bearer): never cached for others. */
    private const PRIVATE = ['Cache-Control' => 'private, no-store', 'Vary' => 'Cookie, Authorization'];

    /** @return array{int, array<string, string>, string} */
    private static function json(int $status, array $body): array
    {
        return [$status, ['Content-Type' => 'application/json; charset=utf-8'] + self::PRIVATE, (string) Js::jsonStringify($body)];
    }

    private static function problem(\WP_Error $error): never
    {
        $problem = \First\App::problem(self::fromWpError($error, 401));
        self::emit($problem['status'], ['Content-Type' => 'application/problem+json'] + self::PRIVATE, (string) Js::jsonStringify($problem));
    }

    /** @param array<string, string> $headers */
    private static function emit(int $status, array $headers, string $body): never
    {
        status_header($status);
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value, true);
        }
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'HEAD') {
            echo $body;
        }
        exit;
    }
}
