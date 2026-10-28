<?php

declare(strict_types=1);

namespace Zero;

/** Boots a generated app and serves its REST API and CLI. */
final class App
{
    private const LIST_LIMIT = 50;
    private const MAX_LIST_LIMIT = 200;
    private const CORS = [
        'Access-Control-Allow-Origin' => '*',
        'Access-Control-Allow-Methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers' => 'content-type',
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
        'internal' => 'Internal error',
    ];

    private function __construct(
        public readonly string $root,
        public readonly Schema $schema,
        public readonly Db $db,
    ) {
    }

    /** @param ?bool $migrate null = apply pending migrations unless ZERO_AUTO_MIGRATE=0 */
    public static function boot(string $appRoot, ?bool $migrate = null): self
    {
        $schema = Schema::load($appRoot . '/zero/app/schema.php');
        $functions = $appRoot . '/zero/app/functions.php';
        if (is_file($functions)) {
            require_once $functions;
        }
        $path = getenv('ZERO_DB_PATH') ?: $appRoot . '/data/zero.sqlite';
        $db = new Db(Db::connect($path), $schema);
        Db::setInstance($db);
        $app = new self($appRoot, $schema, $db);
        if ($migrate ?? getenv('ZERO_AUTO_MIGRATE') !== '0') {
            $app->migrate();
        }

        return $app;
    }

    /** @return list<string> applied migration ids */
    public function migrate(): array
    {
        return (new Migrator($this->db->pdo(), $this->root . '/zero/app/migrations'))->migrate();
    }

    /** Validate input against an action's schema and run its handler. */
    public function runAction(string $name, mixed $input): mixed
    {
        $action = $this->schema->action($name);
        $input = Schema::validateInput($action['input'] ?? [], $input);
        $fn = '\\ZeroApp\\' . $action['handler'];

        return $fn($input);
    }

    // ================================================================ HTTP

