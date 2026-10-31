<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\Dialect;
use Zero\HttpError;
use Zero\Js;
use Zero\Schema;
use Zero\Source;
use Zero\Store;

/**
 * Post-backed collections (§4.2, §3.5.1): the row is the `wp_posts` row plus its SCF postmeta.
 * Reads run the compiled SQL over wp_posts/wp_postmeta directly (one LEFT JOIN per used meta
 * column); serialized lists are normalised to JSON and group/repeater/blocks are filled from SCF
 * after the query. Writes go through wp_insert_post/wp_update_post + update_field inside the
 * request transaction, with editor hooks muted (Connection::core).
 */
final class WpPostStore implements Store
{
    /** @var array<string, Source> */
    private array $sources = [];

    public function __construct(
        private readonly Connection $db,
        private readonly Schema $schema,
        private readonly Dialect $dialect,
    ) {
    }

    public function afterCommit(callable $fn): void
    {
        $this->db->afterCommit($fn);
    }

    public function applySystemStatements(array $statements): void
    {
        $this->db->applySystemStatements($statements);
    }

    public function transaction(callable $fn): mixed
    {
        return $this->db->transaction($fn);
    }

    public function dialect(): Dialect
    {
        return $this->dialect;
    }

    // ================================================================ reads

    public function source(string $collection): Source
    {
        return $this->sources[$collection] ??= $this->buildSource($collection);
    }

    private function buildSource(string $collection): Source
    {
        $spec = $this->schema->collection($collection);
        $postmeta = $this->db->wpdb()->postmeta;
        $prefix = $spec['wp']['metaPrefix'];
        $m = static fn (string $col) => "LEFT JOIN `$postmeta` {j} ON {j}.post_id = {a}.ID AND {j}.meta_key = '" . addslashes($prefix . $col) . "'";
        $v = "NULLIF({j}.meta_value, '')";
        $refs = [];
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            $type = $def['type'];
            $system = $def['system'] ?? false;
            $refs[$col] = match (true) {
                $col === $spec['primaryKey'] => new ColumnRef('{a}.ID', '', '', 'scalar'),
                $col === ($spec['title'] ?? null) => new ColumnRef('{a}.post_title', '', '', 'scalar'),
                $col === ($spec['content'] ?? null) => new ColumnRef('{a}.post_content', '', '', 'scalar'),
                $col === ($spec['slug'] ?? null) => new ColumnRef('{a}.post_name', '', '', 'scalar'),
                $system && $col === 'status' => new ColumnRef("CASE {a}.post_status WHEN 'publish' THEN 'published' WHEN 'future' THEN 'scheduled' ELSE 'draft' END", '', '', 'scalar'),
                $system && $col === 'publishedAt' => new ColumnRef(
                    "CASE WHEN {a}.post_date_gmt = '0000-00-00 00:00:00' THEN NULL ELSE DATE_FORMAT({a}.post_date_gmt, '%Y-%m-%dT%H:%i:%s.000Z') END",
                    '',
                    "NULLIF({a}.post_date_gmt, '0000-00-00 00:00:00')",
                    'scalar',
                ),
                $type === 'integer', $type === 'media' => new ColumnRef($v, $m($col), "CAST($v AS SIGNED)", 'scalar'),
                $type === 'real' => new ColumnRef($v, $m($col), "CAST($v AS DECIMAL(30,10))", 'scalar'),
                $type === 'timestamp' => new ColumnRef("CONCAT(REPLACE($v, ' ', 'T'), '.000Z')", $m($col), $v, 'scalar'),
                $type === 'date' => new ColumnRef("DATE_FORMAT(STR_TO_DATE($v, '%Y%m%d'), '%Y-%m-%d')", $m($col), $v, 'scalar'),
                $type === 'json' => new ColumnRef($v, $m($col), '', 'json'),
                $type === 'select', $type === 'mediaList' => new ColumnRef($v, $m($col), '{j}.meta_value', 'serialized-list'),
                in_array($type, ['group', 'repeater', 'blocks'], true) => new ColumnRef('NULL', $m($col), "NULLIF(NULLIF({j}.meta_value, ''), '0')", 'json'),
                default => new ColumnRef($v, $m($col), $v, 'scalar'),
            };
        }

