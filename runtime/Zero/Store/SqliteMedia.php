<?php

declare(strict_types=1);

namespace Zero\Store;

use Zero\HttpError;
use Zero\Js;
use Zero\Media;
use Zero\Media\Images;
use Zero\Schema;
use Zero\Sql;

/**
 * Standalone media (§4.6): rows in __zero_media, files under <appRoot>/public/uploads/YYYY/MM/<uuid>.<ext>.
 * Named sizes (phase 2 §7.2) are rendered with GD next to the original as <uuid>-<size>.<ext>; the
 * `sizes` column records each size's file (null = the original already fits) and dimensions.
 */
final class SqliteMedia implements Media
{
    public const TABLE = '__zero_media';
    /** Queryable fields (`path`, `sizes` and `focal` are not filterable; `url` is derived). */
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
        'sizes' => ['type' => 'json'],
        'focal' => ['type' => 'json'],
    ];
    private const INTERNAL = ['path', 'sizes', 'focal'];
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

    /** SystemTables upgrade for stores created before phase 2: add `sizes` and `focal`. */
    public static function upgrade(SqliteStore $store): void
    {
        $have = array_column($store->pdo()->query('PRAGMA table_info("__zero_media")')->fetchAll(), 'name');
        foreach (['sizes' => "text NOT NULL DEFAULT '{}'", 'focal' => 'text'] as $column => $type) {
            if (!in_array($column, $have, true)) {
                $store->applySystemStatements(["ALTER TABLE \"__zero_media\" ADD COLUMN \"$column\" $type"]);
            }
        }
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
        $sizes = $width === null || !Images::resizable($dest, $mime) ? [] : $this->renderSizes($rel, $mime, $width, $height, null, false);
        $name = basename(str_replace('\\', '/', $filename)) ?: 'file';
        $this->store->run(
            'INSERT INTO "__zero_media" ("filename", "mime", "size", "width", "height", "alt", "path", "createdAt", "sizes") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$name, $mime, $size, $width, $height, $alt, $rel, Js::iso($now), Js::jsonStringify((object) $sizes)],
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
        self::rejectInternal($opts['where'] ?? null, '/where');
        self::rejectInternal($opts['orderBy'] ?? null, '/orderBy');

        return array_map(fn (array $raw) => $this->row(Schema::decodeRow(self::COLUMNS, $raw)), $this->select($opts));
    }

    public function update(int $id, array $patch): ?array
    {
        $raw = $this->select(['where' => ['id' => $id]])[0] ?? null;
        if ($raw === null) {
            return null;
        }
        $r = Schema::decodeRow(self::COLUMNS, $raw);
        if (array_key_exists('alt', $patch)) {
            $this->store->run('UPDATE "__zero_media" SET "alt" = ? WHERE "id" = ?', [$patch['alt'], $id]);
        }
        if (array_key_exists('focal', $patch) && $patch['focal'] !== $r['focal']) {
            // Rows uploaded before sizes were configured get every size now; others regenerate cover crops.
            $sizes = $r['sizes'] ?? [];
            if ($r['width'] !== null && Images::resizable($this->publicDir . '/uploads/' . $r['path'], $r['mime'])) {
                $sizes = array_merge($sizes, $this->renderSizes($r['path'], $r['mime'], (int) $r['width'], (int) $r['height'], $patch['focal'], $sizes !== []));
            }
            $this->store->run('UPDATE "__zero_media" SET "focal" = ?, "sizes" = ? WHERE "id" = ?',
                [$patch['focal'] === null ? null : Js::jsonStringify($patch['focal']), Js::jsonStringify((object) $sizes), $id]);
        }

        return $this->get($id);
    }

    public function delete(int $id): void
    {
        $raw = $this->select(['where' => ['id' => $id]])[0] ?? null;
        if ($raw === null) {
            return;
        }
        $r = Schema::decodeRow(self::COLUMNS, $raw);
        $this->store->run('DELETE FROM "__zero_media" WHERE "id" = ?', [$id]);
        $files = [$this->publicDir . '/uploads/' . $r['path']];
        foreach ($r['sizes'] ?? [] as $s) {
            if ($s['file'] !== null) {
                $files[] = $this->publicDir . '/uploads/' . $s['file'];
            }
        }
        $this->store->afterCommit(static function () use ($files) {
            foreach ($files as $file) {
                @unlink($file);
            }
        });
    }

    /** `path`, `sizes` and `focal` are storage, not queryable fields: reject them at any filter depth. */
    private static function rejectInternal(mixed $node, string $ptr): void
    {
        if (!is_array($node)) {
            return;
        }
        foreach ($node as $key => $value) {
            if (in_array($key, self::INTERNAL, true)) {
                throw HttpError::invalidQuery("Unknown column '$key'", $ptr . HttpError::seg($key));
            }
            if (in_array($key, ['AND', 'OR', 'NOT'], true) || is_int($key)) {
                self::rejectInternal($value, $ptr . HttpError::seg($key));
            }
        }
    }

    private function select(array $opts): array
    {
        return $this->store->select(self::TABLE, Sql::select($this->schema, $this->store, self::TABLE, $opts));
    }

    /**
     * Render every configured size (or, with $coverOnly, every `cover` size) for the original at $rel.
     * New files appear inside the transaction under a temporary name and replace the live ones on
     * commit, so a rollback leaves the previous bytes in place.
     *
     * @return array<string, array{file: ?string, width: int, height: int}>
     */
    private function renderSizes(string $rel, string $mime, int $width, int $height, ?array $focal, bool $coverOnly): array
    {
        $src = $this->publicDir . '/uploads/' . $rel;
        $out = [];
        foreach (\Zero\db()->schema()->media()['sizes'] ?? [] as $name => $size) {
            $cover = ($size['fit'] ?? 'inside') === 'cover';
            if ($coverOnly && !$cover) {
                continue;
            }
            $dims = Images::dimensions($width, $height, (int) $size['width'], isset($size['height']) ? (int) $size['height'] : null, $cover, $focal);
            if ($dims === null) {
                $out[$name] = ['file' => null, 'width' => $width, 'height' => $height];
                continue;
            }
            $file = preg_replace('/(\.[a-z0-9]+)$/', "-$name\$1", $rel);
            $dest = $this->publicDir . '/uploads/' . $file;
            $tmp = $dest . '.' . bin2hex(random_bytes(4)) . '.tmp';
            Images::render($src, $mime, $dims, $tmp);
            $this->store->onRollback(static fn () => @unlink($tmp));
            $this->store->afterCommit(static fn () => rename($tmp, $dest));
            $out[$name] = ['file' => $file, 'width' => $dims[4], 'height' => $dims[5]];
        }

        return $out;
    }

    private function row(array $r): array
    {
        $sizes = [];
        foreach ($r['sizes'] ?? [] as $name => $s) {
            $sizes[$name] = ['url' => '/uploads/' . ($s['file'] ?? $r['path']), 'width' => $s['width'], 'height' => $s['height']];
        }

        return [
            'id' => $r['id'], 'url' => '/uploads/' . $r['path'], 'mime' => $r['mime'], 'size' => $r['size'],
            'width' => $r['width'], 'height' => $r['height'], 'alt' => $r['alt'], 'filename' => $r['filename'], 'createdAt' => $r['createdAt'],
            'sizes' => $sizes === [] ? new \stdClass() : $sizes, 'focal' => $r['focal'],
        ];
    }
}
