<?php

declare(strict_types=1);

namespace Zero\Media;

use Zero\App;
use Zero\Secret;
use Zero\Store\SqliteStore;

/** Standalone private files: rows in `__zero_files`, bytes under `<appRoot>/private/<bucket>/<uuid>` (never under public/). */
final class SqliteFiles implements FileStorage
{
    public const DDL = 'CREATE TABLE IF NOT EXISTS "__zero_files" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "bucket" text NOT NULL, "filename" text NOT NULL, "mime" text NOT NULL, "size" integer NOT NULL, "path" text NOT NULL, "ownerId" integer, "createdAt" text NOT NULL)';

    public function __construct(private readonly SqliteStore $store, private readonly string $root)
    {
    }

    public function secret(): string
    {
        return Secret::load($this->root);
    }

    public function unavailable(): ?string
    {
        return null;
    }

    public function store(string $tmpPath, string $rel): void
    {
        $dest = $this->absolute($rel);
        if (!is_dir(dirname($dest)) && !mkdir(dirname($dest), 0700, true) && !is_dir(dirname($dest))) {
            throw new \RuntimeException('Cannot create the private files directory');
        }
        if (!(is_uploaded_file($tmpPath) ? move_uploaded_file($tmpPath, $dest) : rename($tmpPath, $dest))) {
            throw new \RuntimeException('Cannot store the uploaded file');
        }
        $this->store->onRollback(static fn () => @unlink($dest));
    }

    public function insert(array $row): int
    {
        $this->store->run(
            'INSERT INTO "__zero_files" ("bucket", "filename", "mime", "size", "path", "ownerId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$row['bucket'], $row['filename'], $row['mime'], $row['size'], $row['path'], $row['ownerId'], $row['createdAt']],
        );

        return (int) $this->store->pdo()->lastInsertId();
    }

    public function getMany(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $rows = $this->store->run('SELECT * FROM "__zero_files" WHERE "id" IN (' . implode(', ', array_fill(0, count($ids), '?')) . ')', $ids)->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['id']] = Files::normalizeRow($r);
        }

        return $out;
    }

    public function delete(array $row): void
    {
        $this->store->run('DELETE FROM "__zero_files" WHERE "id" = ?', [$row['id']]);
        $file = $this->absolute($row['path']);
        $this->store->afterCommit(static fn () => @unlink($file));
    }

    public function absolute(string $rel): string
    {
        return $this->root . '/private/' . $rel;
    }

    public function apiUrl(string $route): string
    {
        return App::PREFIX . $route;
    }

    public function describe(): array
    {
        return ['protected' => true];
    }
}
