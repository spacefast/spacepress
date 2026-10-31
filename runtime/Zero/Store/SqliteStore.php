<?php

declare(strict_types=1);

namespace Zero\Store;

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\HttpError;
use Zero\Js;
use Zero\Migrator;
use Zero\Schema;
use Zero\Source;
use Zero\Store;

/**
 * The standalone store: one SQLite file. Collections are tables named after the collection; system
 * tables (__zero_users/_tokens/_revisions/_globals/_media) are created on construction.
 */
final class SqliteStore implements Store
{
    private const SYSTEM_DDL = [
        'CREATE TABLE IF NOT EXISTS "__zero_users" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL UNIQUE, "role" text NOT NULL, "passwordHash" text, "createdAt" text NOT NULL)',
        'CREATE TABLE IF NOT EXISTS "__zero_tokens" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "name" text NOT NULL, "role" text NOT NULL, "hash" text NOT NULL UNIQUE, "createdAt" text NOT NULL, "lastUsedAt" text, "revokedAt" text)',
        'CREATE TABLE IF NOT EXISTS "__zero_revisions" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "collection" text NOT NULL, "pk" text NOT NULL, "at" text NOT NULL, "userId" integer, "row" text NOT NULL)',
        'CREATE INDEX IF NOT EXISTS "__zero_revisions_row" ON "__zero_revisions" ("collection", "pk")',
        'CREATE TABLE IF NOT EXISTS "__zero_globals" ("name" text PRIMARY KEY NOT NULL, "data" text NOT NULL, "updatedAt" text NOT NULL)',
        'CREATE TABLE IF NOT EXISTS "__zero_media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "filename" text NOT NULL, "mime" text NOT NULL, "size" integer NOT NULL, "width" integer, "height" integer, "alt" text, "path" text NOT NULL, "createdAt" text NOT NULL)',
    ];
    private const SYSTEM_TABLES = ['__zero_users', '__zero_tokens', '__zero_revisions', '__zero_globals', '__zero_media'];

    private readonly Dialect $dialect;
    private bool $inTransaction = false;
    /** @var list<callable> */
    private array $afterCommit = [];
    /** @var list<callable> */
    private array $onRollback = [];
    /** @var array<string, Source> */
    private array $sources = [];

    public function __construct(private readonly \PDO $pdo, private readonly Schema $schema)
    {
        $this->dialect = Dialect::sqlite();
        if ($pdo instanceof \Pdo\Sqlite) { // PHP 8.4+
            $pdo->createFunction('zero_like', self::like(...), 3, \Pdo\Sqlite::DETERMINISTIC);
        } else {
            $pdo->sqliteCreateFunction('zero_like', self::like(...), 3, \PDO::SQLITE_DETERMINISTIC);
        }
        $have = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('" . implode("', '", self::SYSTEM_TABLES) . "')")->fetchColumn();
        if ($have !== count(self::SYSTEM_TABLES)) {
            foreach (self::SYSTEM_DDL as $ddl) {
                $pdo->exec($ddl);
            }
        }
        \Zero\SystemTables::apply($this);
    }

    public function applySystemStatements(array $statements): void
    {
        if ($this->inTransaction) {
            throw new \LogicException('System DDL cannot run inside a transaction');
        }
        foreach ($statements as $statement) {
            $this->pdo->exec($statement);
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

    public function pdo(): \PDO
    {
        return $this->pdo;
    }

    /** Apply zero/app/migrations (standalone only). @return list<string> */
    public function migrate(string $dir): array
    {
        return (new Migrator($this->pdo, $dir))->migrate();
    }

    // ================================================================ transactions

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
        } catch (\Throwable $e) {
            try {
                $this->pdo->exec('ROLLBACK');
            } catch (\PDOException) {
                // SQLite may already have rolled back on its own.
            }
            $this->inTransaction = false;
            $undo = $this->onRollback;
            $this->afterCommit = $this->onRollback = [];
            foreach ($undo as $cb) {
                $cb();
            }
            throw $e;
        }
        $this->inTransaction = false;
        $after = $this->afterCommit;
        $this->afterCommit = $this->onRollback = [];
        foreach ($after as $cb) {
            $cb();
        }

        return $result;
    }

    /** Run $cb once the outermost transaction commits (immediately when none is open). */
    public function afterCommit(callable $cb): void
    {
        $this->inTransaction ? $this->afterCommit[] = $cb : $cb();
    }

    /** Run $cb if the open transaction rolls back (file-system side effects). */
    public function onRollback(callable $cb): void
    {
        if ($this->inTransaction) {
            $this->onRollback[] = $cb;
        }
    }

    // ================================================================ rows

    public function select(string $collection, array $q): array
    {
        $rows = $this->run($q['sql'], $q['params'])->fetchAll();
        if ($this->schema->hasCollection($collection)) {
            \Zero\Extensions::lookup($collection, array_column($rows, $this->schema->collection($collection)['primaryKey']));
        }

        return $rows;
    }

    public function insert(string $collection, array $values): int|string
    {
        $q = $this->dialect->quote(...);
        $sql = 'INSERT INTO ' . $q($collection) . ($values === []
            ? ' DEFAULT VALUES'
            : ' (' . implode(', ', array_map($q, array_keys($values))) . ') VALUES (' . self::placeholders($values) . ')');
        $this->run($sql, array_values($values));
        $pk = $this->schema->collection($collection)['primaryKey'];

        return $values[$pk] ?? (int) $this->pdo->lastInsertId();
    }

