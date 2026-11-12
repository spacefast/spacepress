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
 *   GET    /__first/api/v1/me              → GET  /wp/v2/users/me      { id, name, role } + the user's row
 *   POST   /__first/api/v1/actions/<name>  → /wp-abilities/v1/abilities/<app>/<name>/run (GET if readonly)
 *   GET/PATCH /__first/api/v1/<global>      → the global's get/update Ability, through the same run route
 *   GET/PATCH /__first/api/v1/settings      → GET /wp/v2/settings (public fields from the index for others)
 *   GET    /__first/api/v1/menus[/<loc>]    → /wp/v2/menu-locations + /wp/v2/menu-items, public locations only
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
        // WordPress's CORS for the request's origin, as /wp-json sends it (rest_send_cors_headers and
        // the filters on it), and its answer to a preflight.
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        rest_send_cors_headers(false);
        if ($method === 'OPTIONS') {
            header('Access-Control-Allow-Headers: ' . implode(', ', (array) apply_filters('rest_allowed_cors_headers',
                ['Authorization', 'X-WP-Nonce', 'Content-Disposition', 'Content-MD5', 'Content-Type', 'Idempotency-Key', 'First-Signature'], new \WP_REST_Request('OPTIONS', self::PREFIX . $path))));
            self::emit(204, self::PRIVATE, '');
        }
        try {
            if ($plugin->unavailable() !== null) {
                throw new HttpError(503, 'unavailable', Plugin::UNAVAILABLE);
            }
            $auth = self::authenticate();
            if ($auth instanceof \WP_Error) {
                self::problem($auth);
            }
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
     * @return array{int, array<string, string>, string|\Closure}
     */
    public static function route(Plugin $plugin, string $method, string $path, array $query, string $body): array
    {
        $segments = array_map('rawurldecode', array_values(array_filter(explode('/', $path), static fn ($s) => $s !== '')));
        $kinds = Kinds::all($plugin);
        $name = $segments[0] ?? null;

        if ($name === null) {
            \First\App::allow($method, ['GET', 'HEAD']);

            $plugin->app(); // the running app describes itself fully (its site id, for sync)

            return self::json(200, ['data' => Kinds::describe($plugin)]);
        }
        if ($name === 'me' && count($segments) === 1) {
            \First\App::allow($method, ['GET', 'HEAD']);
            // The signed-in user: `id`, `name` and First's `role`, with the users row as this viewer
            // reads it (a member's own fields) merged in; null when signed out.
            $user = WpAuth::current();
            if ($user === null) {
                return self::json(200, ['data' => null]);
            }
            $row = Kinds::row($kinds['users'], self::dispatch('GET', '/wp/v2/users/me', ['context' => 'edit']));

            return self::json(200, ['data' => array_merge(is_array($row) ? $row : [], $user)]);
        }
        if ($name === 'actions' && count($segments) === 2) {
            return self::action($plugin, $method, $segments[1], $query, $body);
        }
        if (isset($plugin->schema->globals()[$name]) && count($segments) === 1) {
            return self::global($plugin, $method, $name, $body);
        }
        if (\First\Extensions::routeHandler($name) !== null && ($name !== 'media' || ($segments[2] ?? null) === 'file')) {
            // First's own features with no core route (sign-in, sync, services, private files and the
            // streams of uploads kept off the web root): their one implementation, under the facade's
            // prefix. Media rows themselves are the built-in kind, served by core's media route.
            [$status, $headers, $out] = $plugin->app()->handle($method, '/' . implode('/', array_map('rawurlencode', $segments)), $query, $body, self::headers(), $_FILES, $_POST);
            $cached = array_filter(array_keys($headers), static fn ($h) => strtolower((string) $h) === 'cache-control') !== [];

            return [$status, $cached ? $headers : $headers + self::PRIVATE, $out];
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
            if ($method === 'POST' && $kind['type'] === 'media') {
                return self::json(201, ['data' => Kinds::row($kind, self::upload($base))]);
            }
            if ($method === 'POST') {
                $row = self::dispatch('POST', $base, self::context($kind), Kinds::input($kind, self::body($body), create: true), 201);

                return self::json(201, ['data' => Kinds::row($kind, $row)]);
            }

            return self::list($kind, $query);
        }
        if ($kind['type'] === 'post' && ($segments[2] ?? null) === 'revisions' && count($segments) <= 5) {
            return self::revisions($kind, $method, self::id($kind, $segments[1]), array_slice($segments, 3));
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
        if ($kind['type'] === 'post' && isset($query['locale']) && $query['locale'] !== '*') {
            // `?locale=fr` on an item: the member of its translation group in that locale (else the
            // group's fallback), as First's read pipeline resolves it for this viewer.
            $member = self::dispatch('GET', $base, ['where' => (string) Js::jsonStringify([$kind['spec']['primaryKey'] => $id]), 'locale' => $query['locale'], '_fields' => 'id']);
            $item = "$base/" . rawurlencode((string) ($member[0]['id'] ?? throw HttpError::notFound("No {$kind['name']} row with id $id")));
        }
        $row = self::dispatch('GET', $item, self::context($kind) + array_intersect_key($query, Kinds::first($kind) ? ['with' => true] : ['password' => true]));
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
        // `offset` skips rows; `cursor` (opaque) is where the previous page of this API stopped.
        $offset = 0;
        if (isset($query['offset'])) {
            if (!preg_match('/^\d{1,9}$/D', (string) $query['offset'])) {
                throw HttpError::invalidQuery('offset must be a non-negative integer', '/offset');
            }
            $offset = (int) $query['offset'];
        }
        if (isset($query['cursor'])) {
            $decoded = json_decode((string) base64_decode(strtr((string) $query['cursor'], '-_', '+/'), true), true);
            if (!is_array($decoded) || !is_int($decoded['offset'] ?? null) || $decoded['offset'] < 1) {
                throw HttpError::invalidQuery('cursor is not one this API issued', '/cursor');
            }
            $offset = $decoded['offset'];
        }
        $paging = ['per_page' => $limit] + ($offset > 0 ? ['offset' => $offset] : []);
        if (Kinds::first($kind)) {
            // `where` is always First's (an empty filter when none was given): First's pipeline picks the
            // rows, so its read rule and draft visibility decide, not core's default status filter.
            $params = array_intersect_key($query, array_flip(['where', 'orderBy', 'with', 'search', 'locale']))
                + ['where' => '{}'] + $paging + self::context($kind);
        } else {
            // A WordPress kind: core's own filters (`search`, `post`, `parent`, `status`, ...), as core
            // accepts them for this viewer.
            $params = array_diff_key($query, ['limit' => 1, 'offset' => 1, 'cursor' => 1, 'format' => 1, 'per_page' => 1, 'page' => 1, 'context' => 1])
                + $paging + self::context($kind);
        }
        $response = self::run(self::request('GET', $kind['route'], $params));
        $rows = self::unwrap($response);
        $total = (int) ($response->get_headers()['X-WP-Total'] ?? 0);
        $next = $offset + $limit;
        $cursor = $next < $total ? rtrim(strtr(base64_encode((string) json_encode(['offset' => $next])), '+/', '-_'), '=') : null;

        $rows = array_values(array_filter(array_map(static fn (array $r) => Kinds::row($kind, $r), $rows), static fn ($r) => $r !== null));

        return self::json(200, ['data' => $rows, 'cursor' => $cursor]);
    }

    /**
     * `POST /actions/<name>` (`GET` when readonly): the action's Ability through core's run route
     * (`/wp-abilities/v1/abilities/<app>/<name>/run`), so core's own checks decide (input, permission,
     * execution, output) and the facade only maps: the facade method onto the one the run route takes
     * (GET for readonly, DELETE for destructive + idempotent, POST otherwise), `{ input }` in, `{ data }`
     * out. An `agents: false` action is the app's own to call ({@see Abilities\FirstAbility}).
     */
    private static function action(Plugin $plugin, string $method, string $name, array $query, string $body): array
    {
        $action = $plugin->schema->actions()[$name] ?? throw HttpError::notFound("Unknown action '$name'");
        if (($action['signature'] ?? null) !== null) {
            // An inbound webhook signs the raw body, which an Ability input can't carry: First's own
            // action path verifies the signature (the caller is anonymous after it). It moves to
            // `app/**/route.ts` with the authoring cutover, and this branch goes with the option.
            \First\App::allow($method, ['POST']);

            return $plugin->app()->handle('POST', '/actions/' . rawurlencode($name), [], $body, self::headers());
        }
        \First\App::allow($method, ($action['readonly'] ?? false) ? ['GET', 'HEAD', 'POST'] : ['POST']);
        $input = $method === 'POST' ? $body : (string) Js::jsonStringify(self::queryInput($query));

        self::$passed = [];
        [$status, $headers, $out] = self::json(200, ['data' => self::ability($plugin, Abilities\Register::kebab($name), $input, "Unknown action '$name'")]);

        return [$status, self::$passed + $headers, $out];
    }

    /** `GET`/`PATCH /<global>` (spec §3a): the global's read and update Abilities through the run route. */
    private static function global(Plugin $plugin, string $method, string $name, string $body): array
    {
        \First\App::allow($method, ['GET', 'HEAD', 'PATCH']);
        $op = $method === 'PATCH' ? 'update' : 'get';

        return self::json(200, ['data' => self::ability($plugin, 'global-' . Abilities\Register::kebab($name) . '-' . $op, $op === 'update' ? $body : '{}', "Unknown global '$name'")]);
    }

    /** One run of the app's ability `<app>/<ability>` with $input (a JSON object) through core's run route. */
    private static function ability(Plugin $plugin, string $ability, string $input, string $missing): mixed
    {
        $name = Abilities\Register::kebab($plugin->schema->name()) . '/' . $ability;
        $object = wp_get_ability($name) ?? throw HttpError::notFound($missing);
        self::body($input); // a JSON object, or the facade's 400/422
        $annotations = (array) $object->get_meta_item('annotations', []);
        $method = !empty($annotations['readonly']) ? 'GET' : (!empty($annotations['destructive']) && !empty($annotations['idempotent']) ? 'DELETE' : 'POST');
        $request = new \WP_REST_Request($method, '/wp-abilities/v1/abilities/' . $name . '/run');
        if ($method === 'POST') {
            // The body as sent, so `{}` inside a json() value stays an object (Register::rawInput).
            $request->set_header('content-type', 'application/json');
            $request->set_body('{"input":' . (trim($input) === '' ? '{}' : $input) . '}');
        } else {
            $request->set_query_params(['input' => json_decode(trim($input) === '' ? '{}' : $input, true)]);
        }
        foreach (['idempotency-key'] as $header) {
            $value = $_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $header))] ?? null;
            if (is_string($value)) {
                $request->set_header($header, $value);
            }
        }
        $response = Abilities\Register::withSentInput($name, $input, static fn () => self::run($request));
        $data = self::unwrap($response);
        self::$passed = array_intersect_key($response->get_headers(), ['Idempotent-Replayed' => true]);

        return $data;
    }

    /** @var array<string, string> response headers of the last ability run the facade passes on */
    private static array $passed = [];

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
            'rest_post_invalid_id', 'rest_user_invalid_id', 'rest_no_route', 'rest_ability_not_found', 'rest_revision_parent_id_mismatch',
            'rest_term_invalid', 'rest_comment_invalid_id', 'rest_menu_location_invalid' => 'not_found',
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
        // Transport metadata, as core's own routes consume it: api-fetch's locale hint and the nonce.
        unset($out['_locale'], $out['_wpnonce']);

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

    /**
     * `/<kind>/<id>/revisions[/<rid>[/restore]]` over core's `/wp/v2/<type>/<id>/revisions` (core's
     * revisions controller, First's snapshot and field masks on each one, CoreAccess::prepareChild).
     * A restore is the revision's row as an update of the post through its core route, so the update
     * rule, validation and hooks decide it exactly as any other edit. Needs First's update rule.
     */
    private static function revisions(array $kind, string $method, int|string $id, array $rest): array
    {
        $collection = (string) $kind['name'];
        $spec = $kind['spec'];
        if (!($spec['revisions'] ?? false)) {
            throw HttpError::notFound("$collection keeps no revisions");
        }
        $viewer = CoreAccess::viewer();
        if ($viewer === null || !CoreAccess::covers($collection, 'update', $id, $viewer)) {
            throw $viewer?->user === null ? new HttpError(401, 'unauthenticated', "Sign in to see the revisions of $collection rows")
                : HttpError::notFound("No $collection row $id");
        }
        $route = "{$kind['route']}/" . rawurlencode((string) $id) . '/revisions';
        $db = Plugin::instance()?->db() ?? throw new \LogicException('No First app');
        if ($rest === []) {
            \First\App::allow($method, ['GET', 'HEAD']);
            $out = [];
            foreach ((array) self::dispatch('GET', $route, ['context' => 'view', 'per_page' => 100, '_fields' => 'id,author,date_gmt']) as $r) {
                if (wp_is_post_autosave((int) $r['id'])) {
                    continue;
                }
                $user = (int) ($r['author'] ?? 0) > 0 ? get_userdata((int) $r['author']) : null;
                $out[] = ['id' => (int) $r['id'], 'at' => self::isoGmt((string) ($r['date_gmt'] ?? '')),
                    'user' => $user instanceof \WP_User ? ['id' => (int) $user->ID, 'name' => (string) $user->display_name] : null];
            }

            return self::json(200, ['data' => $out]);
        }
        if (!preg_match('/^\d{1,18}$/D', $rest[0])) {
            throw HttpError::notFound("No revision {$rest[0]}");
        }
        $rid = (int) $rest[0];
        self::dispatch('GET', "$route/$rid", ['_fields' => 'id']); // core's own check that it is one of this post's
        $row = $db->revision($collection, $id, $rid, $viewer); // First's snapshot, masked for this viewer
        if (count($rest) === 1) {
            \First\App::allow($method, ['GET', 'HEAD']);

            return self::json(200, ['data' => $row]);
        }
        if ($rest[1] !== 'restore' || count($rest) !== 2) {
            throw HttpError::notFound('No such revisions route');
        }
        \First\App::allow($method, ['POST']);
        $patch = [];
        foreach ($spec['columns'] as $name => $col) {
            if ($name !== $spec['primaryKey'] && !($col['system'] ?? false) && !isset($col['onUpdate']) && array_key_exists($name, $row)) {
                $patch[(string) $name] = $row[$name];
            }
        }
        $updated = self::dispatch('POST', "{$kind['route']}/" . rawurlencode((string) $id), self::context($kind), Kinds::input($kind, $patch));

        return self::json(200, ['data' => Kinds::row($kind, $updated)]);
    }

    private static function isoGmt(string $gmt): string
    {
        return str_replace(' ', 'T', $gmt) . '.000Z';
    }

    /**
     * `POST /media`: a multipart upload (`file`, optional `alt`) as core's `POST /wp/v2/media`, which
     * keeps core's file validation, metadata and hooks, with First's media rules around it
     * ({@see Media\Rest}).
     */
    private static function upload(string $route): mixed
    {
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || is_array($file['error'] ?? null)) {
            throw HttpError::invalidInput('Send the file as multipart/form-data field "file"', '/file');
        }
        $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            throw new HttpError(413, 'payload_too_large', 'The upload is larger than this server accepts');
        }
        $request = new \WP_REST_Request('POST', $route);
        $request->set_file_params(['file' => $file]);
        $alt = $_POST['alt'] ?? null;
        if ($alt !== null && !is_string($alt)) {
            throw HttpError::invalidInput('alt must be a string', '/alt');
        }
        $request->set_body_params($alt === null ? [] : ['alt_text' => wp_unslash($alt)]);

        return self::unwrap(self::run($request), 201);
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
    private const PRIVATE = ['Cache-Control' => 'private, no-store', 'Vary' => 'Origin, Cookie, Authorization'];

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

    /** @return array<string, string> lower-cased request headers, as First's handlers read them */
    private static function headers(): array
    {
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

        return $headers;
    }

    /** @param array<string, string> $headers */
    private static function emit(int $status, array $headers, string|\Closure $body): never
    {
        status_header($status);
        foreach ($headers as $name => $value) {
            header($name . ': ' . $value, true);
        }
        if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'HEAD') {
            \First\Response::emit($body); // a file download streams through its closure
        }
        exit;
    }
}
