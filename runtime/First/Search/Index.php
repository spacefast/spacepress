<?php

declare(strict_types=1);

namespace First\Search;

use First\Extensions;
use First\FieldAccess;
use First\HttpError;
use First\Jobs\Jobs;
use First\Schema;
use First\SqlPredicate;
use First\Viewer;

use function First\db;

/**
 * The search index (docs/decisions/2026-11-13-search-index.md): one row per (kind, row, field) in
 * `first__search`, holding the field's text as a visitor would read it. The index is a candidate
 * filter only. A query matches terms against it and hands the matching row ids to the kind's own
 * read pipeline as one more condition, so the read rule, draft visibility, a filter rule and field
 * access decide which rows come back, how many there are and in what order, exactly as for any list.
 *
 * - Searchable fields (spec §2.6): the title, the content and every text and richText field. A
 *   field the viewer may not read is not matched, so a hidden value can't be found, counted or
 *   ranked: each field is its own index row, and only the readable fields' rows are consulted.
 * - Kept in step on write: every pipeline write (API, actions, hooks, jobs, wp-admin saves) reports
 *   through `Extensions::onWritten` inside its transaction, and the row's index entries are replaced
 *   there, so the index commits or rolls back with the write. Scheduled promotion changes status
 *   only, which the index doesn't hold. A full rebuild of a kind runs as an Action Scheduler job
 *   (`first.search.reindex`), queued when a build's searchable fields change.
 * - MySQL and MariaDB: a FULLTEXT index, queried in boolean mode with each term as a prefix. The
 *   SQLite translator (dev sites, Playground) accepts the index but not `MATCH`, so it matches each
 *   term as a word prefix with `LIKE` over the same rows.
 */
final class Index
{
    public const TABLE = 'first__search';
    public const JOB = 'first.search.reindex';
    /** Longest search text: more terms than this add nothing a person types. */
    public const MAX_QUERY = 200;
    /** Terms of a query; the rest are ignored. */
    public const MAX_TERMS = 8;
    /** Rows a kind's rebuild indexes per job run before it queues the next run. */
    public const BATCH = 200;
    /** The option that records which searchable fields each kind was last indexed with. */
    private const SHAPE = 'first_search_shape';

    private static bool $registered = false;

    public static function register(): void
    {
        if (self::$registered) {
            return;
        }
        self::$registered = true;
        \First\SystemTables::register('__' . self::TABLE, [
            'CREATE TABLE IF NOT EXISTS `{prefix}' . self::TABLE . '` (`kind` VARCHAR(64) NOT NULL, `item` VARCHAR(191) NOT NULL, `field` VARCHAR(64) NOT NULL, '
            . '`body` LONGTEXT NOT NULL, PRIMARY KEY (`kind`, `item`, `field`), KEY `item` (`kind`, `item`), FULLTEXT KEY `body` (`body`)) '
            . 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        ]);
        Extensions::onWritten(self::written(...));
    }

    /** The runtime-native job that rebuilds one kind's entries, a batch per run (Action Scheduler). */
    public static function jobSpec(): array
    {
        return [
            'input' => ['kind' => ['type' => 'text', 'notNull' => true], 'after' => ['type' => 'text']],
            'handler' => [self::class, 'rebuild'], 'retries' => 5, 'agents' => false,
        ];
    }

    // ================================================================ which fields

    /** @return list<string> the kind's searchable fields: title, content, text and richText, never system ones */
    public static function fields(array $spec): array
    {
        $out = [];
        foreach ($spec['columns'] as $name => $col) {
            $name = (string) $name;
            if (($col['hidden'] ?? false) || ($col['system'] ?? false) && $name !== ($spec['title'] ?? null) && $name !== ($spec['content'] ?? null)) {
                continue;
            }
            if ($name === ($spec['title'] ?? null) || $name === ($spec['content'] ?? null)
                || in_array($col['type'], ['text', 'richText'], true) && !isset($col['enum'])) {
                $out[] = $name;
            }
        }

        return $out;
    }

