<?php

declare(strict_types=1);

namespace Zero;

use Zero\Store\SqliteMedia;
use Zero\Store\SqliteStore;

/**
 * Boots a generated app and serves its REST API (§4.8) and CLI. Target-agnostic: the standalone
 * front controller uses App::boot($root) (SQLite + bearer tokens + local media); the WP plugin passes
 * its own Store/Auth/Media and calls handle() with the path after its REST prefix.
 */
final class App
{
    public const PREFIX = '/api';
    private const LIST_LIMIT = 50;
    private const MAX_LIST_LIMIT = 200;
    private const CORS = [
        'Access-Control-Allow-Origin' => '*',
        'Access-Control-Allow-Methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers' => 'content-type, authorization, idempotency-key',
        'Access-Control-Expose-Headers' => 'Idempotent-Replayed',
    ];
    private const TITLES = [
        'invalid_input' => 'Invalid input',
        'invalid_query' => 'Invalid query',
        'invalid_json' => 'Invalid JSON',
        'not_found' => 'Not found',
        'method_not_allowed' => 'Method not allowed',
        'unique_violation' => 'Unique violation',
        'reference_violation' => 'Reference violation',
        'rejected' => 'Rejected',
        'unauthenticated' => 'Unauthenticated',
        'forbidden' => 'Forbidden',
        'payload_too_large' => 'Payload too large',
        'internal' => 'Internal error',
        'unavailable' => 'Service unavailable',
    ];

    private function __construct(
        public readonly string $root,
        public readonly Schema $schema,
        public readonly Db $db,
        public readonly Store $store,
        public readonly Auth $auth,
    ) {
    }

    /**
     * Boot an app root. With no Store/Auth/Media the standalone services are built (SQLite at
     * env ZERO_DB_PATH or <root>/data/zero.sqlite, bearer tokens, <root>/public/uploads).
     *
     * @param ?bool $migrate standalone only; null = apply pending migrations unless ZERO_AUTO_MIGRATE=0
     */
    public static function boot(string $appRoot, ?Store $store = null, ?Auth $auth = null, ?Media $media = null, ?bool $migrate = null): self
    {
        $schema = Schema::load($appRoot . '/zero/app/schema.php');
        $functions = $appRoot . '/zero/app/functions.php';
        if (is_file($functions)) {
            require_once $functions;
        }
        if ($store === null) {
            Secret::load($appRoot);
            $store = new SqliteStore(SqliteStore::connect(getenv('ZERO_DB_PATH') ?: $appRoot . '/data/zero.sqlite'), $schema);
            $auth ??= new Identity($store, $schema);
            $media ??= new SqliteMedia($store, $appRoot . '/public');
            if ($migrate ?? getenv('ZERO_AUTO_MIGRATE') !== '0') {
                $store->migrate($appRoot . '/zero/app/migrations');
            }
        }
        if ($auth === null || $media === null) {
            throw new \LogicException('App::boot needs Auth and Media when a Store is given');
        }
        $db = new Db($store, $schema, $media, $schema->target());
        Db::setInstance($db);
        if ($auth instanceof Identity) {
            Auth\Module::use($auth);
        }

        return new self($appRoot, $schema, $db, $store, $auth);
    }

    /** @return list<string> applied migration ids (standalone) */
    public function migrate(): array
    {
        if (!$this->store instanceof SqliteStore) {
            throw new \LogicException('migrate is standalone-only; the WP plugin migrates on activation');
        }

        return $this->store->migrate($this->root . '/zero/app/migrations');
    }

    public function identity(): Identity
    {
        return $this->auth instanceof Identity ? $this->auth : throw new HttpError(404, 'not_found', 'Users and tokens are managed by WordPress on this target');
    }

