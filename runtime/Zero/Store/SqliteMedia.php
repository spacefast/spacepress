<?php

declare(strict_types=1);

namespace Zero\Store;

use Zero\HttpError;
use Zero\Js;
use Zero\Media;
use Zero\Schema;
use Zero\Sql;

/** Standalone media (§4.6): rows in __zero_media, files under <appRoot>/public/uploads/YYYY/MM/<uuid>.<ext>. */
final class SqliteMedia implements Media
{
    public const TABLE = '__zero_media';
    /** Queryable fields (`path` is internal; `url` is derived). */
    public const COLUMNS = [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'filename' => ['type' => 'text', 'notNull' => true],
        'mime' => ['type' => 'text', 'notNull' => true],
        'size' => ['type' => 'integer', 'notNull' => true],
        'width' => ['type' => 'integer'],
        'height' => ['type' => 'integer'],
        'alt' => ['type' => 'text'],
        'path' => ['type' => 'text', 'notNull' => true],
        'createdAt' => ['type' => 'timestamp', 'notNull' => true],
    ];
    /**
     * The stored extension comes only from the sniffed mime, never from the client's filename, so an
     * upload can't land as .php/.phtml/.html under public/. SVG (script-capable) is stored as .bin.
     */
    private const EXT = [
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'image/avif' => 'avif',
        'application/pdf' => 'pdf', 'text/plain' => 'txt', 'text/csv' => 'csv', 'video/mp4' => 'mp4', 'video/webm' => 'webm',
        'audio/mpeg' => 'mp3', 'audio/ogg' => 'ogg', 'application/zip' => 'zip',
    ];

    private readonly Schema $schema;

    public function __construct(private readonly SqliteStore $store, private readonly string $publicDir)
    {
        $this->schema = new Schema(['collections' => [self::TABLE => ['primaryKey' => 'id', 'columns' => self::COLUMNS, 'relations' => []]]]);
    }

    public function upload(string $tmpPath, string $filename, ?array $user, ?string $alt = null): array
    {
        if (!is_file($tmpPath)) {
            throw HttpError::invalidInput('No file was uploaded', '/file');
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($tmpPath) ?: 'application/octet-stream';
        $ext = self::EXT[$mime] ?? 'bin';
        $size = (int) filesize($tmpPath);
        [$width, $height] = [null, null];
        if (str_starts_with($mime, 'image/') && ($info = @getimagesize($tmpPath)) !== false) {
            [$width, $height] = [(int) $info[0], (int) $info[1]];
        }
        $now = Js::now();
        $rel = gmdate('Y/m', intdiv($now, 1000)) . '/' . Js::uuid() . '.' . $ext;
        $dest = $this->publicDir . '/uploads/' . $rel;
        if (!is_dir(dirname($dest)) && !mkdir(dirname($dest), 0775, true) && !is_dir(dirname($dest))) {
            throw new \RuntimeException('Cannot create the uploads directory');
        }
        if (!(is_uploaded_file($tmpPath) ? move_uploaded_file($tmpPath, $dest) : rename($tmpPath, $dest))) {
            throw new \RuntimeException('Cannot store the uploaded file');
        }
        $this->store->onRollback(static fn () => @unlink($dest));
        $name = basename(str_replace('\\', '/', $filename)) ?: 'file';
        $this->store->run(
            'INSERT INTO "__zero_media" ("filename", "mime", "size", "width", "height", "alt", "path", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$name, $mime, $size, $width, $height, $alt, $rel, Js::iso($now)],
        );

        return $this->get((int) $this->store->pdo()->lastInsertId()) ?? throw new \RuntimeException('Media row vanished');
    }

    public function get(int $id): ?array
    {
        return $this->getMany([$id])[$id] ?? null;
    }

    public function getMany(array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $rows = $this->list(['where' => ['id' => ['in' => array_values(array_unique($ids))]]]);

        return array_column($rows, null, 'id');
    }

    public function list(array $opts): array
    {
        foreach (['where', 'orderBy'] as $k) {
            if (isset($opts[$k]['path'])) {
                throw HttpError::invalidQuery("Unknown column 'path'", "/$k/path");
            }
        }
        $q = Sql::select($this->schema, $this->store, self::TABLE, $opts);

        return array_map(fn (array $raw) => $this->row(Schema::decodeRow(self::COLUMNS, $raw)), $this->store->select(self::TABLE, $q));
    }

    public function delete(int $id): void
    {
        $row = $this->store->run('SELECT "path" FROM "__zero_media" WHERE "id" = ?', [$id])->fetchColumn();
        if ($row === false) {
            return;
        }
        $this->store->run('DELETE FROM "__zero_media" WHERE "id" = ?', [$id]);
        $file = $this->publicDir . '/uploads/' . $row;
        $this->store->afterCommit(static fn () => @unlink($file));
    }

    private function row(array $r): array
    {
        return [
            'id' => $r['id'], 'url' => '/uploads/' . $r['path'], 'mime' => $r['mime'], 'size' => $r['size'],
            'width' => $r['width'], 'height' => $r['height'], 'alt' => $r['alt'], 'filename' => $r['filename'], 'createdAt' => $r['createdAt'],
        ];
    }
}