        return new Source(
            '`' . $this->db->wpdb()->posts . '`',
            "{a}.post_type = '" . addslashes($spec['wp']['postType']) . "' AND {a}.post_status NOT IN ('trash', 'auto-draft', 'inherit')",
            $refs,
        );
    }

    public function select(string $collection, array $q): array
    {
        $rows = $this->db->run($q['sql'], $q['params']);
        \Zero\Extensions::lookup($collection, array_column($rows, $this->schema->collection($collection)['primaryKey']));

        return $this->finish($collection, $rows);
    }

    /**
     * Post-process raw SQL rows into the §3.4 storage form: serialized arrays → JSON lists;
     * group/repeater/blocks read through SCF (meta cache primed once for the page).
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function finish(string $collection, array $rows): array
    {
        if ($rows === []) {
            return [];
        }
        $spec = $this->schema->collection($collection);
        $pk = $spec['primaryKey'];
        $lists = $nested = [];
        foreach ($spec['columns'] as $col => $def) {
            if ($this->isMeta($spec, (string) $col)) {
                if ($def['type'] === 'select' || $def['type'] === 'mediaList') {
                    $lists[] = (string) $col;
                } elseif (in_array($def['type'], ['group', 'repeater', 'blocks'], true)) {
                    $nested[] = (string) $col;
                }
            }
        }
        foreach ($rows as &$row) {
            foreach ($lists as $col) {
                $row[$col] = self::serializedToJson($row[$col] ?? null, $spec['columns'][$col]['type'] === 'mediaList');
            }
        }
        unset($row);
        if ($nested !== []) {
            update_meta_cache('post', array_column($rows, $pk));
            Scf::$io++;
            try {
                foreach ($rows as &$row) {
                    $id = (int) $row[$pk];
                    foreach ($nested as $col) {
                        $def = $spec['columns'][$col];
                        if (!metadata_exists('post', $id, $spec['wp']['metaPrefix'] . $col)) {
                            $row[$col] = null;
                            continue;
                        }
                        $fieldKey = $spec['wp']['fieldKeyPrefix'] . $col;
                        $row[$col] = Schema::store($def, Scf::fromScf($def, get_field($fieldKey, $id, false), $fieldKey) ?? ($def['type'] === 'group' ? null : []));
                    }
                }
                unset($row);
            } finally {
                Scf::$io--;
            }
        }

        return $rows;
    }

    private static function serializedToJson(mixed $v, bool $ints): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $list = is_string($v) && is_serialized($v) ? @unserialize($v, ['allowed_classes' => false]) : (is_string($v) ? json_decode($v, true) : $v);
        if (!is_array($list)) {
            $list = [$v];
        }
        $list = array_values(array_filter($list, static fn ($x) => $x !== '' && $x !== null));

        return Js::jsonStringify($ints ? array_map('intval', $list) : array_map('strval', $list));
    }

    /**
     * Rows for arbitrary posts (revisions) read through the same mapping as live rows, with
     * $where (aliases: r = the post) replacing the collection's baseWhere.
     *
     * @return list<array<string, mixed>>
     */
    private function rowsWhere(string $collection, string $where, array $params): array
    {
        $src = $this->source($collection);
        $select = $joins = [];
        $i = 0;
        foreach ($src->columns as $name => $ref) {
            $sub = ['{a}' => 'r', '{j}' => 'r_m' . $i++];
            $select[] = strtr($ref->expr, $sub) . ' AS ' . $this->dialect->quote((string) $name);
            if (str_contains($ref->expr, '{j}')) {
                $joins[] = strtr($ref->join, $sub);
            }
        }
        $sql = 'SELECT ' . implode(', ', $select) . ' FROM ' . $src->table . ' r ' . implode(' ', $joins) . " WHERE $where ORDER BY r.ID DESC";

        return $this->finish($collection, $this->db->run($sql, $params));
    }

    // ================================================================ writes

    public function insert(string $collection, array $values): int|string
    {
        $spec = $this->schema->collection($collection);
        $this->checkUnique($collection, $values, 0);
        $post = $this->corePost($spec, $values) + [
            'post_type' => $spec['wp']['postType'],
            'post_status' => 'publish',
            'post_author' => get_current_user_id(),
        ];
        $id = $this->db->core(fn () => $this->withSlug($post, static fn () => wp_insert_post(wp_slash($post), true)));
        if ($id instanceof \WP_Error) {
            throw new \RuntimeException('wp_insert_post failed: ' . $id->get_error_message());
        }
        $id = (int) $id;
        $this->db->touchPost($id);
        $this->writeMeta($spec, $id, $values);
        clean_post_cache($id);

        return $id;
    }

    public function update(string $collection, int|string $pk, array $values): void
    {
        $spec = $this->schema->collection($collection);
        $id = (int) $pk;
        $this->checkUnique($collection, $values, $id);
        $post = $this->corePost($spec, $values);
        $this->db->touchPost($id);
        if ($post !== []) {
            $post['ID'] = $id;
            // Zero writes the revision itself after the meta is saved (Db::updateOne → revisionWrite);
            // core's own post-update revision would be a second, meta-less one.
            $r = $this->db->core(fn () => $this->withoutCoreRevision(fn () => $this->withSlug($post, static fn () => wp_update_post(wp_slash($post), true))));
            if ($r instanceof \WP_Error) {
                throw new \RuntimeException('wp_update_post failed: ' . $r->get_error_message());
            }
        }
        $this->writeMeta($spec, $id, $values);
        clean_post_cache($id);
    }

    public function delete(string $collection, int|string $pk): void
    {
        $this->db->touchPost((int) $pk);
        $this->db->core(static fn () => wp_delete_post((int) $pk, true));
    }

    /** Core wp_posts fields for the columns present in $values (§4.4). */
    private function corePost(array $spec, array $values): array
    {
        $post = [];
        $map = array_filter([
            $spec['title'] ?? null => 'post_title',
            $spec['content'] ?? null => 'post_content',
            $spec['slug'] ?? null => 'post_name',
        ], static fn ($k) => $k !== '', ARRAY_FILTER_USE_KEY);
        foreach ($map as $col => $field) {
            if (array_key_exists($col, $values)) {
                $post[$field] = (string) ($values[$col] ?? '');
            }
        }
        if (array_key_exists('status', $values) && ($spec['columns']['status']['system'] ?? false)) {
            $post['post_status'] = ['draft' => 'draft', 'published' => 'publish', 'scheduled' => 'future'][$values['status']] ?? 'draft';
        }
        if (array_key_exists('publishedAt', $values) && ($spec['columns']['publishedAt']['system'] ?? false)) {
            $at = $values['publishedAt'];
            if ($at === null) {
                $post['post_date_gmt'] = '0000-00-00 00:00:00';
            } else {
                $gmt = substr((string) $at, 0, 10) . ' ' . substr((string) $at, 11, 8);
                $post['post_date_gmt'] = $gmt;
                $post['post_date'] = get_date_from_gmt($gmt);
            }
            $post['edit_date'] = true;
        }

        return $post;
    }

    /** wp_save_post_revision bails when the post type keeps 0 revisions. */
    private function withoutCoreRevision(callable $fn): mixed
    {
        $none = static fn () => 0;
        add_filter('wp_revisions_to_keep', $none, PHP_INT_MAX);
        try {
            return $fn();
        } finally {
            remove_filter('wp_revisions_to_keep', $none, PHP_INT_MAX);
        }
    }

    /** Pass the slug through verbatim (Zero already checked it is unique in this post type). */
    private function withSlug(array $post, callable $fn): mixed
    {
        if (!isset($post['post_name']) || $post['post_name'] === '') {
            return $fn();
        }
        $slug = $post['post_name'];
        $filter = static fn ($override) => $slug;
        add_filter('pre_wp_unique_post_slug', $filter);
        try {
            return $fn();
        } finally {
            remove_filter('pre_wp_unique_post_slug', $filter);
        }
    }

    private function writeMeta(array $spec, int $id, array $values): void
    {
        Scf::$io++;
        try {
            foreach ($values as $col => $stored) {
                $col = (string) $col;
                if (!$this->isMeta($spec, $col)) {
                    continue;
                }
                $def = $spec['columns'][$col];
                $fieldKey = $spec['wp']['fieldKeyPrefix'] . $col;
                $scf = Scf::toScf($def, $stored, $fieldKey);
                $this->db->core(static fn () => update_field($fieldKey, $scf === null ? null : wp_slash($scf), $id));
            }
        } finally {
            Scf::$io--;
        }
    }

    /** True when the column lives in postmeta (an SCF field), not in a wp_posts column. */
    public function isMeta(array $spec, string $col): bool
    {
        if ($col === $spec['primaryKey'] || $col === ($spec['title'] ?? null) || $col === ($spec['content'] ?? null) || $col === ($spec['slug'] ?? null)) {
            return false;
        }

        return !($spec['columns'][$col]['system'] ?? false);
    }

    /**
     * unique() on a post-backed column (§3.5.1): no SQL UNIQUE exists on meta, so check inside the
     * request transaction, locking what matched, and raise the same unique_violation.
     */
    private function checkUnique(string $collection, array $values, int $self): void
    {
        $spec = $this->schema->collection($collection);
        $wpdb = $this->db->wpdb();
        $live = "p.post_type = ? AND p.post_status NOT IN ('trash', 'auto-draft', 'inherit') AND p.ID <> ?";
        foreach ($values as $col => $v) {
            $col = (string) $col;
            $def = $spec['columns'][$col] ?? [];
            if ($v === null || !($def['unique'] ?? false) || $col === $spec['primaryKey']) {
                continue;
            }
            $hit = match (true) {
                $col === ($spec['slug'] ?? null) => $this->db->run("SELECT p.ID FROM `{$wpdb->posts}` p WHERE p.post_name = ? AND $live LIMIT 1 FOR UPDATE", [(string) $v, $spec['wp']['postType'], $self]),
                $col === ($spec['title'] ?? null) => $this->db->run("SELECT p.ID FROM `{$wpdb->posts}` p WHERE p.post_title = ? AND $live LIMIT 1 FOR UPDATE", [(string) $v, $spec['wp']['postType'], $self]),
                default => $this->db->run(
                    "SELECT m.post_id FROM `{$wpdb->postmeta}` m JOIN `{$wpdb->posts}` p ON p.ID = m.post_id WHERE m.meta_key = ? AND m.meta_value = ? AND $live LIMIT 1 FOR UPDATE",
                    [$spec['wp']['metaPrefix'] . $col, Scf::metaScalar($def, $v), $spec['wp']['postType'], $self],
                ),
            };
            if ($hit !== []) {
                throw new HttpError(409, 'unique_violation', "A row with this $col already exists", HttpError::seg($col));
            }
        }
    }

    // ================================================================ globals: handled by WpTableStore (options)

    public function globalRead(string $name): ?array
    {
        throw new \LogicException('globals live in options; CompositeStore routes them to WpTableStore');
    }

    public function globalWrite(string $name, array $values): void
    {
        throw new \LogicException('globals live in options; CompositeStore routes them to WpTableStore');
    }

    // ================================================================ revisions (§4.7): WP revisions + SCF meta

    public function revisions(string $collection, int|string $pk): array
    {
        $rows = $this->rowsWhere($collection, "r.post_type = 'revision' AND r.post_parent = ? AND r.post_name NOT LIKE '%autosave%'", [(int) $pk]);

        return array_map(fn (array $row) => $this->revisionEntry($collection, (int) $pk, $row), $rows);
    }

    public function revision(string $collection, int|string $pk, int $revisionId): ?array
    {
        $rows = $this->rowsWhere($collection, "r.post_type = 'revision' AND r.post_parent = ? AND r.ID = ?", [(int) $pk, $revisionId]);

        return $rows === [] ? null : $this->revisionEntry($collection, (int) $pk, $rows[0]);
    }

    /**
     * A revision post can't hold Zero's slug (core names it `<id>-revision-v1`) or status (`inherit`),
     * so snapshotRevision keeps them in `_zero_system`; revisions saved before it existed fall back
     * to the parent's current values.
     */
    private function revisionEntry(string $collection, int $pk, array $row): array
    {
        $spec = $this->schema->collection($collection);
        $rid = (int) $row[$spec['primaryKey']];
        $post = get_post($rid);
        $system = json_decode((string) get_metadata('post', $rid, '_zero_system', true), true);
        $system = is_array($system) ? $system : [];
        $keys = $this->snapshotKeys($spec);
        if (array_diff_key($keys, $system) !== []) {
            $system += array_intersect_key($this->rowsWhere($collection, 'r.ID = ?', [$pk])[0] ?? [], $keys);
        }
        $row = array_replace($row, array_intersect_key($system, $keys));
        $row[$spec['primaryKey']] = $pk;
        $at = $post instanceof \WP_Post && $post->post_date_gmt !== '0000-00-00 00:00:00' ? $post->post_date_gmt : $post?->post_date;

        return [
            'id' => $rid,
            'at' => str_replace(' ', 'T', (string) $at) . '.000Z',
            'userId' => $post instanceof \WP_Post && (int) $post->post_author > 0 ? (int) $post->post_author : null,
            'row' => $row,
        ];
    }

    /** True when the post's row differs from the revision's, ignoring `onUpdate` columns. */
    public function revisionDiffers(string $collection, int $pk, int $revisionId): bool
    {
        $spec = $this->schema->collection($collection);
        $live = $this->rowsWhere($collection, 'r.ID = ?', [$pk])[0] ?? null;
        $rev = $this->revision($collection, $pk, $revisionId)['row'] ?? null;
        if ($live === null || $rev === null) {
            return true;
        }
        foreach ($spec['columns'] as $col => $def) {
            if (!isset($def['onUpdate']) && (string) ($live[$col] ?? '') !== (string) ($rev[$col] ?? '')) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, true> the row columns a revision post doesn't carry itself */
    private function snapshotKeys(array $spec): array
    {
        $keys = [];
        foreach (['status', 'publishedAt'] as $col) {
            if ($spec['columns'][$col]['system'] ?? false) {
                $keys[$col] = true;
            }
        }
        if (($spec['slug'] ?? null) !== null) {
            $keys[$spec['slug']] = true;
        }

        return $keys;
    }

    /** A WP revision of the post as it is now (snapshotRevision fills in its fields, keep-all, §4.7). */
    public function revisionWrite(string $collection, int|string $pk, array $encodedRow, ?int $userId): void
    {
        $id = (int) $pk;
        $rid = $this->db->core(static fn () => _wp_put_post_revision($id));
        if ($rid instanceof \WP_Error || !$rid) {
            throw new \RuntimeException('Could not save a revision of post ' . $id);
        }
        $rid = (int) $rid;
        $this->db->touchPost($rid);
        if ($userId !== null) {
            $this->db->run('UPDATE `' . $this->db->wpdb()->posts . '` SET post_author = ? WHERE ID = ?', [$userId, $rid]);
        }
        clean_post_cache($rid);
    }

    /**
     * `_wp_put_post_revision`, on every save path (Zero's, core REST, wp-admin): copy the parent's SCF
     * meta onto the new revision, plus the columns the revision post can't carry, so every revision
     * reads back as the full row it was.
     */
    public function snapshotRevision(string $collection, int $revisionId, int $postId): void
    {
        $this->db->touchPost($revisionId);
        acf_copy_metadata($postId, $revisionId);
        $parent = array_intersect_key($this->rowsWhere($collection, 'r.ID = ?', [$postId])[0] ?? [], $this->snapshotKeys($this->schema->collection($collection)));
        update_metadata('post', $revisionId, '_zero_system', wp_slash(Js::jsonStringify($parent)));
    }

    /** WP cron publishes `future` posts (§6.3); reads see the new status through the CASE mapping. */
    public function promoteDue(string $collection, string $nowIso): array
    {
        return [];
    }

    public function mapError(\Throwable $e): \Throwable
    {
        return $e;
    }
}