    /** Validate input against an action's schema, check its access, run its handler. */
    private function action(string $name, string $rawBody, array $headers = [], ?Viewer $viewer = null): Response
    {
        $input = self::parseBody($rawBody);
        $action = $this->schema->action($name);
        if ($viewer !== null && ($action['signature'] ?? null) !== null) {
            // A `signature` action authenticates by HMAC in the beforeAction seam instead of an access
            // rule (§6.1): whoever is logged in, the verified caller is anonymous for everything after.
            Extensions::action($action, $name, $rawBody, array_change_key_case($headers, CASE_LOWER), $viewer);
            $viewer = new Viewer(null, $viewer->target);
            $this->db->setActor(null);
        } else {
            if ($viewer !== null) {
                Access::require($action['access'] ?? Access::DEFAULT_WRITE, $viewer, 'create', null, "run $name");
            }
            Extensions::action($action, $name, $rawBody, array_change_key_case($headers, CASE_LOWER), $viewer);
        }
        $ctx = $this->db->hookCtx();
        $input = Schema::validateInput($action['input'] ?? [], $input, '', $ctx['user'], $ctx['target']);
        $fn = '\\ZeroApp\\' . $action['handler'];

        return Extensions::execute('action:' . $name, $action, $rawBody, array_change_key_case($headers, CASE_LOWER), $viewer,
            static fn (): Response => Response::json($fn($input, $ctx)));
    }

    /** Invoke any API operation with explicit authority. No authentication, JSON envelope or error conversion. */
    public function invoke(string $method, string $path, array $query, mixed $body, Viewer $viewer): mixed
    {
        $raw = is_string($body) ? $body : ($body === null ? '' : (Js::jsonStringify($body) ?? ''));

        return $this->dispatch($method, $path, $query, $raw, $viewer)->data;
    }

    /** The shared operation dispatcher; errors throw, and response emission belongs to the transport. */
    public function dispatch(string $method, string $path, array $query, string $body, Viewer $viewer, array $headers = [], array $files = [], array $form = []): Response
    {
        return $this->db->transaction(function () use ($method, $path, $query, $body, $viewer, $headers, $files, $form): Response {
            $previous = $this->db->actor();
            $this->db->setActor($viewer->user);
            try {
                $this->db->promoteDue();
                $result = $this->route($method, $path, $query, $body, $viewer, array_change_key_case($headers, CASE_LOWER), $files, $form);

                return $result instanceof Response ? $result : Response::json($result[1], $result[0]);
            } finally {
                $this->db->setActor($previous);
            }
        });
    }

    // ================================================================ HTTP

