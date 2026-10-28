<?php

declare(strict_types=1);

namespace Zero;

/**
 * Query + write pipeline over SQLite. Every write (REST, CLI, hooks, actions)
 * goes through insert/update/delete so defaults, coercion, and hooks always run.
 */
final class Db
{
    private const MAX_HOOK_DEPTH = 8;
    private const CMP = ['eq' => '=', 'ne' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='];
    private const QUERY_OPTS = ['where', 'orderBy', 'limit', 'offset', 'columns', 'with'];

    private static ?self $instance = null;

    private int $depth = 0;
    private bool $inTransaction = false;
    private int $aliases = 0;

    public function __construct(private readonly \PDO $pdo, private readonly Schema $schema)
    {
        if ($pdo instanceof \Pdo\Sqlite) { // PHP 8.4+
            $pdo->createFunction('zero_like', self::like(...), 3, \Pdo\Sqlite::DETERMINISTIC);
        } else {
            $pdo->sqliteCreateFunction('zero_like', self::like(...), 3, \PDO::SQLITE_DETERMINISTIC);
        }
    }

    /** Open (and configure) a SQLite connection. */
    public static function connect(string $path): \PDO
    {
        $dir = dirname($path);
        if ($path !== ':memory:' && !is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException("Cannot create database directory $dir");
        }
        $dsn = 'sqlite:' . $path;
        $pdo = class_exists(\Pdo\Sqlite::class) ? \Pdo\Sqlite::connect($dsn) : new \PDO($dsn);
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
        $pdo->setAttribute(\PDO::ATTR_STRINGIFY_FETCHES, false);
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');

        return $pdo;
    }

    public static function setInstance(self $db): void
    {
        self::$instance = $db;
    }

    public static function instance(): self
    {
        return self::$instance ?? throw new \LogicException('Zero\Db is not initialised; call App::boot() first');
    }

    public function pdo(): \PDO
    {
        return $this->pdo;
    }

    public function schema(): Schema
    {
        return $this->schema;
    }

    /** Run $fn in one BEGIN IMMEDIATE transaction (joins an open one). Any throwable rolls back. */
    public function transaction(callable $fn): mixed
    {
        if ($this->inTransaction) {
            return $fn();
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        $this->inTransaction = true;
        try {
            $result = $fn();
            $this->pdo->exec('COMMIT');

            return $result;
        } catch (\Throwable $e) {
            try {
                $this->pdo->exec('ROLLBACK');
            } catch (\PDOException) {
                // SQLite may already have rolled back on its own.
            }
            throw $e;
        } finally {
            $this->inTransaction = false;
        }
    }

    // ================================================================ reads

    /** @return list<array> */
    public function findMany(string $collection, array $opts = []): array
    {
        return $this->project($this->fetch($collection, $opts, ''), $collection, $opts, '');
    }

    public function findFirst(string $collection, array $opts = []): ?array
    {
        return $this->findMany($collection, ['limit' => 1] + $opts)[0] ?? null;
    }

    /**
     * Full decoded rows (relations from `with` attached, `columns` not yet applied).
     * With $partition = [column, values], rows are restricted to column IN values and
     * limit/offset apply per distinct column value.
     *
     * @param ?array{string, list<mixed>} $partition
     * @return list<array>
     */
    private function fetch(string $collection, array $opts, string $ptr, ?array $partition = null): array
    {
        $spec = $this->collectionSpec($collection, $ptr);
        foreach ($opts as $k => $_) {
            if (!in_array($k, self::QUERY_OPTS, true)) {
                throw HttpError::invalidQuery("Unknown query option '$k'", $ptr . HttpError::seg($k));
            }
        }
        $alias = $this->alias();
        $params = [];
        $conds = [];
        if (isset($opts['where'])) {
            $conds[] = $this->filter($collection, $opts['where'], $alias, $ptr . '/where', $params);
        }
        if ($partition !== null) {
            [$col, $values] = $partition;
            if ($values === []) {
                return [];
            }
            $conds[] = "$alias." . self::q($col) . ' IN (' . self::placeholders($values) . ')';
            array_push($params, ...$values);
        }
        $order = $this->orderBy($spec, $opts['orderBy'] ?? [], $ptr . '/orderBy');
        $limit = self::count($opts, 'limit', $ptr);
        $offset = self::count($opts, 'offset', $ptr);

        $from = ' FROM ' . self::q($collection) . ' ' . $alias . ($conds === [] ? '' : ' WHERE ' . implode(' AND ', $conds));
        if ($partition !== null && ($limit !== null || $offset !== null)) {
            // Per-parent limit/offset in one query: number rows within each parent key.
            $window = $order !== [] ? $order : [[self::q($spec['primaryKey']), 'ASC']];
            $over = 'PARTITION BY ' . $alias . '.' . self::q($partition[0]) . ' ORDER BY ' . self::orderSql($window, $alias . '.');
            $sql = "SELECT * FROM (SELECT $alias.*, ROW_NUMBER() OVER ($over) AS __zero_rn$from)"
                . ' WHERE __zero_rn > ' . ($offset ?? 0)
                . ($limit === null ? '' : ' AND __zero_rn <= ' . (($offset ?? 0) + $limit))
                . ($order === [] ? '' : ' ORDER BY ' . self::orderSql($order, ''));
        } else {
            $sql = "SELECT $alias.*$from" . ($order === [] ? '' : ' ORDER BY ' . self::orderSql($order, $alias . '.'));
            if ($limit !== null || $offset !== null) {
                $sql .= ' LIMIT ' . ($limit ?? -1) . ' OFFSET ' . ($offset ?? 0);
            }
        }

        $rows = array_map(
            static fn (array $raw) => Schema::decodeRow($spec['columns'], $raw),
            $this->run($sql, $params)->fetchAll(),
        );
        if (isset($opts['with']) && $rows !== []) {
            $rows = $this->attach($collection, $rows, $opts['with'], $ptr . '/with');
        }

        return $rows;
    }

    /** Load each requested relation with one query, never N+1. */
    private function attach(string $collection, array $rows, mixed $with, string $ptr): array
    {
        if (!is_array($with) || ($with !== [] && array_is_list($with))) {
            throw HttpError::invalidQuery('with must be an object', $ptr);
        }
        $relations = $this->schema->collection($collection)['relations'] ?? [];
        foreach ($with as $name => $opts) {
            $rptr = $ptr . HttpError::seg($name);
            $rel = $relations[$name] ?? throw HttpError::invalidQuery("Unknown relation '$name'", $rptr);
            if ($opts === false || $opts === null) {
                continue;
            }
            $opts = $opts === true ? [] : $opts;
            if (!is_array($opts)) {
                throw HttpError::invalidQuery('Relation options must be true or an object', $rptr);
            }
            $keys = [];
            foreach ($rows as $row) {
                if ($row[$rel['from']] !== null) {
                    $keys[self::key($row[$rel['from']])] = $row[$rel['from']];
                }
            }
            $targetCols = $this->schema->collection($rel['collection'])['columns'];
            $values = array_map(
                static fn ($v) => Schema::encode(['type' => $targetCols[$rel['to']]['type']], $v, $rel['to'], ''),
                array_values($keys),
            );
            $children = $this->fetch($rel['collection'], $opts, $rptr, [$rel['to'], $values]);
            $groups = [];
            foreach ($this->project($children, $rel['collection'], $opts, $rptr) as $i => $child) {
                $groups[self::key($children[$i][$rel['to']])][] = $child;
            }
            foreach ($rows as &$row) {
                $group = $row[$rel['from']] === null ? [] : ($groups[self::key($row[$rel['from']])] ?? []);
                $row[$name] = $rel['kind'] === 'many' ? $group : ($group[0] ?? null);
            }
            unset($row);
        }

        return $rows;
    }

    /** Apply the Drizzle `columns` selection (relations attached by `with` are kept). */
    private function project(array $rows, string $collection, array $opts, string $ptr): array
    {
        $columns = $opts['columns'] ?? null;
        if ($columns === null) {
            return $rows;
        }
        $known = $this->schema->collection($collection)['columns'];
        if (!is_array($columns) || ($columns !== [] && array_is_list($columns))) {
            throw HttpError::invalidQuery('columns must be an object', $ptr . '/columns');
        }
        foreach ($columns as $name => $on) {
            if (!isset($known[$name])) {
                throw HttpError::invalidQuery("Unknown column '$name'", $ptr . '/columns' . HttpError::seg($name));
            }
        }
        $included = array_keys(array_filter($columns, static fn ($on) => $on === true));
        $drop = $included !== []
            ? array_diff(array_keys($known), $included)
            : array_keys(array_filter($columns, static fn ($on) => $on === false));
        $drop = array_flip($drop);

        return array_map(static fn (array $row) => array_diff_key($row, $drop), $rows);
    }

    /** @return list<array{string, string}> [quoted column, ASC|DESC] */
    private function orderBy(array $spec, mixed $orderBy, string $ptr): array
    {
        if (!is_array($orderBy)) {
            throw HttpError::invalidQuery('orderBy must be an object', $ptr);
        }
        $out = [];
        foreach ($orderBy as $col => $dir) {
            if (!isset($spec['columns'][$col])) {
                throw HttpError::invalidQuery("Unknown column '$col'", $ptr . HttpError::seg($col));
            }
            if ($dir !== 'asc' && $dir !== 'desc') {
                throw HttpError::invalidQuery("orderBy direction must be 'asc' or 'desc'", $ptr . HttpError::seg($col));
            }
            $out[] = [self::q((string) $col), strtoupper($dir)];
        }

        return $out;
    }

    /** @param list<array{string, string}> $order */
    private static function orderSql(array $order, string $prefix): string
    {
        return implode(', ', array_map(static fn ($o) => $prefix . $o[0] . ' ' . $o[1], $order));
    }

    private static function count(array $opts, string $key, string $ptr): ?int
    {
        $v = $opts[$key] ?? null;
        if ($v === null) {
            return null;
        }
        if (!Js::isInteger($v) || $v < 0) {
            throw HttpError::invalidQuery("$key must be a non-negative integer", $ptr . '/' . $key);
        }

        return (int) $v;
    }

    // ================================================================ filters

    /** Compile a filter object into SQL against table alias $alias, appending bound values. */
    private function filter(string $collection, mixed $where, string $alias, string $ptr, array &$params): string
    {
        if (!is_array($where) || ($where !== [] && array_is_list($where))) {
            throw HttpError::invalidQuery('Filter must be an object', $ptr);
        }
        $spec = $this->schema->collection($collection);
        $parts = [];
        foreach ($where as $key => $value) {
            $kptr = $ptr . HttpError::seg($key);
            $key = (string) $key;
            if ($key === 'OR' || $key === 'AND') {
                $parts[] = $this->combine($key, $value, $kptr, function ($f, $p) use ($collection, $alias, &$params) {
                    return $this->filter($collection, $f, $alias, $p, $params);
                });
            } elseif ($key === 'NOT') {
                $parts[] = 'NOT (' . $this->filter($collection, $value, $alias, $kptr, $params) . ')';
            } elseif (isset($spec['columns'][$key])) {
                $parts[] = $this->fieldFilter($spec['columns'][$key], "$alias." . self::q($key), $value, $kptr, $params);
            } elseif (isset($spec['relations'][$key])) {
                $parts[] = $this->relationFilter($collection, $spec['relations'][$key], $value, $alias, $kptr, $params);
            } else {
                throw HttpError::invalidQuery("Unknown column or relation '$key'", $kptr);
            }
        }

        return $parts === [] ? '1' : implode(' AND ', $parts);
    }

    private function combine(string $op, mixed $list, string $ptr, callable $compile): string
    {
        if (!is_array($list) || !array_is_list($list)) {
            throw HttpError::invalidQuery("$op must be an array", $ptr);
        }
        if ($list === []) {
            return $op === 'OR' ? '0' : '1';
        }
        $sql = [];
        foreach ($list as $i => $f) {
            $sql[] = '(' . $compile($f, $ptr . '/' . $i) . ')';
        }

        return '(' . implode(" $op ", $sql) . ')';
    }

    private function fieldFilter(array $col, string $sqlCol, mixed $value, string $ptr, array &$params): string
    {
        if ($value === null) {
            return "$sqlCol IS NULL";
        }
        if (!is_array($value)) {
            return $this->compare($col, $sqlCol, 'eq', $value, $ptr, $params);
        }
        if ($value === [] || array_is_list($value)) {
            throw HttpError::invalidQuery('Field filter must be a value or an operator object', $ptr);
        }
        $parts = [];
        foreach ($value as $op => $arg) {
            $optr = $ptr . HttpError::seg($op);
            $parts[] = match ($op) {
                'eq', 'ne', 'gt', 'gte', 'lt', 'lte' => $this->compare($col, $sqlCol, $op, $arg, $optr, $params),
                'in', 'notIn' => $this->inList($col, $sqlCol, $op === 'notIn', $arg, $optr, $params),
                'like', 'notLike', 'ilike', 'notIlike' => $this->likeFilter($sqlCol, $op, $arg, $optr, $params),
                'isNull', 'isNotNull' => ($op === 'isNull') === Js::truthy($arg) ? "$sqlCol IS NULL" : "$sqlCol IS NOT NULL",
                'NOT' => 'NOT (' . $this->fieldFilter($col, $sqlCol, $arg, $optr, $params) . ')',
                'OR', 'AND' => $this->combine($op, $arg, $optr, function ($f, $p) use ($col, $sqlCol, &$params) {
                    return $this->fieldFilter($col, $sqlCol, $f, $p, $params);
                }),
                default => throw HttpError::invalidQuery("Unknown operator '$op'", $optr),
            };
        }

        return implode(' AND ', $parts);
    }

    private function compare(array $col, string $sqlCol, string $op, mixed $arg, string $ptr, array &$params): string
    {
        if ($arg === null) {
            return match ($op) {
                'eq' => "$sqlCol IS NULL",
                'ne' => "$sqlCol IS NOT NULL",
                default => throw HttpError::invalidQuery("$op does not accept null", $ptr),
            };
        }
        $params[] = $this->filterValue($col, $arg, $ptr);

        return "$sqlCol " . self::CMP[$op] . ' ?';
    }

    private function inList(array $col, string $sqlCol, bool $negate, mixed $list, string $ptr, array &$params): string
    {
        if (!is_array($list) || !array_is_list($list)) {
            throw HttpError::invalidQuery('Expected an array', $ptr);
        }
        if ($list === []) {
            return $negate ? '1' : '0';
        }
        foreach ($list as $i => $v) {
            $params[] = $this->filterValue($col, $v, $ptr . '/' . $i);
        }

        return $sqlCol . ($negate ? ' NOT IN (' : ' IN (') . self::placeholders($list) . ')';
    }

    private function likeFilter(string $sqlCol, string $op, mixed $pattern, string $ptr, array &$params): string
    {
        if (!is_string($pattern)) {
            throw HttpError::invalidQuery("$op expects a string pattern", $ptr);
        }
        $params[] = $pattern;
        $ci = $op === 'ilike' || $op === 'notIlike' ? 1 : 0;
        $sql = "zero_like($sqlCol, ?, $ci)";

        return str_starts_with($op, 'not') ? "NOT $sql" : $sql;
    }

    private function relationFilter(string $collection, array $rel, mixed $value, string $alias, string $ptr, array &$params): string
    {
        $inner = $this->alias();
        $sql = 'EXISTS (SELECT 1 FROM ' . self::q($rel['collection']) . " $inner WHERE $inner." . self::q($rel['to'])
            . " = $alias." . self::q($rel['from']);
        if ($value === false) {
            return 'NOT ' . $sql . ')';
        }
        if ($value !== true) {
            $sql .= ' AND ' . $this->filter($rel['collection'], $value, $inner, $ptr, $params);
        }

        return $sql . ')';
    }

    private function filterValue(array $col, mixed $v, string $ptr): int|float|string|null
    {
        unset($col['enum'], $col['notNull']);
        try {
            return Schema::encode($col, $v, ltrim(strrchr($ptr, '/') ?: $ptr, '/'), $ptr);
        } catch (HttpError $e) {
            throw HttpError::invalidQuery($e->getMessage(), $ptr);
        }
    }

    /** SQL LIKE with PostgreSQL semantics: `%`, `_`, backslash escapes; case-sensitive unless $ci. */
    private static function like(mixed $value, mixed $pattern, int $ci): ?int
    {
        static $cache = [];
        if ($value === null || $pattern === null) {
            return null;
        }
        $re = $cache[$ci . $pattern] ??= '/^' . preg_replace_callback(
            '/\\\\(.)|%|_|[^%_\\\\]+|\\\\$/su',
            static fn (array $m) => match (true) {
                $m[0] === '%' => '.*',
                $m[0] === '_' => '.',
                isset($m[1]) && $m[1] !== '' => preg_quote($m[1], '/'),
                default => preg_quote($m[0], '/'),
            },
            (string) $pattern,
        ) . '$/sDu' . ($ci ? 'i' : '');

        return (int) preg_match($re, is_float($value) ? Js::numStr($value) : (string) $value);
    }

    // ================================================================ writes

    /** @return ?list<array> */
    public function insert(string $collection, array $values, bool $returning = false): ?array
    {
        $rows = $values !== [] && array_is_list($values) ? $values : [$values];

        return $this->nested(function () use ($collection, $rows, $returning) {
            $spec = $this->schema->collection($collection);
            $out = [];
            foreach ($rows as $data) {
                if (!is_array($data) || ($data !== [] && array_is_list($data))) {
                    throw HttpError::invalidInput('Each row must be an object', '');
                }
                $out[] = $this->createOne($collection, $spec, $data);
            }

            return $returning ? $out : null;
        });
    }

    /** @return ?list<array> */
    public function update(string $collection, array $set, array $where, bool $returning = false): ?array
    {
        return $this->nested(function () use ($collection, $set, $where, $returning) {
            $spec = $this->schema->collection($collection);
            $out = [];
            foreach ($this->fetch($collection, ['where' => $where], '') as $existing) {
                $out[] = $this->updateOne($collection, $spec, $existing, $set);
            }

            return $returning ? $out : null;
        });
    }

    /** @return ?list<array> */
    public function delete(string $collection, array $where, bool $returning = false): ?array
    {
        return $this->nested(function () use ($collection, $where, $returning) {
            $spec = $this->schema->collection($collection);
            $hooks = $spec['hooks'] ?? [];
            $rows = $this->fetch($collection, ['where' => $where], '');
            foreach ($rows as $row) {
                $this->hook($hooks, 'beforeDelete', $row);
                $this->write('DELETE FROM ' . self::q($collection) . ' WHERE ' . self::q($spec['primaryKey']) . ' = ?', [$this->pkValue($spec, $row)]);
                $this->hook($hooks, 'afterDelete', $row);
            }

            return $returning ? $rows : null;
        });
    }

    private function createOne(string $collection, array $spec, array $data): array
    {
        $columns = $spec['columns'];
        $this->rejectUnknown($columns, $data);
        foreach ($columns as $name => $col) {
            if (!array_key_exists($name, $data) && isset($col['default'])) {
                $data[$name] = Schema::generate($col['default'], $col['type']);
            }
        }
        $fills = $spec['beforeCreateFills'] ?? [];
        foreach ($columns as $name => $col) {
            if (Schema::isRequired($col) && !array_key_exists($name, $data) && !in_array($name, $fills, true)) {
                throw HttpError::invalidInput("$name is required", HttpError::seg($name));
            }
        }
        if (isset($spec['hooks']['beforeCreate'])) {
            $fn = '\\ZeroApp\\' . $spec['hooks']['beforeCreate'];
            $r = $fn($data);
            if (is_array($r)) {
                $data = $r;
            }
            $this->rejectUnknown($columns, $data);
        }
        $insert = [];
        foreach ($columns as $name => $col) {
            if (array_key_exists($name, $data)) {
                $insert[$name] = Schema::encode($col, $data[$name], $name, HttpError::seg($name));
            } elseif (Schema::isRequired($col)) {
                throw HttpError::invalidInput("$name is required", HttpError::seg($name));
            }
        }
        $sql = 'INSERT INTO ' . self::q($collection) . ($insert === []
            ? ' DEFAULT VALUES'
            : ' (' . implode(', ', array_map(self::q(...), array_keys($insert))) . ') VALUES (' . self::placeholders($insert) . ')');
        $this->write($sql, array_values($insert));

        $pk = $spec['primaryKey'];
        $pkValue = $insert[$pk] ?? (int) $this->pdo->lastInsertId();
        $row = $this->readByPk($collection, $spec, $pkValue);
        $this->hook($spec['hooks'] ?? [], 'afterCreate', $row);

        return $row;
    }

    private function updateOne(string $collection, array $spec, array $existing, array $patch): array
    {
        $columns = $spec['columns'];
        $pk = $spec['primaryKey'];
        $this->checkPatch($spec, $existing, $patch);
        foreach ($columns as $name => $col) {
            if (isset($col['onUpdate']) && !array_key_exists($name, $patch)) {
                $patch[$name] = Schema::generate($col['onUpdate'], $col['type']);
            }
        }
        $previous = $existing;
        if (isset($spec['hooks']['beforeUpdate'])) {
            $fn = '\\ZeroApp\\' . $spec['hooks']['beforeUpdate'];
            $r = $fn($patch, $existing);
            if (is_array($r)) {
                $patch = $r;
            }
            $this->checkPatch($spec, $previous, $patch);
        }
        unset($patch[$pk]);
        $set = [];
        foreach ($patch as $name => $value) {
            $set[$name] = Schema::encode($columns[$name], $value, $name, HttpError::seg($name));
        }
        $pkValue = $this->pkValue($spec, $previous);
        if ($set !== []) {
            $assign = implode(', ', array_map(static fn ($c) => self::q($c) . ' = ?', array_keys($set)));
            $this->write('UPDATE ' . self::q($collection) . " SET $assign WHERE " . self::q($pk) . ' = ?', [...array_values($set), $pkValue]);
        }
        $row = $this->readByPk($collection, $spec, $pkValue);
        $this->hook($spec['hooks'] ?? [], 'afterUpdate', $row, $previous);

        return $row;
    }

    private function rejectUnknown(array $columns, array $data): void
    {
        foreach ($data as $key => $_) {
            if (!isset($columns[$key])) {
                throw HttpError::invalidInput("Unknown field '$key'", HttpError::seg($key));
            }
        }
    }

    private function checkPatch(array $spec, array $existing, array $patch): void
    {
        $this->rejectUnknown($spec['columns'], $patch);
        $pk = $spec['primaryKey'];
        if (array_key_exists($pk, $patch) && !Js::strictEq($patch[$pk], $existing[$pk])) {
            throw HttpError::invalidInput('The primary key cannot be changed', HttpError::seg($pk));
        }
    }

    /** Call a hook that receives rows (afterCreate/afterUpdate/before|afterDelete); result ignored. */
    private function hook(array $hooks, string $name, array $row, ?array $previous = null): void
    {
        if (!isset($hooks[$name])) {
            return;
        }
        $fn = '\\ZeroApp\\' . $hooks[$name];
        if ($previous === null) {
            $fn($row);
        } else {
            $fn($row, $previous);
        }
    }

    private function readByPk(string $collection, array $spec, int|float|string $pk): array
    {
        $raw = $this->run('SELECT * FROM ' . self::q($collection) . ' WHERE ' . self::q($spec['primaryKey']) . ' = ?', [$pk])->fetch();
        if ($raw === false) {
            throw new \RuntimeException("Row $collection/$pk vanished after write");
        }

        return Schema::decodeRow($spec['columns'], $raw);
    }

    private function pkValue(array $spec, array $row): int|float|string
    {
        $pk = $spec['primaryKey'];

        return Schema::encode($spec['columns'][$pk], $row[$pk], $pk, HttpError::seg($pk));
    }

    private function nested(callable $fn): mixed
    {
        if ($this->depth >= self::MAX_HOOK_DEPTH + 1) {
            throw new HttpError(500, 'hook_recursion', 'Hooks nested writes more than ' . self::MAX_HOOK_DEPTH . ' levels deep');
        }
        $this->depth++;
        try {
            return $fn();
        } finally {
            $this->depth--;
        }
    }

    /** Execute a write, mapping SQLite constraint failures onto problem codes. */
    private function write(string $sql, array $params): void
    {
        try {
            $this->run($sql, $params);
        } catch (\PDOException $e) {
            $msg = $e->getMessage();
            if (preg_match('/UNIQUE constraint failed: ([^\s]+(?:, [^\s]+)*)/', $msg, $m)) {
                $cols = array_map(static fn ($c) => substr($c, strrpos($c, '.') + 1), explode(', ', $m[1]));
                throw new HttpError(409, 'unique_violation', 'A row with this ' . implode(', ', $cols) . ' already exists', count($cols) === 1 ? HttpError::seg($cols[0]) : null);
            }
            if (str_contains($msg, 'FOREIGN KEY constraint failed')) {
                throw new HttpError(409, 'reference_violation', 'This change would break a reference between rows');
            }
            if (preg_match('/NOT NULL constraint failed: \S+\.(\S+)/', $msg, $m)) {
                throw HttpError::invalidInput("{$m[1]} is required", HttpError::seg($m[1]));
            }
            if (str_contains($msg, 'CHECK constraint failed')) {
                throw HttpError::invalidInput('A check constraint failed');
            }
            throw $e;
        }
    }

    private function run(string $sql, array $params): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $stmt->bindValue($i + 1, $v, match (true) {
                $v === null => \PDO::PARAM_NULL,
                is_int($v) => \PDO::PARAM_INT,
                default => \PDO::PARAM_STR,
            });
        }
        $stmt->execute();

        return $stmt;
    }

    // ================================================================ helpers

    private function collectionSpec(string $collection, string $ptr): array
    {
        if (!$this->schema->hasCollection($collection)) {
            throw HttpError::invalidQuery("Unknown collection '$collection'", $ptr === '' ? null : $ptr);
        }

        return $this->schema->collection($collection);
    }

    private function alias(): string
    {
        return 't' . $this->aliases++;
    }

    public static function q(string $ident): string
    {
        return '"' . str_replace('"', '""', $ident) . '"';
    }

    private static function placeholders(array $values): string
    {
        return implode(', ', array_fill(0, count($values), '?'));
    }

    private static function key(mixed $v): string
    {
        return is_string($v) ? 's' . $v : 'n' . Js::str($v);
    }
}

function db(): Db
{
    return Db::instance();
}