    /** The searchable fields $viewer may read in every row: a field that may be hidden is never matched. */
    public static function readable(array $spec, ?Viewer $viewer): array
    {
        return array_values(array_filter(self::fields($spec), static fn (string $f): bool => $viewer === null || !FieldAccess::mayHide($spec['columns'][$f], $viewer)));
    }

    // ================================================================ writing

    /** Extensions::onWritten: the row's entries, replaced inside the write's transaction. */
    public static function written(string $op, string $collection, array $row, ?array $previous): void
    {
        $schema = db()->schema();
        if (!$schema->hasCollection($collection) || !Storage::ready()) {
            return;
        }
        $spec = $schema->collection($collection);
        $fields = self::fields($spec);
        if ($fields === []) {
            return;
        }
        $id = $row[$spec['primaryKey']] ?? $previous[$spec['primaryKey']] ?? null;
        if (!is_int($id) && !is_string($id)) {
            return;
        }
        if ($op === 'delete') {
            Storage::run('DELETE FROM {search} WHERE "kind" = ? AND "item" = ?', [$collection, (string) $id]);

            return;
        }
        self::put($collection, (string) $id, $fields, $row);
    }

    /** @param list<string> $fields */
    private static function put(string $collection, string $id, array $fields, array $row): void
    {
        Storage::run('DELETE FROM {search} WHERE "kind" = ? AND "item" = ?', [$collection, $id]);
        foreach ($fields as $field) {
            $text = self::text($row[$field] ?? null);
            if ($text !== '') {
                Storage::run('INSERT INTO {search} ("kind", "item", "field", "body") VALUES (?, ?, ?, ?)', [$collection, $id, $field, $text]);
            }
        }
    }

    /** A stored value as the words a reader sees: markup and block comments gone, entities decoded. */
    public static function text(mixed $value): string
    {
        if (!is_string($value) || $value === '') {
            return '';
        }
        $text = preg_replace('/<!--.*?-->/s', ' ', $value) ?? $value;
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }

    /**
     * One run of a kind's rebuild: the next BATCH rows after `after`, read as the system (the index
     * holds every row; reads filter), then the next run is queued. The first run clears the kind.
     *
     * @param array{kind: string, after?: ?string} $input
     */
    public static function rebuild(array $input, array $ctx = []): void
    {
        $kind = (string) $input['kind'];
        $schema = db()->schema();
        if (!$schema->hasCollection($kind) || !Storage::ready()) {
            return;
        }
        $spec = $schema->collection($kind);
        $pk = $spec['primaryKey'];
        $fields = self::fields($spec);
        $after = $input['after'] ?? null;
        db()->transaction(static function () use ($kind, $spec, $pk, $fields, $after): void {
            if ($after === null) {
                Storage::run('DELETE FROM {search} WHERE "kind" = ?', [$kind]);
            }
            if ($fields === []) {
                return;
            }
            $where = $after === null ? [] : ['where' => [$pk => ['gt' => is_numeric($after) && $spec['columns'][$pk]['type'] === 'integer' ? (int) $after : $after]]];
            $columns = array_fill_keys([$pk, ...$fields], true);
            $rows = db()->findMany($kind, $where + ['columns' => $columns, 'orderBy' => [$pk => 'asc'], 'limit' => self::BATCH] + self::everyLocale($kind));
            foreach ($rows as $row) {
                self::put($kind, (string) $row[$pk], $fields, $row);
            }
            if (count($rows) === self::BATCH) {
                Jobs::enqueue(self::JOB, ['kind' => $kind, 'after' => (string) $rows[count($rows) - 1][$pk]], ['key' => "$kind:" . $rows[count($rows) - 1][$pk]]);
            }
        });
    }

