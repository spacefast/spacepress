<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\HttpError;
use Zero\Media;
use Zero\Media\Images;
use Zero\Wp\Media\ImageCdn;
use Zero\Schema;
use Zero\Source;
use Zero\Sql;
use Zero\Store;

/**
 * The built-in media collection on WordPress (§4.6): attachments. Upload = wp_handle_sideload +
 * wp_insert_attachment + wp_generate_attachment_metadata, inside the request transaction (the file
 * is removed again if it rolls back). `GET /media?where=` compiles through Sql against a Source that
 * maps the media row fields onto wp_posts/wp_postmeta.
 *
 * Named sizes (phase 2 §7.2) are registered as core image sizes `zero_<name>` (so themes and
 * wp_get_attachment_image_src know them) but rendered by Zero through wp_get_image_editor: core's own
 * sub-size pass skips them, and wp_generate_attachment_metadata adds them with the focal crop from
 * `_zero_focal`. Their files are named `<original>-zero_<name>-<hash>.<ext>` (hash over the rendered
 * rectangle), so a new focal point writes new files inside the transaction and the old ones go only
 * after commit, and no other size with the same dimensions ever shares or changes a Zero file.
 */
final class WpMedia implements Media
{
    public const FOCAL = '_zero_focal';
    /** @var list<string> sizes that failed to render during the last metadata pass */
    private static array $failed = [];

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
        $this->schema = new Schema(['version' => 3, 'runtime' => '0.2', 'collections' => [self::TABLE => ['primaryKey' => 'id', 'columns' => self::COLUMNS, 'relations' => []]]]);
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

    /** Register the sizes on every request, so wp-admin and core REST uploads get them too. */
    public static function boot(): void
    {
        add_action('init', static function (): void {
            // After Runtime::app's description hook (plugins_loaded), which reports platform versions.
            \Zero\Extensions::schemaDescribe(static function (array $description): array {
                if (isset($description['runtime']['wp'])) {
                    $description['runtime']['wp']['imageCdn'] = ImageCdn::active();
                }

                return $description;
            });
            foreach (self::sizes() as $name => $size) {
                add_image_size('zero_' . $name, (int) $size['width'], (int) ($size['height'] ?? 0), ($size['fit'] ?? 'inside') === 'cover');
            }
        });
        // Core's sub-size pass never renders Zero sizes; Zero does, below, with the focal point.
        add_filter('intermediate_image_sizes_advanced', static function (array $sizes): array {
            foreach (array_keys(self::sizes()) as $name) {
                unset($sizes['zero_' . $name]);
            }

            return $sizes;
        });
        add_filter('wp_generate_attachment_metadata', static function (array $meta, int $id): array {
            self::$failed = [];
            if (isset($meta['width'], $meta['height']) && !ImageCdn::active()) {
                foreach (self::render($id, $meta, self::focalOf($id), false) as $name => $size) {
                    $meta['sizes']['zero_' . $name] = $size;
                }
            }

            return $meta;
        }, 10, 2);
    }

    /** @return array<string, array{width: int, height: ?int, fit: string}> */
    private static function sizes(): array
    {
        return Runtime::plugin()?->schema->media()['sizes'] ?? [];
    }

    /**
     * Render configured sizes for an attachment with wp_get_image_editor (every size, or only cover
     * sizes). Sizes the original already fits are absent: the original serves them.
     *
     * @return array<string, array{file: string, width: int, height: int, mime-type: string, filesize: int}>
     */
    private static function render(int $id, array $meta, ?array $focal, bool $coverOnly): array
    {
        $file = (string) get_attached_file($id);
        $mime = (string) get_post_mime_type($id);
        if (!is_file($file) || !Images::resizable($file, $mime)) {
            return [];
        }
        $out = [];
        foreach (self::sizes() as $name => $size) {
            $cover = ($size['fit'] ?? 'inside') === 'cover';
            if ($coverOnly && !$cover) {
                continue;
            }
            $dims = Images::dimensions((int) $meta['width'], (int) $meta['height'], (int) $size['width'], isset($size['height']) ? (int) $size['height'] : null, $cover, $focal);
            if ($dims === null) {
                continue;
            }
            [, , $x, $y, $w, $h, $sw, $sh] = $dims;
            $editor = wp_get_image_editor($file);
            $info = pathinfo($file);
            $dest = $info['dirname'] . '/' . $info['filename'] . '-zero_' . $name . '-' . substr(md5(implode(',', $dims)), 0, 8) . '.' . $info['extension'];
            $saved = is_wp_error($editor) ? $editor : $editor->crop($x, $y, $sw, $sh, $w, $h);
            $saved = is_wp_error($saved) ? $saved : $editor->save($dest);
            if (is_wp_error($saved)) {
                self::$failed[] = $name;
                continue;
            }
            $out[$name] = ['file' => wp_basename($saved['path']), 'width' => (int) $saved['width'], 'height' => (int) $saved['height'],
                'mime-type' => (string) $saved['mime-type'], 'filesize' => (int) ($saved['filesize'] ?? filesize($saved['path']))];
        }

        return $out;
    }

