<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\HttpError;
use Zero\Media;
use Zero\Schema;
use Zero\Source;
use Zero\Sql;
use Zero\Store;

/**
 * The built-in media collection on WordPress (§4.6): attachments. Upload = wp_handle_sideload +
 * wp_insert_attachment + wp_generate_attachment_metadata, inside the request transaction (the file
 * is removed again if it rolls back). `GET /media?where=` compiles through Sql against a Source that
 * maps the media row fields onto wp_posts/wp_postmeta.
 */
final class WpMedia implements Media
{
    private const TABLE = '__zero_media';
    private const COLUMNS = [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'filename' => ['type' => 'text', 'notNull' => true],
        'mime' => ['type' => 'text', 'notNull' => true],
        'alt' => ['type' => 'text'],
        'createdAt' => ['type' => 'timestamp', 'notNull' => true],
    ];

    private readonly Schema $schema;
    private readonly Store $view;

    public function __construct(private readonly Connection $db, Dialect $dialect)
    {
        $this->schema = new Schema(['version' => 2, 'collections' => [self::TABLE => ['primaryKey' => 'id', 'columns' => self::COLUMNS, 'relations' => []]]]);
        $wpdb = $db->wpdb();
        $alt = "LEFT JOIN `{$wpdb->postmeta}` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = '_wp_attachment_image_alt'";
        $file = "LEFT JOIN `{$wpdb->postmeta}` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = '_wp_attached_file'";
        $source = new Source("`{$wpdb->posts}`", "{a}.post_type = 'attachment'", [
            'id' => new ColumnRef('{a}.ID', '', '', 'scalar'),
            'filename' => new ColumnRef("SUBSTRING_INDEX({j}.meta_value, '/', -1)", $file, '', 'scalar'),
            'mime' => new ColumnRef('{a}.post_mime_type', '', '', 'scalar'),
            'alt' => new ColumnRef("NULLIF({j}.meta_value, '')", $alt, '', 'scalar'),
            'createdAt' => new ColumnRef("DATE_FORMAT({a}.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z')", '', '', 'scalar'),
        ]);
        $this->view = new MediaView($dialect, $source);
    }

    public function upload(string $tmpPath, string $filename, ?array $user, ?string $alt = null): array
    {
        if (!is_file($tmpPath)) {
            throw HttpError::invalidInput('No file was uploaded', '/file');
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        $name = sanitize_file_name(basename(str_replace('\\', '/', $filename)) ?: 'file');
        $upload = ['name' => $name, 'tmp_name' => $tmpPath, 'error' => 0, 'size' => (int) filesize($tmpPath)];
        $moved = wp_handle_sideload($upload, ['test_form' => false]);
        if (isset($moved['error'])) {
            throw HttpError::invalidInput((string) $moved['error'], '/file');
        }
        $path = (string) $moved['file'];
        $this->db->onRollback(static fn () => @unlink($path));
        $id = $this->db->core(static fn () => wp_insert_attachment([
            'post_mime_type' => (string) $moved['type'],
            'post_title' => sanitize_text_field(pathinfo($name, PATHINFO_FILENAME)),
            'post_status' => 'inherit',
            'post_author' => $user['id'] ?? 0,
        ], $path, 0, true));
        if ($id instanceof \WP_Error) {
            throw new \RuntimeException('wp_insert_attachment failed: ' . $id->get_error_message());
        }
        $id = (int) $id;
        $this->db->touchPost($id);
        $meta = wp_generate_attachment_metadata($id, $path);
        wp_update_attachment_metadata($id, $meta);
        $this->db->onRollback(static function () use ($meta, $path) {
            foreach (($meta['sizes'] ?? []) as $size) {
                @unlink(dirname($path) . '/' . $size['file']);
            }
        });
        if ($alt !== null && $alt !== '') {
            update_post_meta($id, '_wp_attachment_image_alt', wp_slash($alt));
        }

        return $this->get($id) ?? throw new \RuntimeException('Attachment vanished after upload');
    }

    public function get(int $id): ?array
    {
        return $this->getMany([$id])[$id] ?? null;
    }

    public function getMany(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($ids === []) {
            return [];
        }

        return array_column($this->list(['where' => ['id' => ['in' => $ids]]]), null, 'id');
    }

    public function list(array $opts): array
    {
        $q = Sql::select($this->schema, $this->view, self::TABLE, $opts);
        $rows = $this->db->run($q['sql'], $q['params']);

        return array_map(fn (array $r) => $this->row((int) $r['id']), $rows);
    }

    public function delete(int $id): void
    {
        $this->db->touchPost($id);
        $file = get_attached_file($id);
        $meta = wp_get_attachment_metadata($id);
        // Rows only now; files go once the transaction commits (a rollback keeps them in place).
        $this->db->run('DELETE FROM `' . $this->db->wpdb()->postmeta . '` WHERE post_id = ?', [$id]);
        $this->db->run('DELETE FROM `' . $this->db->wpdb()->posts . '` WHERE ID = ?', [$id]);
        $this->db->afterCommit(static function () use ($id, $file, $meta) {
            clean_post_cache($id);
            if (is_string($file) && $file !== '') {
                foreach (($meta['sizes'] ?? []) as $size) {
                    @unlink(dirname($file) . '/' . $size['file']);
                }
                @unlink($file);
            }
        });
    }

    /** media row: { id, url, mime, size, width, height, alt, filename, createdAt } */
    private function row(int $id): array
    {
        $post = get_post($id);
        $meta = wp_get_attachment_metadata($id) ?: [];
        $file = (string) get_attached_file($id);
        $alt = get_post_meta($id, '_wp_attachment_image_alt', true);

        return [
            'id' => $id,
            'url' => (string) wp_get_attachment_url($id),
            'mime' => (string) $post?->post_mime_type,
            'size' => (int) ($meta['filesize'] ?? (is_file($file) ? filesize($file) : 0)),
            'width' => isset($meta['width']) ? (int) $meta['width'] : null,
            'height' => isset($meta['height']) ? (int) $meta['height'] : null,
            'alt' => is_string($alt) && $alt !== '' ? $alt : null,
            'filename' => basename($file),
            'createdAt' => str_replace(' ', 'T', (string) $post?->post_date_gmt) . '.000Z',
        ];
    }
}

/** @internal Answers dialect()/source() for compiling media queries; never stores. */
final class MediaView implements Store
{
    public function __construct(private readonly Dialect $d, private readonly Source $source)
    {
    }

    public function dialect(): Dialect
    {
        return $this->d;
    }

    public function source(string $collection): Source
    {
        return $this->source;
    }

    public function transaction(callable $fn): mixed { return $fn(); }
    public function select(string $collection, array $q): array { throw new \LogicException('read-only view'); }
    public function insert(string $collection, array $values): int|string { throw new \LogicException('read-only view'); }
    public function update(string $collection, int|string $pk, array $values): void { throw new \LogicException('read-only view'); }
    public function delete(string $collection, int|string $pk): void { throw new \LogicException('read-only view'); }
    public function globalRead(string $name): ?array { return null; }
    public function globalWrite(string $name, array $values): void { throw new \LogicException('read-only view'); }
    public function revisions(string $collection, int|string $pk): array { return []; }
    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void { throw new \LogicException('read-only view'); }
    public function revision(string $collection, int|string $pk, int $revisionId): ?array { return null; }
    public function promoteDue(string $collection, string $nowIso): array { return []; }
    public function mapError(\Throwable $e): \Throwable { return $e; }
}