    public function handleHttp(): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $query = [];
        parse_str((string) parse_url($uri, PHP_URL_QUERY), $query);
        [$status, $headers, $body] = $this->handle($method, (string) parse_url($uri, PHP_URL_PATH), $query, (string) file_get_contents('php://input'));
        http_response_code($status);
        foreach ($headers as $name => $value) {
            header("$name: $value");
        }
        echo $body;
    }

    /**
     * @param array<string, mixed> $query
     * @return array{int, array<string, string>, string}
     */
    public function handle(string $method, string $path, array $query, string $body): array
    {
        if ($method === 'OPTIONS') {
            return [204, self::CORS, ''];
        }
        try {
            [$status, $data] = $this->db->transaction(fn () => $this->route($method, $path, $query, $body));

            return [$status, ['Content-Type' => 'application/json'] + self::CORS, Js::jsonStringify(['data' => $data]) ?? '{}'];
        } catch (\Throwable $e) {
            $problem = self::problem($e);

            return [$problem['status'], ['Content-Type' => 'application/problem+json'] + self::CORS, Js::jsonStringify($problem) ?? '{}'];
        }
    }

    /** @return array{int, mixed} */
    private function route(string $method, string $path, array $query, string $body): array
    {
        $segments = array_map('rawurldecode', array_values(array_filter(explode('/', $path), static fn ($s) => $s !== '')));
        if (($segments[0] ?? '') !== 'api' || count($segments) < 2 || count($segments) > 3) {
            throw HttpError::notFound("No route for $path");
        }
        [, $name, $id] = $segments + [2 => null];

        if ($name === '_schema' && $id === null) {
            self::allow($method, ['GET']);

            return [200, $this->schema->describe()];
        }
        // A collection literally named "actions" only loses the ids that are action names.
        if ($name === 'actions' && $id !== null
            && (!$this->schema->hasCollection('actions') || isset($this->schema->actions()[$id]))) {
            self::allow($method, ['POST']);

            return [200, $this->runAction($id, self::parseBody($body))];
        }
        if (!$this->schema->hasCollection($name)) {
            throw HttpError::notFound("Unknown collection '$name'");
        }
        $spec = $this->schema->collection($name);

        if ($id === null) {
            self::allow($method, ['GET', 'POST']);
            if ($method === 'GET') {
                $this->gate($spec, 'list');

                return [200, $this->db->findMany($name, self::listOptions($query))];
            }
            $this->gate($spec, 'create');
            $data = self::parseBody($body);
            if (array_is_list($data) && $data !== []) {
                throw HttpError::invalidInput('Body must be a JSON object', '');
            }

            return [201, $this->db->insert($name, $data, true)[0]];
        }

        self::allow($method, ['GET', 'PATCH', 'DELETE']);
        $this->gate($spec, ['GET' => 'get', 'PATCH' => 'update', 'DELETE' => 'delete'][$method]);
        $where = [$spec['primaryKey'] => $this->pkFromPath($spec, $id)];
        $opts = ['where' => $where];
        if ($method === 'GET' && isset($query['with'])) {
            $opts['with'] = self::withOption($query['with']);
        }
        $row = $this->db->findFirst($name, $opts) ?? throw HttpError::notFound("No $name row with {$spec['primaryKey']} $id");

        return match ($method) {
            'GET' => [200, $row],
            'PATCH' => [200, $this->db->update($name, self::object(self::parseBody($body)), $where, true)[0] ?? $row],
            'DELETE' => [200, $this->db->delete($name, $where, true)[0] ?? $row],
        };
    }

    private static function allow(string $method, array $allowed): void
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

    private static function listOptions(array $query): array
    {
        $opts = ['limit' => min(self::queryInt($query, 'limit') ?? self::LIST_LIMIT, self::MAX_LIST_LIMIT)];
        if (isset($query['where'])) {
            $opts['where'] = self::queryJson($query['where'], '/where');
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

        return $opts;
    }

    private static function withOption(mixed $value): array
    {
        $names = array_filter(array_map('trim', explode(',', self::queryString($value, '/with'))), static fn ($s) => $s !== '');

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
            return json_decode(self::queryString($value, $ptr), true, 512, JSON_THROW_ON_ERROR);
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
            return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage());
        }
    }

    private static function object(mixed $v): array
    {
        if (!is_array($v) || ($v !== [] && array_is_list($v))) {
            throw HttpError::invalidInput('Body must be a JSON object', '');
        }

        return $v;
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
            405 => 'Method not allowed', 409 => 'Conflict', 422 => 'Unprocessable content',
            429 => 'Too many requests', 500 => 'Internal error', default => 'Error',
        };
    }

    // ================================================================ CLI

    /**
     * Run a CLI command. Returns [exit code, stdout JSON].
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

    private function cliCommand(array $args): mixed
    {
        $cmd = $args[0] ?? '';
        $json = static function (int $i, bool $required = true) use ($args): mixed {
            if (!isset($args[$i])) {
                return $required ? throw HttpError::invalidInput('Missing JSON argument ' . $i) : null;
            }

            return self::parseBody($args[$i]);
        };
        if ($cmd === 'migrate') {
            return ['applied' => $this->migrate()];
        }
        $usage = 'Usage: zero.php migrate | action <name> [json] | find <collection> [opts] | insert <collection> <json>'
            . ' | update <collection> <where> <set> | delete <collection> <where>';
        if (!in_array($cmd, ['action', 'find', 'insert', 'update', 'delete'], true) || !isset($args[1])) {
            throw new HttpError(400, 'invalid_command', $usage);
        }
        $name = $args[1];

        return $this->db->transaction(fn () => match ($cmd) {
            'action' => $this->runAction($name, $json(2, false)),
            'find' => $this->db->findMany($name, self::object($json(2, false) ?? [])),
            'insert' => $this->db->insert($name, self::rows($json(2)), true),
            'update' => $this->db->update($name, self::object($json(3)), self::object($json(2)), true),
            'delete' => $this->db->delete($name, self::object($json(2)), true),
        });
    }

    private static function rows(mixed $v): array
    {
        return is_array($v) ? $v : throw HttpError::invalidInput('Expected a JSON object or array of objects');
    }
}
