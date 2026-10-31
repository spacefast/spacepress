<?php

declare(strict_types=1);

namespace Zero;

/**
 * The one pipeline (§3.3): every read and write (REST, CLI, hooks, actions, editor saves) goes through
 * here, so defaults, coercion, rules, access, drafts, revisions, FK actions and hooks always run the
 * same way. Storage is a Store; Db never builds SQL itself (Sql does) and never parses driver errors.
 *
 * A null $viewer means trusted (hooks, actions, CLI): no access checks, every status visible.
 * The request's user (`actor`) is what hooks/validators see as ctx.user, trusted or not.
 */
final class Db
{
    private const MAX_HOOK_DEPTH = 8;
    private const QUERY_OPTS = ['where', 'orderBy', 'limit', 'offset', 'columns', 'with'];

    private static ?self $instance = null;

    private int $depth = 0;
    private ?array $actor = null;

    public function __construct(
        private readonly Store $store,
        private readonly Schema $schema,
        private readonly Media $media,
        private readonly string $target = 'standalone',
    ) {
    }

    public static function setInstance(self $db): void
    {
        self::$instance = $db;
    }

    public static function instance(): self
    {
        return self::$instance ?? throw new \LogicException('Zero\Db is not initialised; call App::boot() first');
    }

    public function store(): Store
    {
        return $this->store;
    }

    public function schema(): Schema
    {
        return $this->schema;
    }

    public function media(): Media
    {
        return $this->media;
    }

    public function target(): string
    {
        return $this->target;
    }

    /** The user hooks and validators see as ctx.user for the rest of this request/command. */
    public function setActor(?array $user): void
    {
        $this->actor = $user;
    }

    public function actor(): ?array
    {
        return $this->actor;
    }

    /** @return array{user: ?array, target: string} */
    public function hookCtx(): array
    {
        return ['user' => $this->actor, 'target' => $this->target];
    }

    /** Run $fn in one store transaction (joins an open one). Any throwable rolls back. */
    public function transaction(callable $fn): mixed
    {
        return $this->store->transaction($fn);
    }

    /**
     * Lazy scheduled promotion (§6.3) for every drafts collection. No hooks, no revisions.
     *
     * @return array<string, list<int|string>> collection => promoted pks (only non-empty)
     */
    public function promoteDue(): array
    {
        $now = Js::iso(Js::now());
        $out = [];
        foreach ($this->schema->collections() as $name => $spec) {
            if ($spec['drafts'] ?? false) {
                $pks = $this->store->promoteDue((string) $name, $now);
                if ($pks !== []) {
                    $out[$name] = $pks;
                }
            }
        }

        return $out;
    }

    // ================================================================ reads

    /** @return list<array> */
    public function findMany(string $collection, array $opts = [], ?Viewer $viewer = null): array
    {
        $rows = $this->fetch($collection, $opts, '', $viewer);

        return $this->project($rows, $collection, $opts, '');
    }

    public function findFirst(string $collection, array $opts = [], ?Viewer $viewer = null): ?array
    {
        return $this->findMany($collection, ['limit' => 1] + $opts, $viewer)[0] ?? null;
    }

    /**
     * Full decoded rows (relations/media from `with` attached, `columns` not yet applied).
     * With $partition = [column, encoded values], rows are restricted to column IN values and
     * limit/offset apply per distinct column value.
     *
     * @param ?array{string, list<mixed>} $partition
     * @param list<array> $guards extra filters (access) — read guards are added here when $viewer is set
     * @return list<array>
     */
    private function fetch(string $collection, array &$opts, string $ptr, ?Viewer $viewer, ?array $partition = null, array $guards = [], ?array &$decoded = null): array
    {
        $decoded = $this->selectDecoded($collection, $opts, $ptr, $viewer, $partition, $guards);
        $rows = Extensions::read($decoded, $collection, $viewer);
        if (isset($opts['with']) && $rows !== []) {
            $rows = $this->attach($collection, $rows, $opts['with'], $ptr . '/with', $viewer, $decoded);
        }

        return $rows;
    }

    /**
     * Select full storage rows without presentation transforms; write guards remain SQL filters.
     * $filterViewer confines a write selector's relation filters to rows that viewer may read.
     */
    private function selectDecoded(string $collection, array &$opts, string $ptr, ?Viewer $viewer, ?array $partition = null, array $guards = [], ?Viewer $filterViewer = null): array
    {
        if (!$this->schema->hasCollection($collection)) {
            throw HttpError::invalidQuery("Unknown collection '$collection'", $ptr === '' ? null : $ptr);
        }
        $spec = $this->schema->collection($collection);
        // A viewer-bound mutation selector is a query too: extensions see its viewer.
        Extensions::query($collection, $opts, $viewer ?? $filterViewer, $ptr);
        foreach ($opts as $k => $_) {
            if (!in_array($k, self::QUERY_OPTS, true)) {
                throw HttpError::invalidQuery("Unknown query option '$k'", $ptr . HttpError::seg($k));
            }
        }
        if ($viewer !== null) {
            array_push($guards, ...$this->readGuards($collection, $viewer));
        }
        if ($partition !== null && $partition[1] === []) {
            return [];
        }
        $filterViewer ??= $viewer;
        $q = Sql::select($this->schema, $this->store, $collection, $opts, $partition, $ptr, $guards,
            $filterViewer === null ? null : fn (string $target): array => $this->readGuards($target, $filterViewer));
        return array_map(
            static fn (array $raw) => Schema::decodeRow($spec['columns'], $raw),
            $this->store->select($collection, $q),
        );
    }