    public function handleHttp(): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $query = [];
        parse_str((string) parse_url($uri, PHP_URL_QUERY), $query);
        $path = (string) parse_url($uri, PHP_URL_PATH);
        $headers = self::requestHeaders();
        if ($path !== self::PREFIX && !str_starts_with($path, self::PREFIX . '/')) {
            [$status, $out, $body] = self::respond(HttpError::notFound("No route for $path"));
        } elseif ($method === 'POST' && $_FILES === [] && $_POST === [] && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > self::iniBytes('post_max_size')
            && str_starts_with($headers['content-type'] ?? '', 'multipart/')) {
            [$status, $out, $body] = self::respond(new HttpError(413, 'payload_too_large', 'The upload is larger than this server accepts'));
        } else {
            [$status, $out, $body] = $this->handle($method, substr($path, strlen(self::PREFIX)), $query, (string) file_get_contents('php://input'), $headers, $_FILES, $_POST);
        }
        http_response_code($status);
        foreach ($out as $name => $value) {
            header("$name: $value");
        }
        Response::emit($body);
    }

    /**
     * One API request. $path is relative to the API prefix ('/posts/1'). $files/$form are the
     * multipart parts (PHP's $_FILES/$_POST shape) for POST /media.
     *
     * @param array<string, mixed> $query
     * @param array<string, string> $headers lower-cased names
     * @return array{int, array<string, string>, string|\Closure}
     */
    public function handle(string $method, string $path, array $query, string $body, array $headers = [], array $files = [], array $form = []): array
    {
        if ($method === 'OPTIONS') {
            return [204, self::CORS, ''];
        }
        try {
            $response = $this->db->transaction(function () use ($method, $path, $query, $body, $headers, $files, $form): Response {
                $user = $this->auth->resolve(array_change_key_case($headers, CASE_LOWER));

                return $this->dispatch($method, $path, $query, $body, new Viewer($user, $this->schema->target()), $headers, $files, $form);
            });
            [$status, $out, $payload] = $response->http();

            return [$status, Response::mergeHeaders(self::CORS, $out), $payload];
        } catch (\Throwable $e) {
            return self::respond($e);
        }
    }

    /** @return array{int, array<string, string>, string} */
    private static function respond(\Throwable $e): array
    {
        $problem = self::problem($e);

        return [$problem['status'], ['Content-Type' => 'application/problem+json'] + self::CORS, Js::jsonStringify($problem) ?? '{}'];
    }

    /** @return array{int, mixed}|Response */
    private function route(string $method, string $path, array $query, string $body, Viewer $viewer, array $headers, array $files, array $form): array|Response
    {
        $segments = array_map('rawurldecode', array_values(array_filter(explode('/', $path), static fn ($s) => $s !== '')));
        $n = count($segments);
        $name = $segments[0] ?? '';
        $notFound = static fn () => HttpError::notFound("No route for " . self::PREFIX . $path);

        if (($handler = Extensions::routeHandler($name)) !== null) {
            return $handler($method, $segments, $query, $body, $viewer, $files, $form);
        }
        switch (true) {
            case $name === '_schema' && $n === 1:
                self::allow($method, ['GET']);

                return [200, $this->schema->describe()];
            case $name === 'me' && $n === 1:
                self::allow($method, ['GET']);

                return [200, Auth\Module::me($viewer->user)];
            case $name === 'actions' && $n === 2:
                self::allow($method, ['POST']);

                return $this->action($segments[1], $body, $headers, $viewer);
            case $name === 'globals' && $n === 2:
                self::allow($method, ['GET', 'PATCH']);

                return $method === 'GET'
                    ? [200, $this->db->globalGet($segments[1], $viewer)]
                    : [200, $this->db->globalUpdate($segments[1], self::object(self::parseBody($body)), $viewer)];
        }

        if ($n < 1 || $n > 5) {
            throw $notFound();
        }

        if (!$this->schema->hasCollection($name)) {
            throw HttpError::notFound("Unknown collection '$name'");
        }
        $spec = $this->schema->collection($name);

        if ($n === 1) {
            self::allow($method, ['GET', 'POST']);
            if ($method === 'GET') {
                $this->gate($spec, 'list');

                return [200, $this->db->findMany($name, self::listOptions($query), $viewer)];
            }
            $this->gate($spec, 'create');
            $data = self::object(self::parseBody($body));

            $result = null;
            $around = static function (callable $write) use ($name, $spec, $body, $headers, $viewer, &$result): array {
                $result = Extensions::execute('create:' . $name, $spec, $body, $headers, $viewer,
                    static fn (): Response => Response::json($write(), 201));

                return $result->data;
            };
            $row = $this->db->insert($name, $data, true, $viewer, $around)[0];

            return Response::json($row, $result->status, $result->headers);
        }

        $pk = $this->pkFromPath($spec, $segments[1]);
        $where = [$spec['primaryKey'] => $pk];
        $missing = static fn () => HttpError::notFound("No $name row with {$spec['primaryKey']} {$segments[1]}");

        if ($n === 2) {
            self::allow($method, ['GET', 'PATCH', 'DELETE']);
            $this->gate($spec, ['GET' => 'get', 'PATCH' => 'update', 'DELETE' => 'delete'][$method]);

            return match ($method) {
                'GET' => [200, $this->db->findFirst($name, ['where' => $where] + self::itemOptions($query), $viewer) ?? throw $missing()],
                'PATCH' => [200, $this->db->update($name, self::object(self::parseBody($body)), $where, true, $viewer)[0] ?? throw $missing()],
                'DELETE' => [200, $this->db->delete($name, $where, true, $viewer)[0] ?? throw $missing()],
            };
        }

        if ($segments[2] !== 'revisions') {
            throw $notFound();
        }
        $this->gate($spec, 'update');
        if ($n === 3) {
            self::allow($method, ['GET']);

            return [200, array_map(fn (array $r) => [
                'id' => $r['id'],
                'at' => $r['at'],
                'user' => $r['userId'] === null ? null : (($u = $this->auth->user($r['userId'])) === null ? null : ['id' => $u['id'], 'name' => $u['name']]),
            ], $this->db->revisions($name, $pk, $viewer))];
        }
        if (!preg_match('/^\d{1,18}$/D', $segments[3])) {
            throw HttpError::notFound("No revision {$segments[3]}");
        }
        $rid = (int) $segments[3];
        if ($n === 4) {
            self::allow($method, ['GET']);

            return [200, $this->db->revision($name, $pk, $rid, $viewer)];
        }
        if ($segments[4] !== 'restore') {
            throw $notFound();
        }
        self::allow($method, ['POST']);

        return [200, $this->db->restoreRevision($name, $pk, $rid, $viewer)];
    }

    public static function allow(string $method, array $allowed): void
    {
        if (!in_array($method, $allowed, true)) {
            throw new HttpError(405, 'method_not_allowed', "$method is not allowed here");
        }
    }

    private function gate(array $spec, string $op): void
    {
        if (!($spec['api'][$op] ?? false)) {
            throw new HttpError(405, 'method_not_allowed', "The $op operation is disabled for this collection");
        }
    }

    private function pkFromPath(array $spec, string $id): int|string
    {
        $type = $spec['columns'][$spec['primaryKey']]['type'];
        if ($type !== 'integer') {
            return $id;
        }
        if (!preg_match('/^-?\d{1,18}$/D', $id)) {
            throw HttpError::notFound("No row with {$spec['primaryKey']} $id");
        }

        return (int) $id;
    }

    public static function listOptions(array $query): array
    {
        $opts = ['limit' => min(self::queryInt($query, 'limit') ?? self::LIST_LIMIT, self::MAX_LIST_LIMIT)];
        if (isset($query['where'])) {
            $opts['where'] = self::queryJson($query['where'], '/where');
        }
        if (isset($query['status'])) {
            $status = ['status' => self::queryString($query['status'], '/status')];
            $opts['where'] = isset($opts['where']) ? ['AND' => [$opts['where'], $status]] : $status;
        }
        if (isset($query['orderBy'])) {
            $opts['orderBy'] = [];
            foreach (explode(',', self::queryString($query['orderBy'], '/orderBy')) as $part) {
                $part = trim($part);
                if ($part !== '') {
                    $desc = $part[0] === '-';
                    $opts['orderBy'][ltrim($part, '-+')] = $desc ? 'desc' : 'asc';
                }
            }
        }
        if (($offset = self::queryInt($query, 'offset')) !== null) {
            $opts['offset'] = $offset;
        }
        if (isset($query['with'])) {
            $opts['with'] = self::withOption($query['with']);
        }

        return $opts + array_diff_key($query, array_fill_keys(['limit', 'where', 'status', 'orderBy', 'offset', 'with'], true));
    }

    private static function itemOptions(array $query): array
    {
        return (isset($query['with']) ? ['with' => self::withOption($query['with'])] : []) + array_diff_key($query, ['with' => true]);
    }

    /** `with=author,comments` or JSON `with={"author":true}`. */
    private static function withOption(mixed $value): array
    {
        $s = trim(self::queryString($value, '/with'));
        if (str_starts_with($s, '{')) {
            $with = self::queryJson($s, '/with');
            $with = $with instanceof JsObject ? [] : $with;
            if (!is_array($with) || ($with !== [] && array_is_list($with))) {
                throw HttpError::invalidQuery('with must be an object', '/with');
            }

            return $with;
        }
        $names = array_filter(array_map('trim', explode(',', $s)), static fn ($x) => $x !== '');

        return array_fill_keys($names, true);
    }

    private static function queryString(mixed $value, string $ptr): string
    {
        return is_string($value) ? $value : throw HttpError::invalidQuery('Expected a single string parameter', $ptr);
    }

    private static function queryInt(array $query, string $key): ?int
    {
        if (!isset($query[$key])) {
            return null;
        }
        $v = self::queryString($query[$key], "/$key");
        if (!preg_match('/^\d{1,9}$/D', $v)) {
            throw HttpError::invalidQuery("$key must be a non-negative integer", "/$key");
        }

        return (int) $v;
    }

    private static function queryJson(mixed $value, string $ptr): mixed
    {
        try {
            // `{}` stays an object here; Db flattens query options by schema, keeping json() operands.
            return Js::decodeJson(self::queryString($value, $ptr));
        } catch (\JsonException $e) {
            throw HttpError::invalidQuery('Invalid JSON: ' . $e->getMessage(), $ptr);
        }
    }

    private static function parseBody(string $body): mixed
    {
        if (trim($body) === '') {
            return [];
        }
        try {
            // `{}` inside a json() column value stays an object; Db/Schema flatten it everywhere else.
            return Js::decodeJson($body);
        } catch (\JsonException $e) {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage());
        }
    }

    private static function object(mixed $v): array
    {
        if ($v instanceof JsObject) {
            return []; // a top-level `{}` body: no fields
        }
        if (!is_array($v) || ($v !== [] && array_is_list($v))) {
            throw HttpError::invalidInput('Body must be a JSON object', '');
        }

        return $v;
    }

    /** @return array<string, string> lower-cased request headers */
    private static function requestHeaders(): array
    {
        $out = [];
        foreach (function_exists('getallheaders') ? (getallheaders() ?: []) : [] as $k => $v) {
            $out[strtolower((string) $k)] = (string) $v;
        }
        foreach ($_SERVER as $k => $v) {
            if (is_string($v) && str_starts_with((string) $k, 'HTTP_')) {
                $out[strtolower(str_replace('_', '-', substr((string) $k, 5)))] ??= $v;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $out['content-type'] ??= (string) $_SERVER['CONTENT_TYPE'];
        }

        return $out;
    }

    private static function iniBytes(string $key): int
    {
        $v = trim((string) ini_get($key));
        $n = (int) $v;

        return match (strtolower(substr($v, -1))) {
            'g' => $n << 30,
            'm' => $n << 20,
            'k' => $n << 10,
            default => $n,
        } ?: PHP_INT_MAX;
    }

    /** RFC 9457 problem document for any throwable. */
    public static function problem(\Throwable $e): array
    {
        [$status, $code, $detail, $pointer] = match (true) {
            $e instanceof HttpError => [$e->status, $e->errorCode, $e->getMessage(), $e->pointer],
            $e instanceof JsError => [422, 'rejected', $e->getMessage(), null],
            default => [500, 'internal', getenv('ZERO_DEBUG') === '1' ? $e->getMessage() : 'Internal server error', null],
        };
        if ($status >= 500) {
            error_log('[zero] ' . $e::class . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
        }
        $problem = [
            'type' => 'about:blank',
            'title' => self::TITLES[$code] ?? self::reason($status),
            'status' => $status,
            'code' => $code,
            'detail' => $detail,
        ];

        return $pointer === null ? $problem : $problem + ['pointer' => $pointer];
    }

    private static function reason(int $status): string
    {
        return match ($status) {
            400 => 'Bad request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not found',
            405 => 'Method not allowed', 409 => 'Conflict', 413 => 'Payload too large', 422 => 'Unprocessable content',
            429 => 'Too many requests', 500 => 'Internal error', 503 => 'Service unavailable', default => 'Error',
        };
    }

    // ================================================================ CLI

    /**
     * Run a CLI command (trusted: no access checks). Returns [exit code, stdout JSON].
     *
     * @param list<string> $args arguments after the script name
     * @return array{int, string}
     */
    public function cli(array $args): array
    {
        try {
            $data = $this->cliCommand($args);

            return [0, Js::jsonStringify(['data' => $data]) ?? '{}'];
        } catch (\Throwable $e) {
            return [1, Js::jsonStringify(['error' => self::problem($e)]) ?? '{}'];
        }
    }

    private const USAGE = 'Usage: zero.php migrate | publish-due | action <name> [json] | find <collection> [opts]'
        . ' | insert <collection> <json> | update <collection> <where> <set> | delete <collection> <where>'
        . ' | user add <name> --role <role> [--password [value]] | user list | user role <name> <role> | user remove <name> | user suspend|reactivate <name>'
        . ' | token create <user> [--name <label>] | token list [user] | token revoke <id>';

    private function cliCommand(array $args): mixed
    {
        [$pos, $flags] = self::cliArgs($args);
        $cmd = $pos[0] ?? '';
        $json = static function (int $i, bool $required = true) use ($pos): mixed {
            if (!isset($pos[$i])) {
                return $required ? throw HttpError::invalidInput('Missing JSON argument ' . $i) : null;
            }

            return self::parseBody($pos[$i]);
        };
        if ($cmd === 'migrate') {
            return ['applied' => $this->migrate()];
        }
        $usage = static fn () => new HttpError(400, 'invalid_command', self::USAGE);

        return $this->db->transaction(function () use ($cmd, $pos, $flags, $json, $usage) {
            $promoted = $this->db->promoteDue();
            if ($cmd === 'publish-due') {
                return ['promoted' => (object) $promoted];
            }
            if (($handler = Extensions::cliHandler($cmd)) !== null) {
                return $handler(array_slice($pos, 1), $flags);
            }
            $sub = $pos[1] ?? null;
            if ($cmd === 'user' || $cmd === 'users') {
                $id = $this->identity();

                return match ($sub) {
                    'add', 'create' => $id->addUser($pos[2] ?? throw $usage(), (string) ($flags['role'] ?? throw HttpError::invalidInput('--role is required', '/role')), self::password($flags)),
                    'list' => $id->listUsers(),
                    'role' => $id->setRole($pos[2] ?? throw $usage(), $pos[3] ?? throw $usage()),
                    'remove' => $id->removeUser($pos[2] ?? throw $usage()),
                    'suspend' => $id->suspend($pos[2] ?? throw $usage(), true),
                    'reactivate' => $id->suspend($pos[2] ?? throw $usage(), false),
                    default => throw $usage(),
                };
            }
            if ($cmd === 'token' || $cmd === 'tokens') {
                $id = $this->identity();

                return match ($sub) {
                    'create' => $id->createToken($pos[2] ?? throw $usage(), isset($flags['name']) ? (string) $flags['name'] : null),
                    'list' => $id->listTokens($pos[2] ?? null),
                    'revoke' => $id->revokeToken(preg_match('/^\d+$/D', $pos[2] ?? '') ? (int) $pos[2] : throw $usage()),
                    default => throw $usage(),
                };
            }
            if (!in_array($cmd, ['action', 'find', 'insert', 'update', 'delete'], true) || $sub === null) {
                throw $usage();
            }

            return match ($cmd) {
                'action' => $this->action($sub, $pos[2] ?? '')->data,
                'find' => $this->db->findMany($sub, self::object($json(2, false) ?? [])),
                'insert' => $this->db->insert($sub, self::rows($json(2)), true),
                'update' => $this->db->update($sub, self::object($json(3)), self::object($json(2)), true),
                'delete' => $this->db->delete($sub, self::object($json(2)), true),
            };
        });
    }

    /**
     * Split argv into positionals and --flags. `--flag value`, `--flag=value`; a flag followed by
     * nothing or another flag is `true`.
     *
     * @return array{list<string>, array<string, string|true>}
     */
    private static function cliArgs(array $args): array
    {
        $pos = [];
        $flags = [];
        for ($i = 0; $i < count($args); $i++) {
            $a = $args[$i];
            if (str_starts_with($a, '--') && strlen($a) > 2) {
                $eq = strpos($a, '=');
                if ($eq !== false) {
                    $flags[substr($a, 2, $eq - 2)] = substr($a, $eq + 1);
                } elseif (isset($args[$i + 1]) && !str_starts_with($args[$i + 1], '--')) {
                    $flags[substr($a, 2)] = $args[++$i];
                } else {
                    $flags[substr($a, 2)] = true;
                }
            } else {
                $pos[] = $a;
            }
        }

        return [$pos, $flags];
    }

    /** --password <value> | --password=<value> | --password (read one line from stdin). */
    private static function password(array $flags): ?string
    {
        $p = $flags['password'] ?? null;
        if ($p === true) {
            $line = fgets(STDIN);
            $p = $line === false ? '' : rtrim($line, "\r\n");
        }
        if ($p === '') {
            throw HttpError::invalidInput('password must not be empty', '/password');
        }

        return $p;
    }

    private static function rows(mixed $v): array
    {
        return is_array($v) ? $v : throw HttpError::invalidInput('Expected a JSON object or array of objects');
    }
}
