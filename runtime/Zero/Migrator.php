<?php

declare(strict_types=1);

namespace Zero;

/**
 * Applies zero/app/migrations/NNNN_<name>.sql in filename order, one transaction
 * per file, recorded in __zero_migrations.
 *
 * Foreign keys are switched off while a file runs so table rebuilds
 * (CREATE __new_x / INSERT SELECT / DROP x / RENAME) don't fire ON DELETE
 * actions on child rows; `PRAGMA foreign_key_check` then verifies integrity
 * before commit.
 */
final class Migrator
{
    private const TABLE = '__zero_migrations';

    public function __construct(private readonly \PDO $pdo, private readonly string $dir)
    {
    }

    /** @return list<string> ids (file names without .sql) applied by this call */
    public function migrate(): array
    {
        $files = glob($this->dir . '/*.sql') ?: [];
        sort($files, SORT_STRING);
        if ($files === []) {
            return [];
        }
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS ' . self::TABLE . ' (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
        $done = array_flip($this->pdo->query('SELECT id FROM ' . self::TABLE)->fetchAll(\PDO::FETCH_COLUMN));
        $applied = [];
        foreach ($files as $file) {
            $id = basename($file, '.sql');
            if (!isset($done[$id]) && $this->apply($id, $file)) {
                $applied[] = $id;
            }
        }

        return $applied;
    }

    private function apply(string $id, string $file): bool
    {
        $this->pdo->exec('PRAGMA foreign_keys = OFF'); // no effect inside a transaction, so set it first
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            try {
                // Re-check under the write lock: another process may have just applied it.
                $done = $this->pdo->prepare('SELECT 1 FROM ' . self::TABLE . ' WHERE id = ?');
                $done->execute([$id]);
                if ($done->fetchColumn() !== false) {
                    $this->pdo->exec('ROLLBACK');

                    return false;
                }
                foreach (self::statements((string) file_get_contents($file)) as $i => $sql) {
                    try {
                        $this->pdo->exec($sql);
                    } catch (\PDOException $e) {
                        throw new \RuntimeException("Migration $id failed at statement " . ($i + 1) . ': ' . $e->getMessage(), 0, $e);
                    }
                }
                $broken = $this->pdo->query('PRAGMA foreign_key_check')->fetchAll(\PDO::FETCH_NUM);
                if ($broken !== []) {
                    $tables = implode(', ', array_unique(array_map(static fn ($r) => "{$r[0]} -> {$r[2]}", $broken)));
                    throw new \RuntimeException("Migration $id leaves rows with broken foreign keys in $tables");
                }
                $record = $this->pdo->prepare('INSERT INTO ' . self::TABLE . ' (id, applied_at) VALUES (?, ?)');
                $record->execute([$id, Js::iso(Js::now())]);
                $this->pdo->exec('COMMIT');

                return true;
            } catch (\Throwable $e) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->exec('ROLLBACK');
                }
                throw $e;
            }
        } finally {
            $this->pdo->exec('PRAGMA foreign_keys = ON');
        }
    }

    /** @return list<string> */
    public static function statements(string $sql): array
    {
        $parts = preg_split('/-->[ \t]*statement-breakpoint/', $sql) ?: [];

        return array_values(array_filter(array_map('trim', $parts), static fn ($s) => $s !== ''));
    }
}