    /** Mutation results and revision snapshots may bypass selects, or follow hooks that replace caches. */
    private function present(array $rows, string $collection, ?Viewer $viewer): array
    {
        Extensions::lookup($collection, array_column($rows, $this->schema->collection($collection)['primaryKey']));

        return Extensions::read($rows, $collection, $viewer);
    }

    /**
     * Does $viewer's read/update/delete rule (+ draft visibility for read; $data as a write's rule
     * sees it) cover row $pk? For surfaces that ask the pipeline's question outside it: core `/wp/v2`
     * and WordPress capabilities. A rule that denies outright is false, like a row it filters out.
     */
    public function permits(string $collection, string $op, int|string $pk, Viewer $viewer, ?array $data = null): bool
    {
        try {
            $guards = $op === 'read' ? $this->readGuards($collection, $viewer) : $this->writeGuards($collection, $op, $viewer, $data);
        } catch (HttpError) {
            return false;
        }

        return $this->keysMatching($collection, [$this->schema->collection($collection)['primaryKey'] => $pk], $guards) !== [];
    }

    /**
     * The primary keys $viewer's read or update rule (+ draft visibility for read) covers, or null when
     * it covers every row. Throws 401/403 when the rule denies. Rows as stored: no locale or other
     * query extension narrows them.
     *
     * @return ?list<int|string>
     */
    public function permittedKeys(string $collection, string $op, Viewer $viewer): ?array
    {
        $guards = $op === 'read' ? $this->readGuards($collection, $viewer) : $this->writeGuards($collection, $op, $viewer, null);

        return $guards === [] ? null : $this->keysMatching($collection, null, $guards);
    }

    /** @return list<int|string> primary keys of rows matching $where and every guard, as stored */
    private function keysMatching(string $collection, ?array $where, array $guards): array
    {
        $pk = $this->schema->collection($collection)['primaryKey'];
        $q = Sql::select($this->schema, $this->store, $collection, $where === null ? [] : ['where' => $where], null, '', $guards);

        return array_column($this->store->select($collection, $q), $pk);
    }

    /** The read rule (+ draft visibility) as filters; throws 401/403 when the rule is false. */
    private function readGuards(string $collection, Viewer $viewer): array
    {
        $spec = $this->schema->collection($collection);
        $rule = Access::collectionRules($spec)['read'];
        $r = Access::evaluate($rule, $viewer, 'read');
        if ($r === false) {
            throw Access::deny($viewer->user, "read $collection");
        }
        $guards = is_array($r) ? [$r] : [];
        if (($spec['drafts'] ?? false) && Access::isShorthand($rule)
            && ($viewer->user === null || Schema::roleRank($viewer->user['role']) < Schema::roleRank('editor'))) {
            $guards[] = ['status' => 'published'];
        }

        return $guards;
    }

    /** Load each requested relation with one query, never N+1; populate media columns in place. */
    private function attach(string $collection, array $rows, mixed $with, string $ptr, ?Viewer $viewer, array $decoded): array
    {
        if (!is_array($with) || ($with !== [] && array_is_list($with))) {
            throw HttpError::invalidQuery('with must be an object', $ptr);
        }
        $spec = $this->schema->collection($collection);
        $relations = $spec['relations'] ?? [];
        // Read transforms may remove a foreign key; keep linkage private while attaching relations.
        $sources = array_column($decoded, null, $spec['primaryKey']);
        $sourceFor = static fn (array $row): array => $sources[$row[$spec['primaryKey']]];
        foreach ($with as $name => $opts) {
            $name = (string) $name;
            $rptr = $ptr . HttpError::seg($name);
            $mediaCol = $spec['columns'][$name] ?? null;
            if ($mediaCol !== null && in_array($mediaCol['type'], ['media', 'mediaList'], true)) {
                if ($opts === true) {
                    $rows = $this->populateMedia($rows, $name, $mediaCol['type'] === 'mediaList');
                } elseif ($opts !== false && $opts !== null) {
                    throw HttpError::invalidQuery('Media columns take `true`', $rptr);
                }
                continue;
            }
            $rel = $relations[$name] ?? throw HttpError::invalidQuery("Unknown relation '$name'", $rptr);
            if ($opts === false || $opts === null) {
                continue;
            }
            $opts = $opts === true ? [] : $opts;
            if (!is_array($opts)) {
                throw HttpError::invalidQuery('Relation options must be true or an object', $rptr);
            }
            $keys = [];
            foreach ($rows as $row) {
                $source = $sourceFor($row);
                if ($source[$rel['from']] !== null) {
                    $keys[self::key($source[$rel['from']])] = $source[$rel['from']];
                }
            }
            $targetCols = $this->schema->collection($rel['collection'])['columns'];
            $values = array_map(
                static fn ($v) => Schema::encode(['type' => $targetCols[$rel['to']]['type']], $v, $rel['to'], ''),
                array_values($keys),
            );
            $children = $this->fetch($rel['collection'], $opts, $rptr, $viewer, [$rel['to'], $values], decoded: $childDecoded);
            $childSources = array_column($childDecoded, null, $this->schema->collection($rel['collection'])['primaryKey']);
            $childPk = $this->schema->collection($rel['collection'])['primaryKey'];
            $groups = [];
            foreach ($this->project($children, $rel['collection'], $opts, $rptr) as $i => $child) {
                $groups[self::key($childSources[$children[$i][$childPk]][$rel['to']])][] = $child;
            }
            foreach ($rows as &$row) {
                $source = $sourceFor($row);
                $group = $source[$rel['from']] === null ? [] : ($groups[self::key($source[$rel['from']])] ?? []);
                $row[$name] = $rel['kind'] === 'many' ? $group : ($group[0] ?? null);
            }
            unset($row);
        }

        return $rows;
    }

