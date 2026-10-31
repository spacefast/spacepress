<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * The one MySQL connection both WP stores share: WordPress's own `$wpdb` handle, so core writes
 * (`wp_insert_post`, `update_field`, options, cron) and Zero's SQL commit or roll back together.
 *
 * Compiled SQL (Sql::select) is executed as a real mysqli prepared statement, never through
 * `$wpdb->prepare()` (the §3.5.1 expressions contain `%` in DATE_FORMAT patterns).
 *
 * MySQL can't roll back object caches, so every post and option touched inside a transaction is
 * recorded and its cache cleaned when the transaction rolls back (§3.3).
 */
final class Connection
{
    private int $depth = 0;
    /** Core writes in flight: editor-save hooks ignore posts Zero itself is writing (§4.9). */
    private int $busy = 0;
    /** @var array<int, true> */
    private array $touchedPosts = [];
    /** @var array<string, true> */
    private array $touchedOptions = [];
    /** @var list<callable> */
    private array $afterCommit = [];
    /** @var list<callable> */
    private array $onRollback = [];

    public function __construct(private readonly \wpdb $wpdb)
    {
    }

    public function wpdb(): \wpdb
    {
        return $this->wpdb;
    }

    public function prefix(): string
    {
        return $this->wpdb->prefix;
    }

    /** `utf8mb4_unicode_ci` on MariaDB and MySQL 5.7, `utf8mb4_0900_ai_ci` on MySQL 8+ (§3.5 `ilike`). */
    public function ciCollation(): string
    {
        $info = (string) $this->wpdb->db_server_info();
        if (stripos($info, 'mariadb') !== false) {
            return 'utf8mb4_unicode_ci';
        }

        return version_compare((string) $this->wpdb->db_version(), '8.0', '>=') ? 'utf8mb4_0900_ai_ci' : 'utf8mb4_unicode_ci';
    }

    // ================================================================ statements

    /**
     * Run one statement with positional `?` params. Returns rows for result-producing statements,
     * [] otherwise.
     *
     * @param list<int|float|string|null> $params
     * @return list<array<string, mixed>>
     */
    public function run(string $sql, array $params = []): array
    {
        $mysqli = $this->mysqli();
        $stmt = $mysqli->prepare($sql);
        if ($stmt === false) {
            throw new DbError($mysqli->error . ' [' . $sql . ']', $mysqli->errno);
        }
        try {
            $values = array_map(static fn ($v) => is_float($v) ? \Zero\Js::numStr($v) : $v, array_values($params));
            if (!$stmt->execute($values === [] ? null : $values)) {
                throw new DbError($stmt->error, $stmt->errno);
            }
            $result = $stmt->get_result();

            return $result === false ? [] : $result->fetch_all(MYSQLI_ASSOC);
        } finally {
            $stmt->close();
        }
    }

    /** @param list<string> $statements idempotent DDL outside request transactions */
    public function applySystemStatements(array $statements): void
    {
        if ($this->inTransaction()) {
            throw new \LogicException('System DDL cannot run inside a transaction');
        }
        foreach ($statements as $statement) {
            $this->run(str_replace('{prefix}', $this->prefix(), $statement));
        }
    }

    public function insertId(): int
    {
        return (int) $this->mysqli()->insert_id;
    }

    private function mysqli(): \mysqli
    {
        $dbh = $this->wpdb->dbh;
        if (!$dbh instanceof \mysqli) {
            throw new \RuntimeException('Zero needs WordPress to use the mysqli driver');
        }

        return $dbh;
    }

    // ================================================================ transactions

    /** Open a transaction or join the open one. Any throwable rolls back and cleans caches. */
    public function transaction(callable $fn): mixed
    {
        if ($this->depth > 0) {
            $this->depth++;
            try {
                return $fn();
            } finally {
                $this->depth--;
            }
        }
        $this->begin();
        try {
            $result = $fn();
        } catch (\Throwable $e) {
            $this->rollback();
            throw $e;
        }
        $this->commit();

        return $result;
    }

    /**
     * Open the outermost transaction by hand, for a save that WordPress drives through hooks (§4.9):
     * Zero's own transactions join it until commit() or rollback() ends it. Throws if one is open.
     */
    public function begin(): void
    {
        if ($this->depth > 0) {
            throw new \LogicException('A transaction is already open');
        }
        $this->query('START TRANSACTION');
        $this->depth = 1;
    }

    /** Commit the outermost transaction, then run its afterCommit callbacks. */
    public function commit(): void
    {
        $this->query('COMMIT');
        $this->depth = 0;
        $after = $this->afterCommit;
        $this->reset();
        foreach ($after as $cb) {
            $cb();
        }
    }

    /** Roll the outermost transaction back, clean the caches it touched, run its onRollback callbacks. */
    public function rollback(): void
    {
        $this->depth = 0;
        $this->query('ROLLBACK');
        $this->cleanCaches();
        $undo = $this->onRollback;
        $this->reset();
        foreach ($undo as $cb) {
            $cb();
        }
    }

    public function inTransaction(): bool
    {
        return $this->depth > 0;
    }

    public function afterCommit(callable $cb): void
    {
        $this->depth > 0 ? $this->afterCommit[] = $cb : $cb();
    }

    public function onRollback(callable $cb): void
    {
        if ($this->depth > 0) {
            $this->onRollback[] = $cb;
        }
    }

    public function touchPost(int $id): void
    {
        $this->touchedPosts[$id] = true;
    }

    public function touchOption(string $name): void
    {
        $this->touchedOptions[$name] = true;
    }

    /** Run a core write (wp_insert_post, update_field, ...) with the editor hooks muted. */
    public function core(callable $fn): mixed
    {
        $this->busy++;
        try {
            return $fn();
        } finally {
            $this->busy--;
        }
    }

    public function busy(): bool
    {
        return $this->busy > 0;
    }

    private function query(string $sql): void
    {
        if ($this->wpdb->query($sql) === false) {
            throw new DbError("$sql failed: " . $this->wpdb->last_error, 0);
        }
    }

    private function cleanCaches(): void
    {
        foreach (array_keys($this->touchedPosts) as $id) {
            clean_post_cache($id);
        }
        foreach (array_keys($this->touchedOptions) as $name) {
            wp_cache_delete($name, 'options');
        }
        if ($this->touchedOptions !== []) {
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
        if (function_exists('acf_get_store')) {
            acf_get_store('values')->reset();
        }
    }

    private function reset(): void
    {
        $this->touchedPosts = $this->touchedOptions = [];
        $this->afterCommit = $this->onRollback = [];
    }
}