    /**
     * After a build (the plugin's first request on a new schema): each kind whose searchable fields
     * changed is rebuilt by a job, once. Nothing runs when nothing changed.
     */
    public static function reindexChanged(): void
    {
        $plugin = \First\Wp\Plugin::instance();
        if ($plugin === null || $plugin->unavailable() !== null) {
            return;
        }
        $plugin->app();
        if (!Storage::ready()) {
            return;
        }
        $shape = [];
        foreach (db()->schema()->collections() as $name => $spec) {
            $fields = self::fields($spec);
            if ($fields !== []) {
                $shape[(string) $name] = $fields;
            }
        }
        $previous = get_option(self::SHAPE, null);
        $previous = is_array($previous) ? $previous : [];
        if ($previous === $shape) {
            return;
        }
        db()->transaction(static function () use ($shape, $previous): void {
            foreach ($shape as $kind => $fields) {
                // A kind with no rows yet (a new kind, a new site) has nothing to index: its rows are
                // indexed as they are written.
                if (($previous[$kind] ?? null) !== $fields && db()->count($kind, null, null, self::everyLocale($kind)) > 0) {
                    Jobs::enqueue(self::JOB, ['kind' => $kind, 'after' => null], ['key' => "$kind:start"]);
                }
            }
            foreach (array_keys(array_diff_key($previous, $shape)) as $gone) {
                Storage::run('DELETE FROM {search} WHERE "kind" = ?', [(string) $gone]);
            }
            update_option(self::SHAPE, $shape, false);
        });
    }

    // ================================================================ reading

    /**
     * The condition a `search` adds to a list of $collection for $viewer: the rows whose readable
     * searchable fields hold every term, among $only when given (core's `search_columns`). Null when
     * the viewer may read none of the fields or the text has no word: the read then matches nothing.
     */
    public static function predicate(string $collection, string $search, ?Viewer $viewer, ?array $only = null): ?SqlPredicate
    {
        $spec = db()->schema()->collection($collection);
        $fields = self::readable($spec, $viewer);
        if ($only !== null) {
            $fields = array_values(array_intersect($fields, $only));
        }
        $terms = self::terms($search);
        if ($fields === [] || $terms === []) {
            return null;
        }
        // The row's primary key as the store selects it (a post kind's `ID`, a table's own column).
        $key = db()->store()->source($collection)->columns[$spec['primaryKey']]->expr;
        $table = Storage::table();
        $match = Storage::match($terms);
        $in = implode(', ', array_fill(0, count($fields), '?'));
        // Every term in some readable field of the row (one EXISTS per term), so a term found only in
        // a hidden field never qualifies a row.
        $sql = [];
        $params = [];
        foreach ($match as [$condition, $values]) {
            $sql[] = "EXISTS (SELECT 1 FROM $table s WHERE s.`kind` = ? AND s.`item` = CAST($key AS CHAR) AND s.`field` IN ($in) AND $condition)";
            array_push($params, $collection, ...$fields, ...$values);
        }

        return new SqlPredicate(implode(' AND ', $sql), $params);
    }

    /** @return list<string> the words of a query, at most MAX_TERMS, without operators */
    public static function terms(string $search): array
    {
        if (mb_strlen($search, 'UTF-8') > self::MAX_QUERY) {
            throw HttpError::invalidQuery('search is at most ' . self::MAX_QUERY . ' characters', '/search');
        }
        preg_match_all('/[\p{L}\p{N}]+/u', mb_strtolower($search, 'UTF-8'), $m);

        return array_slice(array_values(array_unique($m[0])), 0, self::MAX_TERMS);
    }

    private static function everyLocale(string $kind): array
    {
        return \First\Locale\Module::localized($kind) ? ['locale' => '*'] : [];
    }

    /** Ids of the kinds a site-wide search covers: every kind with a searchable field and an API list. */
    public static function kinds(): array
    {
        $out = [];
        foreach (db()->schema()->collections() as $name => $spec) {
            if (self::fields($spec) !== [] && ($spec['api']['list'] ?? true)) {
                $out[] = (string) $name;
            }
        }

        return $out;
    }
}