    private function populateMedia(array $rows, string $col, bool $list): array
    {
        $ids = [];
        foreach ($rows as $row) {
            if (!array_key_exists($col, $row)) {
                continue;
            }
            foreach ($list ? ($row[$col] ?? []) : [$row[$col]] as $id) {
                if ($id !== null) {
                    $ids[$id] = true;
                }
            }
        }
        $media = $this->media->getMany(array_keys($ids));
        foreach ($rows as &$row) {
            if (!array_key_exists($col, $row)) {
                continue;
            }
            if ($list) {
                $row[$col] = $row[$col] === null ? null : array_values(array_filter(array_map(static fn ($id) => $media[$id] ?? null, $row[$col])));
            } else {
                $row[$col] = $row[$col] === null ? null : ($media[$row[$col]] ?? null);
            }
        }
        unset($row);

        return $rows;
    }

    /** Apply the Drizzle `columns` selection (relations attached by `with` are kept). */
    private function project(array $rows, string $collection, array $opts, string $ptr): array
    {
        $columns = $opts['columns'] ?? null;
        if ($columns === null) {
            return $rows;
        }
        $known = $this->schema->collection($collection)['columns'];
        if (!is_array($columns) || ($columns !== [] && array_is_list($columns))) {
            throw HttpError::invalidQuery('columns must be an object', $ptr . '/columns');
        }
        foreach ($columns as $name => $on) {
            if (!isset($known[$name])) {
                throw HttpError::invalidQuery("Unknown column '$name'", $ptr . '/columns' . HttpError::seg($name));
            }
        }
        $included = array_keys(array_filter($columns, static fn ($on) => $on === true));
        $drop = $included !== []
            ? array_diff(array_keys($known), $included)
            : array_keys(array_filter($columns, static fn ($on) => $on === false));
        $drop = array_flip($drop);

        return array_map(static fn (array $row) => array_diff_key($row, $drop), $rows);
    }

    // ================================================================ writes

    /**
     * @param ?callable(callable(): array): array $around per-row persistence continuation, after access checks
     * @return ?list<array>
     */
    public function insert(string $collection, array $values, bool $returning = false, ?Viewer $viewer = null, ?callable $around = null): ?array
    {
        $rows = $values !== [] && array_is_list($values) ? $values : [$values];

        return $this->nested(function () use ($collection, $rows, $returning, $viewer, $around) {
            $spec = $this->schema->collection($collection);
            $out = [];
            foreach ($rows as $data) {
                if (!is_array($data) || ($data !== [] && array_is_list($data))) {
                    throw HttpError::invalidInput('Each row must be an object', '');
                }
                // One instant per row: every `now` default, nested ones and publishedAt included.
                $out[] = Js::atInstant(fn () => $this->createOne($collection, $spec, $data, $viewer, $around));
            }

            return $returning ? $this->present($out, $collection, $viewer) : null;
        });
    }

    /** @return ?list<array> */
    public function update(string $collection, array $set, array $where, bool $returning = false, ?Viewer $viewer = null): ?array
    {
        return $this->nested(function () use ($collection, $set, $where, $returning, $viewer) {
            $spec = $this->schema->collection($collection);
            $guards = $viewer === null ? [] : $this->writeGuards($collection, 'update', $viewer, $set);
            $out = [];
            $opts = ['where' => $where];
            foreach ($this->selectDecoded($collection, $opts, '', null, null, $guards, $viewer) as $existing) {
                $out[] = Js::atInstant(fn () => $this->updateOne($collection, $spec, $existing, $set, $viewer));
            }

            return $returning ? $this->present($out, $collection, $viewer) : null;
        });
    }