    private static function focalOf(int $id): ?array
    {
        $raw = get_post_meta($id, self::FOCAL, true);
        $focal = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;

        return is_array($focal) && isset($focal['x'], $focal['y']) ? ['x' => $focal['x'], 'y' => $focal['y']] : null;
    }

    /** API writes refuse a partial set of sizes (the transaction rolls back and can be retried). */
    private static function requireRendered(): void
    {
        if (self::$failed !== []) {
            $failed = self::$failed;
            self::$failed = [];
            throw new \RuntimeException('Could not render image sizes: ' . implode(', ', $failed));
        }
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
        $this->db->onRollback(static function () use ($meta, $path) {
            foreach (($meta['sizes'] ?? []) as $size) {
                @unlink(dirname($path) . '/' . $size['file']);
            }
        });
        self::requireRendered();
        wp_update_attachment_metadata($id, $meta);
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

    public function update(int $id, array $patch): ?array
    {
        if (get_post_type($id) !== 'attachment') {
            return null;
        }
        $this->db->touchPost($id);
        if (array_key_exists('alt', $patch)) {
            $patch['alt'] === null ? delete_post_meta($id, '_wp_attachment_image_alt') : update_post_meta($id, '_wp_attachment_image_alt', wp_slash($patch['alt']));
        }
        if (array_key_exists('focal', $patch) && $patch['focal'] !== self::focalOf($id)) {
            $patch['focal'] === null ? delete_post_meta($id, self::FOCAL) : update_post_meta($id, self::FOCAL, wp_slash((string) \Zero\Js::jsonStringify($patch['focal'])));
            $meta = wp_get_attachment_metadata($id);
            if (is_array($meta) && isset($meta['width'], $meta['height']) && !ImageCdn::active()) {
                require_once ABSPATH . 'wp-admin/includes/image.php';
                // Rows from before sizes were configured get every size; others re-render cover crops.
                $all = array_filter(array_keys(self::sizes()), static fn ($n) => !isset($meta['sizes']['zero_' . $n]));
                self::$failed = [];
                $fresh = self::render($id, $meta, $patch['focal'], $all === []);
                $dir = dirname((string) get_attached_file($id));
                foreach ($fresh as $name => $size) {
                    $new = $dir . '/' . $size['file'];
                    $old = isset($meta['sizes']['zero_' . $name]) ? $dir . '/' . $meta['sizes']['zero_' . $name]['file'] : null;
                    if ($new !== $old) {
                        $this->db->onRollback(static fn () => @unlink($new));
                        if ($old !== null) {
                            $this->db->afterCommit(static fn () => @unlink($old));
                        }
                    }
                    $meta['sizes']['zero_' . $name] = $size;
                }
                self::requireRendered();
                wp_update_attachment_metadata($id, $meta);
            }
        }

        return $this->get($id);
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

    /** media row: { id, url, mime, size, width, height, alt, filename, createdAt, sizes, focal } */
    private function row(int $id): array
    {
        $post = get_post($id);
        $meta = wp_get_attachment_metadata($id) ?: [];
        $file = (string) get_attached_file($id);
        $alt = get_post_meta($id, '_wp_attachment_image_alt', true);
        $focal = self::focalOf($id);
        $mime = (string) $post?->post_mime_type;
        $sizes = [];
        if (isset($meta['width'], $meta['height']) && in_array($mime, Images::RESIZABLE, true) && ($mime !== 'image/gif' || Images::resizable($file, $mime))) {
            $cdn = ImageCdn::active();
            foreach (self::sizes() as $name => $size) {
                if ($cdn) {
                    $sizes[$name] = ImageCdn::size((string) wp_get_attachment_url($id), (int) $meta['width'], (int) $meta['height'], $size, $focal);
                    continue;
                }
                $src = isset($meta['sizes']['zero_' . $name]) ? wp_get_attachment_image_src($id, 'zero_' . $name) : false;
                $sizes[$name] = $src === false
                    ? ['url' => (string) wp_get_attachment_url($id), 'width' => (int) $meta['width'], 'height' => (int) $meta['height']]
                    : ['url' => (string) $src[0], 'width' => (int) $src[1], 'height' => (int) $src[2]];
            }
        }

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
            'sizes' => $sizes === [] ? new \stdClass() : $sizes,
            'focal' => $focal,
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

    public function afterCommit(callable $fn): void { throw new \LogicException('read-only view'); }
    public function applySystemStatements(array $statements): void { throw new \LogicException('read-only view'); }
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