    public function update(string $collection, int|string $pk, array $values): void
    {
        if ($values === []) {
            return;
        }
        $q = $this->dialect->quote(...);
        $assign = implode(', ', array_map(static fn ($c) => $q($c) . ' = ?', array_keys($values)));
        $this->run('UPDATE ' . $q($collection) . " SET $assign WHERE " . $q($this->schema->collection($collection)['primaryKey']) . ' = ?', [...array_values($values), $pk]);
    }

    public function delete(string $collection, int|string $pk): void
    {
        $q = $this->dialect->quote(...);
        $this->run('DELETE FROM ' . $q($collection) . ' WHERE ' . $q($this->schema->collection($collection)['primaryKey']) . ' = ?', [$pk]);
    }

    public function dialect(): Dialect
    {
        return $this->dialect;
    }

    public function source(string $collection): Source
    {
        return $this->sources[$collection] ??= Source::plain(
            $this->dialect,
            $this->dialect->quote($collection),
            $collection === SqliteMedia::TABLE ? SqliteMedia::COLUMNS : $this->schema->collection($collection)['columns'],
        );
    }

    // ================================================================ globals, revisions, scheduling

    public function globalRead(string $name): ?array
    {
        $data = $this->run('SELECT "data" FROM "__zero_globals" WHERE "name" = ?', [$name])->fetchColumn();

        return $data === false ? null : json_decode((string) $data, true);
    }

    public function globalWrite(string $name, array $values): void
    {
        $this->run(
            'INSERT INTO "__zero_globals" ("name", "data", "updatedAt") VALUES (?, ?, ?) ON CONFLICT ("name") DO UPDATE SET "data" = excluded."data", "updatedAt" = excluded."updatedAt"',
            [$name, Js::jsonStringify($values), Js::iso(Js::now())],
        );
    }

    public function revisions(string $collection, int|string $pk): array
    {
        $rows = $this->run('SELECT * FROM "__zero_revisions" WHERE "collection" = ? AND "pk" = ? ORDER BY "id" DESC', [$collection, (string) $pk])->fetchAll();

        return array_map(self::revisionRow(...), $rows);
    }

    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void
    {
        $this->run(
            'INSERT INTO "__zero_revisions" ("collection", "pk", "at", "userId", "row") VALUES (?, ?, ?, ?, ?)',
            [$collection, (string) $pk, Js::iso(Js::now()), $userId, Js::jsonStringify($encodedRow)],
        );
    }

    public function revision(string $collection, int|string $pk, int $revisionId): ?array
    {
        $row = $this->run('SELECT * FROM "__zero_revisions" WHERE "collection" = ? AND "pk" = ? AND "id" = ?', [$collection, (string) $pk, $revisionId])->fetch();

        return $row === false ? null : self::revisionRow($row);
    }

    private static function revisionRow(array $r): array
    {
        return ['id' => (int) $r['id'], 'at' => (string) $r['at'], 'userId' => $r['userId'] === null ? null : (int) $r['userId'], 'row' => json_decode((string) $r['row'], true)];
    }

    public function promoteDue(string $collection, string $nowIso): array
    {
        $q = $this->dialect->quote(...);
        $pk = $q($this->schema->collection($collection)['primaryKey']);
        $where = ' WHERE "status" = \'scheduled\' AND "publishedAt" <= ?';
        $pks = $this->run("SELECT $pk FROM " . $q($collection) . $where, [$nowIso])->fetchAll(\PDO::FETCH_COLUMN);
        if ($pks !== []) {
            $this->run('UPDATE ' . $q($collection) . " SET \"status\" = 'published'" . $where, [$nowIso]);
        }

        return $pks;
    }

    public function mapError(\Throwable $e): \Throwable
    {
        if (!$e instanceof \PDOException) {
            return $e;
        }
        $msg = $e->getMessage();
        if (preg_match('/UNIQUE constraint failed: ([^\s]+(?:, [^\s]+)*)/', $msg, $m)) {
            $cols = array_map(static fn ($c) => substr($c, strrpos($c, '.') + 1), explode(', ', $m[1]));

            return new HttpError(409, 'unique_violation', 'A row with this ' . implode(', ', $cols) . ' already exists', count($cols) === 1 ? HttpError::seg($cols[0]) : null);
        }
        if (str_contains($msg, 'FOREIGN KEY constraint failed')) {
            return new HttpError(409, 'reference_violation', 'This change would break a reference between rows');
        }
        if (preg_match('/NOT NULL constraint failed: \S+\.(\S+)/', $msg, $m)) {
            return HttpError::invalidInput("{$m[1]} is required", HttpError::seg($m[1]));
        }
        if (str_contains($msg, 'CHECK constraint failed')) {
            return HttpError::invalidInput('A check constraint failed');
        }

        return $e;
    }

    // ================================================================ helpers

    /** Execute a statement with positional params. */
    public function run(string $sql, array $params = []): \PDOStatement
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

    private static function placeholders(array $values): string
    {
        return implode(', ', array_fill(0, count($values), '?'));
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
}