    /** @return ?list<array> */
    public function delete(string $collection, array $where, bool $returning = false, ?Viewer $viewer = null): ?array
    {
        return $this->nested(function () use ($collection, $where, $returning, $viewer) {
            $guards = $viewer === null ? [] : $this->writeGuards($collection, 'delete', $viewer, null);
            $opts = ['where' => $where];
            $rows = $this->selectDecoded($collection, $opts, '', null, null, $guards, $viewer);
            foreach ($rows as $row) {
                $this->deleteOne($collection, $row, $viewer);
            }

            return $returning ? $this->present($rows, $collection, $viewer) : null;
        });
    }

    /** update/delete rule → filters for the row select; throws 401/403 when false. */
    private function writeGuards(string $collection, string $op, Viewer $viewer, ?array $data): array
    {
        $r = Access::evaluate(Access::collectionRules($this->schema->collection($collection))[$op], $viewer, $op, $data);
        if ($r === false) {
            throw Access::deny($viewer->user, "$op $collection rows");
        }

        return is_array($r) ? [$r] : [];
    }

    private function createOne(string $collection, array $spec, array $data, ?Viewer $viewer, ?callable $around = null): array
    {
        $columns = $spec['columns'];
        $provided = $data;
        Extensions::input('create', $collection, $data, null, $viewer, $provided);
        $this->rejectUnknown($columns, $data);
        $statusGiven = array_key_exists('status', $data);
        foreach ($columns as $name => $col) {
            if (!array_key_exists($name, $data) && isset($col['default'])) {
                $data[$name] = Schema::generate($col['default'], $col['type']);
            }
        }
        if ($spec['drafts'] ?? false) {
            $data = $this->draftRules($data, $statusGiven ? null : 'published', null);
        }
        Extensions::write('create', $collection, $data, null, $viewer, $provided);
        $this->rejectUnknown($columns, $data);
        $fills = $spec['beforeCreateFills'] ?? [];
        foreach ($columns as $name => $col) {
            if (Schema::isRequired($col) && !array_key_exists($name, $data) && !in_array($name, $fills, true)
                && ($spec['slug'] ?? null) !== $name) {
                throw HttpError::invalidInput("$name is required", HttpError::seg($name));
            }
        }
        if ($viewer !== null) {
            Access::require(Access::collectionRules($spec)['create'], $viewer, 'create', $data, "create $collection rows");
        }
        $write = fn (): array => $this->persistCreate($collection, $spec, $data);

        return $around === null ? $write() : $around($write);
    }

    private function persistCreate(string $collection, array $spec, array $data): array
    {
        $columns = $spec['columns'];
        $ctx = $this->hookCtx();
        if (isset($spec['hooks']['beforeCreate'])) {
            $fn = '\\ZeroApp\\' . $spec['hooks']['beforeCreate'];
            $r = $fn($data, $ctx);
            if (is_array($r)) {
                $data = $r;
            }
            $this->rejectUnknown($columns, $data);
        }

        $norm = [];
        foreach ($columns as $name => $col) {
            $name = (string) $name;
            if ($this->derivesSlug($spec, $name, $data, !array_key_exists($name, $data))) {
                continue;
            }
            if (array_key_exists($name, $data)) {
                $norm[$name] = Schema::normalize($col, $data[$name], $name, HttpError::seg($name));
            } elseif (Schema::isRequired($col)) {
                throw HttpError::invalidInput("$name is required", HttpError::seg($name));
            }
        }
        $slugCol = $spec['slug'] ?? null;
        if ($slugCol !== null && !array_key_exists($slugCol, $norm)) {
            $norm[$slugCol] = $this->deriveSlug($collection, $spec, $norm, null);
        }
        $full = $norm + array_fill_keys(array_keys($columns), null);
        $this->checkValues($columns, $norm, $full);

        $insert = [];
        foreach ($norm as $name => $v) {
            $insert[$name] = Schema::store($columns[$name], $v);
        }
        try {
            $pk = $this->store->insert($collection, $insert);
        } catch (\Throwable $e) {
            throw $this->store->mapError($e);
        }
        [$row, $raw] = $this->readByPk($collection, $spec, $pk);
        if ($spec['revisions'] ?? false) {
            $this->store->revisionWrite($collection, $pk, $raw, $this->actor['id'] ?? null);
        }
        $this->hook($spec, 'afterCreate', $row);
        Extensions::written('create', $collection, $row, null);

        return $row;
    }

    private function updateOne(string $collection, array $spec, array $existing, array $patch, ?Viewer $viewer): array
    {
        $columns = $spec['columns'];
        $pk = $spec['primaryKey'];
        $provided = $patch;
        Extensions::input('update', $collection, $patch, $existing, $viewer, $provided);
        $this->checkPatch($spec, $existing, $patch);
        foreach ($columns as $name => $col) {
            if (isset($col['onUpdate']) && !array_key_exists($name, $patch)) {
                $patch[$name] = Schema::generate($col['onUpdate'], $col['type']);
            }
        }
        if (($spec['drafts'] ?? false) && (array_key_exists('status', $patch) || array_key_exists('publishedAt', $patch))) {
            $patch = $this->draftRules($patch, null, $existing);
        }
        $previous = $existing;
        Extensions::write('update', $collection, $patch, $previous, $viewer, $provided);
        $this->checkPatch($spec, $previous, $patch);
        $ctx = $this->hookCtx();
        if (isset($spec['hooks']['beforeUpdate'])) {
            $fn = '\\ZeroApp\\' . $spec['hooks']['beforeUpdate'];
            $r = $fn($patch, $existing, $ctx);
            if (is_array($r)) {
                $patch = $r;
            }
            $this->checkPatch($spec, $previous, $patch);
        }
        unset($patch[$pk]);
        $norm = [];
        foreach ($patch as $name => $value) {
            $name = (string) $name;
            if ($this->derivesSlug($spec, $name, $patch, false)) {
                continue;
            }
            $norm[$name] = Schema::normalize($columns[$name], $value, $name, HttpError::seg($name));
        }
        $slugCol = $spec['slug'] ?? null;
        $pkValue = $this->pkValue($spec, $previous);
        if ($slugCol !== null && array_key_exists($slugCol, $patch) && !array_key_exists($slugCol, $norm)) {
            $norm[$slugCol] = $this->deriveSlug($collection, $spec, $norm + $previous, $pkValue);
        }
        $this->checkValues($columns, $norm, $norm + $previous);

        $set = [];
        foreach ($norm as $name => $v) {
            $set[$name] = Schema::store($columns[$name], $v);
        }
        try {
            $this->store->update($collection, $pkValue, $set);
        } catch (\Throwable $e) {
            throw $this->store->mapError($e);
        }
        [$row, $raw] = $this->readByPk($collection, $spec, $pkValue);
        if ($spec['revisions'] ?? false) {
            $this->store->revisionWrite($collection, $pkValue, $raw, $this->actor['id'] ?? null);
        }
        $this->hook($spec, 'afterUpdate', $row, $previous);
        Extensions::written('update', $collection, $row, $previous);

        return $row;
    }

    private function deleteOne(string $collection, array $row, ?Viewer $viewer): void
    {
        $spec = $this->schema->collection($collection);
        $existing = $row;
        Extensions::write('delete', $collection, $row, $existing, $viewer, $existing);
        $this->hook($spec, 'beforeDelete', $row);
        $this->referentialActions($collection, $row);
        try {
            $this->store->delete($collection, $this->pkValue($spec, $row));
        } catch (\Throwable $e) {
            throw $this->store->mapError($e);
        }
        $this->hook($spec, 'afterDelete', $row);
        Extensions::written('delete', $collection, $row, $existing);
    }

    /**
     * FK actions in the pipeline (§4.2, §11.12): for every column referencing this collection, apply
     * its onDelete to the rows pointing at $row before $row goes. Hooks and revisions apply.
     */
    private function referentialActions(string $collection, array $row): void
    {
        foreach ($this->schema->collections() as $child => $cspec) {
            foreach ($cspec['columns'] as $col => $c) {
                $ref = $c['references'] ?? null;
                if ($ref === null || $ref['collection'] !== $collection || $row[$ref['column']] === null) {
                    continue;
                }
                $where = [$col => $row[$ref['column']]];
                $opts = ['where' => $where, 'limit' => 1];
                $action = strtolower($ref['onDelete'] ?? 'no action');
                if ($action === 'cascade') {
                    $this->delete((string) $child, $where);
                } elseif ($action === 'set null' || $action === 'set default') {
                    $value = $action === 'set default' && isset($c['default']) ? Schema::generate($c['default'], $c['type']) : null;
                    $this->update((string) $child, [$col => $value], $where);
                } elseif ($this->selectDecoded((string) $child, $opts, '', null) !== []) {
                    throw new HttpError(409, 'reference_violation', "Rows in $child still reference this row");
                }
            }
        }
    }

    /**
     * §6.1 transitions. $defaultStatus: 'published' when status was absent on create. $existing: the
     * row being updated (null on create).
     */
    private function draftRules(array $data, ?string $defaultStatus, ?array $existing): array
    {
        if ($defaultStatus !== null) {
            $data['status'] = $defaultStatus;
        }
        $status = array_key_exists('status', $data) ? $data['status'] : ($existing['status'] ?? null);
        $hasAt = array_key_exists('publishedAt', $data) && $data['publishedAt'] !== null;
        $now = Js::iso(Js::now());
        if ($status === 'published' && !$hasAt) {
            // Re-saving an already published row (publishedAt untouched) keeps its date.
            $keep = $existing !== null && !array_key_exists('publishedAt', $data) && $existing['status'] === 'published'
                && $existing['publishedAt'] !== null;
            if (!$keep) {
                $data['publishedAt'] = $now;
            }
        } elseif ($status === 'scheduled') {
            $at = array_key_exists('publishedAt', $data) ? $data['publishedAt'] : ($existing['publishedAt'] ?? null);
            $iso = $at === null ? null : Schema::normalize(['type' => 'timestamp'], $at, 'publishedAt', '/publishedAt');
            if ($iso === null || $iso <= $now) {
                throw HttpError::invalidInput('scheduled rows need a future publishedAt', '/publishedAt');
            }
        }

        return $data;
    }

    /** True when this column is the slug and must be derived (absent/empty on create, null on update). */
    private function derivesSlug(array $spec, string $name, array $data, bool $absent): bool
    {
        if (($spec['slug'] ?? null) !== $name || !isset($spec['columns'][$name]['source'])) {
            return false;
        }

        return $absent || $data[$name] === null || $data[$name] === '';
    }

    private function deriveSlug(string $collection, array $spec, array $row, int|string|null $self): ?string
    {
        $slugCol = $spec['slug'];
        $source = $spec['columns'][$slugCol]['source'] ?? null;
        $text = $source === null ? null : ($row[$source] ?? null);
        if (!is_string($text)) {
            return null;
        }
        $base = self::slugify($text);
        if ($base === '') {
            return null;
        }
        $pk = $spec['primaryKey'];
        for ($n = 1; ; $n++) {
            $candidate = $n === 1 ? $base : $base . '-' . $n;
            $where = [$slugCol => $candidate];
            if ($self !== null) {
                $where[$pk] = ['ne' => $self];
            }
            $opts = ['where' => $where, 'limit' => 1];
            if ($this->selectDecoded($collection, $opts, '', null) === []) {
                return $candidate;
            }
        }
    }

    public static function slugify(string $s): string
    {
        if (class_exists(\Transliterator::class) && ($t = \Transliterator::create('Any-Latin; Latin-ASCII')) !== null) {
            $s = (string) $t->transliterate($s);
        }
        $s = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-');

        return rtrim(substr($s, 0, 190), '-');
    }

    /** Rules (min/max/pattern/validate, nested) + media and reference existence for written values. */
    private function checkValues(array $columns, array $norm, array $full): void
    {
        $ctx = ['data' => $full, 'user' => $this->actor, 'target' => $this->target];
        foreach ($norm as $name => $v) {
            Schema::checkRules($columns[$name], $v, (string) $name, HttpError::seg($name), $ctx);
        }
        $refs = [];
        foreach ($norm as $name => $v) {
            array_push($refs, ...Schema::mediaRefs($columns[$name], $v, HttpError::seg($name)));
        }
        if ($refs !== []) {
            $media = $this->media->getMany(array_map(static fn ($r) => $r[0], $refs));
            foreach ($refs as [$id, $ptr, $accept]) {
                $m = $media[$id] ?? throw HttpError::invalidInput("No media with id $id", $ptr);
                if ($accept === 'image' && !str_starts_with((string) $m['mime'], 'image/')) {
                    throw HttpError::invalidInput('Only images are accepted here', $ptr);
                }
            }
        }
        foreach ($norm as $name => $v) {
            $ref = $columns[$name]['references'] ?? null;
            if ($ref === null || $v === null) {
                continue;
            }
            $opts = ['where' => [$ref['column'] => $v], 'limit' => 1];
            if ($this->selectDecoded($ref['collection'], $opts, '', null) === []) {
                throw new HttpError(409, 'reference_violation', "No {$ref['collection']} row with {$ref['column']} " . Js::str($v), HttpError::seg($name));
            }
        }
    }

    private function rejectUnknown(array $columns, array $data): void
    {
        foreach ($data as $key => $_) {
            if (!isset($columns[$key])) {
                throw HttpError::invalidInput("Unknown field '$key'", HttpError::seg($key));
            }
        }
    }

    private function checkPatch(array $spec, array $existing, array $patch): void
    {
        $this->rejectUnknown($spec['columns'], $patch);
        $pk = $spec['primaryKey'];
        if (array_key_exists($pk, $patch) && !Js::strictEq($patch[$pk], $existing[$pk])) {
            throw HttpError::invalidInput('The primary key cannot be changed', HttpError::seg($pk));
        }
    }

    /** Call a hook that receives rows (afterCreate/afterUpdate/before|afterDelete); result ignored. */
    private function hook(array $spec, string $name, array $row, ?array $previous = null): void
    {
        if (!isset($spec['hooks'][$name])) {
            return;
        }
        $fn = '\\ZeroApp\\' . $spec['hooks'][$name];
        $ctx = $this->hookCtx();
        if ($previous === null) {
            $fn($row, $ctx);
        } else {
            $fn($row, $previous, $ctx);
        }
    }

    /** @return array{array, array} [decoded row, storage-form row] */
    private function readByPk(string $collection, array $spec, int|string $pk): array
    {
        $q = Sql::select($this->schema, $this->store, $collection, ['where' => [$spec['primaryKey'] => $pk], 'limit' => 1]);
        $raw = $this->store->select($collection, $q)[0] ?? throw new \RuntimeException("Row $collection/$pk vanished after write");
        $raw = array_intersect_key($raw, $spec['columns']);

        return [Schema::decodeRow($spec['columns'], $raw), $raw];
    }

    private function pkValue(array $spec, array $row): int|string
    {
        $pk = $spec['primaryKey'];
        $v = Schema::encode($spec['columns'][$pk], $row[$pk], $pk, HttpError::seg($pk));

        return is_float($v) ? (int) $v : $v;
    }

    private function nested(callable $fn): mixed
    {
        if ($this->depth >= self::MAX_HOOK_DEPTH + 1) {
            throw new HttpError(500, 'hook_recursion', 'Hooks nested writes more than ' . self::MAX_HOOK_DEPTH . ' levels deep');
        }
        $this->depth++;
        try {
            return $this->store->transaction($fn);
        } finally {
            $this->depth--;
        }
    }

    // ================================================================ editor saves (WP, §4.9)

    /** Trusted editor capture: full decoded storage values, without display transforms or projection. */
    public function editorRow(string $collection, int|string $pk): ?array
    {
        $opts = ['where' => [$this->schema->collection($collection)['primaryKey'] => $pk], 'limit' => 1];

        return $this->selectDecoded($collection, $opts, '', null)[0] ?? null;
    }

    /**
     * After a wp-admin/core REST save: afterCreate (no $previousRow) or afterUpdate, with the row
     * re-read through the store. Counts toward MAX_HOOK_DEPTH. Runs in one transaction.
     */
    public function afterEditorSave(string $collection, int|string $pk, ?array $previousRow, ?array $user = null): void
    {
        $this->asEditor($user, function () use ($collection, $pk, $previousRow) {
            $spec = $this->schema->collection($collection);
            [$row] = $this->readByPk($collection, $spec, $pk);
            $previousRow === null ? $this->hook($spec, 'afterCreate', $row) : $this->hook($spec, 'afterUpdate', $row, $previousRow);
            Extensions::written($previousRow === null ? 'create' : 'update', $collection, $row, $previousRow);
        });
    }

    /** Before an editor-side delete: beforeDelete($row) and the pipeline FK actions. */
    public function beforeEditorDelete(string $collection, array $row, ?array $user = null): void
    {
        $this->asEditor($user, function () use ($collection, $row) {
            $spec = $this->schema->collection($collection);
            $existing = $row;
            Extensions::write('delete', $collection, $row, $existing, null, $existing);
            $this->hook($spec, 'beforeDelete', $row);
            $this->referentialActions($collection, $row);
        });
    }

    /** After an editor-side delete: afterDelete($row). */
    public function afterEditorDelete(string $collection, array $row, ?array $user = null): void
    {
        $this->asEditor($user, function () use ($collection, $row) {
            $this->hook($this->schema->collection($collection), 'afterDelete', $row);
            Extensions::written('delete', $collection, $row, $row);
        });
    }

    private function asEditor(?array $user, callable $fn): void
    {
        $prev = $this->actor;
        $this->actor = $user;
        try {
            $this->nested($fn);
        } finally {
            $this->actor = $prev;
        }
    }

    // ================================================================ revisions (§6.4)

    /** @return list<array{id: int, at: string, userId: ?int}> newest first; needs update access on the row */
    public function revisions(string $collection, int|string $pk, ?Viewer $viewer = null): array
    {
        $this->requireRevisable($collection, $pk, $viewer);

        return array_map(
            static fn (array $r) => ['id' => $r['id'], 'at' => $r['at'], 'userId' => $r['userId']],
            $this->store->revisions($collection, $pk),
        );
    }

    /** The full decoded row at a revision. */
    public function revision(string $collection, int|string $pk, int $revisionId, ?Viewer $viewer = null): array
    {
        $this->requireRevisable($collection, $pk, $viewer);

        return $this->present([$this->revisionRow($collection, $pk, $revisionId)], $collection, $viewer)[0]
            ?? throw HttpError::notFound("No revision $revisionId for $collection $pk");
    }

    /** The decoded row a revision (or autosave) holds, trusted: no access checks. */
    public function revisionRow(string $collection, int|string $pk, int $revisionId): array
    {
        $rev = $this->store->revision($collection, $pk, $revisionId)
            ?? throw HttpError::notFound("No revision $revisionId for $collection $pk");

        return Schema::decodeRow($this->schema->collection($collection)['columns'], $rev['row']);
    }

    /**
     * Restore: the revision's user columns become an update patch (pk, system columns and onUpdate
     * columns excluded), run through the full update pipeline.
     */
    public function restoreRevision(string $collection, int|string $pk, int $revisionId, ?Viewer $viewer = null): array
    {
        $spec = $this->schema->collection($collection);
        $this->requireRevisable($collection, $pk, $viewer);
        $row = $this->revisionRow($collection, $pk, $revisionId);
        $patch = [];
        foreach ($spec['columns'] as $name => $col) {
            if ($name !== $spec['primaryKey'] && !($col['system'] ?? false) && !isset($col['onUpdate'])) {
                $patch[$name] = $row[$name];
            }
        }

        return $this->update($collection, $patch, [$spec['primaryKey'] => $pk], true, $viewer)[0]
            ?? throw HttpError::notFound("No $collection row $pk");
    }

    private function requireRevisable(string $collection, int|string $pk, ?Viewer $viewer): void
    {
        $spec = $this->schema->collection($collection);
        if (!($spec['revisions'] ?? false)) {
            throw HttpError::notFound("$collection keeps no revisions");
        }
        $guards = $viewer === null ? [] : $this->writeGuards($collection, 'update', $viewer, null);
        $opts = ['where' => [$spec['primaryKey'] => $pk], 'limit' => 1];
        if ($this->selectDecoded($collection, $opts, '', null, null, $guards) === []) {
            throw HttpError::notFound("No $collection row $pk");
        }
    }

    // ================================================================ globals (§3.6)

    /** Current values (JS form); never-written fields read as their defaults. */
    public function globalGet(string $name, ?Viewer $viewer = null): array
    {
        $g = $this->schema->global($name);
        if ($viewer !== null) {
            Access::require(Access::globalRules($g)['read'], $viewer, 'read', null, "read $name");
        }
        $stored = $this->store->globalRead($name) ?? [];
        $out = [];
        foreach ($g['fields'] as $field => $f) {
            if (array_key_exists($field, $stored)) {
                $out[$field] = Schema::decode($f, $stored[$field]);
            } else {
                $out[$field] = isset($f['default']) ? Schema::normalize($f, Schema::generate($f['default'], $f['type']), (string) $field, '') : null;
            }
        }

        return $out;
    }

    public function globalUpdate(string $name, array $patch, ?Viewer $viewer = null): array
    {
        $g = $this->schema->global($name);
        if ($viewer !== null) {
            Access::require(Access::globalRules($g)['update'], $viewer, 'update', $patch, "update $name");
        }
        $fields = $g['fields'];
        $this->rejectUnknown($fields, $patch);

        // One instant: never-written fields' `now` defaults and the patch's nested defaults agree.
        return Js::atInstant(fn () => $this->transaction(function () use ($name, $fields, $patch) {
            $current = $this->globalGet($name);
            $norm = [];
            foreach ($patch as $field => $v) {
                $norm[$field] = Schema::normalize($fields[$field], $v, (string) $field, HttpError::seg($field));
            }
            $this->checkValues($fields, $norm, $norm + $current);
            $values = [];
            foreach ($norm + $current as $field => $v) {
                $values[$field] = Schema::store($fields[$field], $v);
            }
            $this->store->globalWrite($name, $values);

            return $this->globalGet($name);
        }));
    }

    // ================================================================ media (§4.6)

    public function mediaUpload(string $tmpPath, string $filename, ?string $alt, ?Viewer $viewer = null): array
    {
        if ($viewer !== null) {
            Access::require(Access::MEDIA['create'], $viewer, 'create', null, 'upload media');
        }

        return $this->transaction(fn () => $this->media->upload($tmpPath, $filename, $this->actor, $alt));
    }

    public function mediaGet(int $id): ?array
    {
        return $this->media->get($id);
    }

    public function mediaList(array $opts): array
    {
        return $this->media->list($opts);
    }

    /** Delete a media row: null `media` columns and drop the id from `mediaList` columns first (hooks + revisions apply). */
    public function mediaDelete(int $id, ?Viewer $viewer = null): ?array
    {
        if ($viewer !== null) {
            Access::require(Access::MEDIA['delete'], $viewer, 'delete', null, 'delete media');
        }

        return $this->nested(function () use ($id) {
            $row = $this->media->get($id);
            if ($row === null) {
                return null;
            }
            foreach ($this->schema->collections() as $c => $spec) {
                foreach ($spec['columns'] as $col => $def) {
                    if ($def['type'] === 'media') {
                        $this->update((string) $c, [$col => null], [$col => $id]);
                    } elseif ($def['type'] === 'mediaList') {
                        $pk = $spec['primaryKey'];
                        $opts = ['where' => [$col => ['has' => $id]]];
                        foreach ($this->selectDecoded((string) $c, $opts, '', null) as $r) {
                            $kept = array_values(array_filter($r[$col], static fn ($x) => $x !== $id));
                            $this->update((string) $c, [$col => $kept], [$pk => $r[$pk]]);
                        }
                    }
                }
            }
            $this->media->delete($id);

            return $row;
        });
    }

    // ================================================================ helpers

    private static function key(mixed $v): string
    {
        return is_string($v) ? 's' . $v : 'n' . Js::str($v);
    }
}

function db(): Db
{
    return Db::instance();
}
