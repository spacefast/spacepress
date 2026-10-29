<?php

declare(strict_types=1);

namespace Zero\Sync;

use Zero\Access;
use Zero\App;
use Zero\Extensions;
use Zero\HttpError;
use Zero\Js;
use Zero\Response;
use Zero\Viewer;

use function Zero\db;

/**
 * `/sync/{collection}` (§5.3): paged reads of every record, guarded writes keyed by uid with an expected
 * digest, trash, and the two pure helpers the CLI delegates to (body conversion and three-way merge).
 */
final class Routes
{
    private const PAGE = 100;
    private const BATCH = 100;

    /** @return array{int, mixed}|Response */
    public static function dispatch(string $method, array $segments, array $query, string $body, Viewer $viewer, array $files, array $form): array|Response
    {
        $n = count($segments);
        if ($n < 2 || $n > 3) {
            throw HttpError::notFound('No such sync route');
        }
        $collection = $segments[1];
        $spec = db()->schema()->collection($collection);
        if (($spec['sync'] ?? null) === null) {
            throw HttpError::notFound("$collection does not sync with files");
        }
        $action = $segments[2] ?? null;
        if ($action === null) {
            App::allow($method, ['GET', 'POST']);
            if ($method === 'GET') {
                self::requireSyncRead($spec, $viewer, $collection);

                return [200, self::page($collection, $spec, $query, $viewer)];
            }

            return self::apply($collection, $spec, self::input($body), $viewer);
        }
        App::allow($method, ['POST']);

        return match ($action) {
            'trash' => self::trash($collection, $spec, self::input($body), $viewer),
            'convert' => [200, self::batch($spec, self::input($body), $viewer, $collection, self::convert(...))],
            'merge' => [200, self::batch($spec, self::input($body), $viewer, $collection, self::merge(...))],
            default => throw HttpError::notFound('No such sync route'),
        };
    }

    // ================================================================ read

    private static function page(string $collection, array $spec, array $query, Viewer $viewer): array
    {
        $after = self::intParam($query, 'after', 0, PHP_INT_MAX) ?? 0;
        $first = self::intParam($query, 'first', 1, self::PAGE) ?? self::PAGE;
        $pk = $spec['primaryKey'];
        $rows = self::rows($collection, ['where' => [$pk => ['gt' => $after]], 'orderBy' => [$pk => 'asc'], 'limit' => $first + 1], $viewer);
        $items = [];
        foreach (Wire::encode($collection, $rows) as $i => $item) {
            $items[] = [$rows[$i][$pk], isset($item['record'])
                ? ['record' => $item['record'], 'digest' => $item['digest'], 'trashed' => false]
                : $item + ['trashed' => false]];
        }
        foreach (Trash::listed($collection, $spec, $after, $first + 1) as $id => $uid) {
            $items[] = [$id, ['uid' => $uid, 'record' => null, 'digest' => null, 'trashed' => true]];
        }
        usort($items, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
        $more = count($items) > $first;
        $items = array_slice($items, 0, $first);

        return ['records' => array_column($items, 1), 'next' => $more ? $items[$first - 1][0] : null];
    }

    /** Every status, trusted selection; then the viewer's read transforms (field access) as any read. */
    private static function rows(string $collection, array $opts, ?Viewer $viewer): array
    {
        $rows = Module::ensureUids($collection, Module::find($collection, $opts));

        return Extensions::read($rows, $collection, $viewer);
    }

    /** @return ?array{record?: array, digest?: string, refused?: string, message?: string, row: array} */
    private static function current(string $collection, string $uid, ?Viewer $viewer): ?array
    {
        $row = self::rows($collection, ['where' => ['uid' => $uid], 'limit' => 1], $viewer)[0] ?? null;

        return $row === null ? null : Wire::encode($collection, [$row])[0] + ['row' => $row];
    }

    // ================================================================ write

    private static function apply(string $collection, array $spec, array $in, Viewer $viewer): array|Response
    {
        $record = $in['record'] ?? null;
        if (!is_array($record) || ($record !== [] && array_is_list($record))) {
            throw HttpError::invalidInput('record must be an object', '/record');
        }
        $uid = $record['uid'] ?? null;
        if (!Uid::valid($uid)) {
            throw HttpError::invalidInput('record.uid must match zr_ + 20 hex characters', '/uid');
        }
        $expect = self::expect($in);
        $current = self::current($collection, $uid, $viewer);
        // Restoring from the trash is a push of a record the site no longer lists as live.
        $restored = $current === null && $expect === 'absent' && Trash::restore($collection, $spec, $uid);
        if ($restored) {
            $current = self::current($collection, $uid, $viewer);
        } elseif ($expect !== self::digestOf($current) || ($current !== null && !Lock::fresh($collection, $current['row'][$spec['primaryKey']]))) {
            return self::stale($spec, $viewer, $current, "$collection $uid changed since it was read");
        }
        $sent = Wire::record($uid, $record['fields'] ?? [], $record['body'] ?? null);
        if (!$restored && $current !== null && Canon::digest($sent) === $current['digest']) {
            return [200, ['uid' => $uid, 'digest' => $current['digest'], 'status' => 'unchanged']];
        }
        $data = Wire::decode($collection, $record);
        $pk = $spec['primaryKey'];
        // The pipeline authorizes: the create rule for a new uid, the update rule (filters included) otherwise.
        $current === null
            ? db()->insert($collection, ['uid' => $uid] + $data, false, $viewer)
            : (db()->update($collection, $data, [$pk => $current['row'][$pk]], true, $viewer)[0]
                ?? throw Access::deny($viewer->user, "update this $collection row"));
        $stored = self::current($collection, $uid, null) ?? throw new \RuntimeException("$collection $uid vanished after write");
        if (!isset($stored['record'])) {
            throw new HttpError(422, 'not_representable', $stored['message'] ?? 'The stored record cannot be written back');
        }
        $normalized = $stored['digest'] !== Canon::digest($sent);
        $out = ['uid' => $uid, 'digest' => $stored['digest'], 'status' => $normalized ? 'normalized' : 'applied'];
        if ($normalized && self::maySyncRead($spec, $viewer)) {
            $out['record'] = $stored['record'];
        }

        return [$current === null ? 201 : 200, $out];
    }

    private static function trash(string $collection, array $spec, array $in, Viewer $viewer): array|Response
    {
        $uid = $in['uid'] ?? null;
        if (!Uid::valid($uid)) {
            throw HttpError::invalidInput('uid must match zr_ + 20 hex characters', '/uid');
        }
        $expect = self::expect($in);
        $rule = Access::evaluate(Access::collectionRules($spec)['delete'], $viewer, 'delete');
        if ($rule === false) {
            throw Access::deny($viewer->user, "trash $collection rows");
        }
        $current = self::current($collection, $uid, $viewer);
        if ($current === null) {
            return [200, ['uid' => $uid, 'status' => 'unchanged']];
        }
        $pk = $spec['primaryKey'];
        $id = $current['row'][$pk];
        if (is_array($rule) && Module::find($collection, ['where' => ['AND' => [[$pk => $id], $rule]], 'limit' => 1]) === []) {
            throw Access::deny($viewer->user, "trash this $collection row");
        }
        if ($expect !== self::digestOf($current) || !Lock::fresh($collection, $id)) {
            return self::stale($spec, $viewer, $current, "$collection $uid changed since it was read");
        }
        if (!Trash::trash($collection, $spec, db()->editorRow($collection, $id))) {
            db()->delete($collection, [$pk => $id], false, $viewer);
        }

        return [200, ['uid' => $uid, 'status' => 'applied']];
    }

    // ================================================================ pure helpers

    /** One item or `{ records: [...] }` (≤ 100), answered item by item. */
    private static function batch(array $spec, array $in, Viewer $viewer, string $collection, callable $one): array
    {
        self::requireSyncRead($spec, $viewer, $collection);
        if (!array_key_exists('records', $in)) {
            return $one($in, '');
        }
        $items = $in['records'];
        if (!is_array($items) || !array_is_list($items) || count($items) > self::BATCH) {
            throw HttpError::invalidInput('records must be a list of at most ' . self::BATCH . ' items', '/records');
        }
        $out = [];
        foreach ($items as $i => $item) {
            if (!is_array($item)) {
                throw HttpError::invalidInput('Each item must be an object', "/records/$i");
            }
            try {
                $out[] = $one($item, "/records/$i");
            } catch (HttpError $e) {
                if ($e->errorCode !== 'not_representable') {
                    throw $e;
                }
                $out[] = ['refused' => 'not_representable', 'message' => $e->getMessage()];
            }
        }

        return ['records' => $out];
    }

    private static function convert(array $in, string $ptr): array
    {
        $text = self::text($in, 'text', $ptr);

        return ['text' => match ($in['direction'] ?? null) {
            'toMarkdown' => Markdown::fromBlocks($text),
            'toBlocks' => Markdown::toBlocks($text),
            'toHtml' => Html::strip($text),
            'fromHtml' => Html::fromHtml($text),
            default => throw HttpError::invalidInput('direction must be toMarkdown, toBlocks, toHtml or fromHtml', "$ptr/direction"),
        }];
    }

    private static function merge(array $in, string $ptr): array
    {
        return Merge::bodies(self::text($in, 'base', $ptr), self::text($in, 'ours', $ptr), self::text($in, 'theirs', $ptr));
    }

    // ================================================================ helpers

    /**
     * Reading a collection as sync records (pull, conversions, the `current` record of a conflict) needs
     * its update rule to allow every row: true, not a filter. Writes are authorized row by row instead.
     */
    private static function maySyncRead(array $spec, Viewer $viewer): bool
    {
        return Access::evaluate(Access::collectionRules($spec)['update'], $viewer, 'update') === true;
    }

    private static function requireSyncRead(array $spec, Viewer $viewer, string $collection): void
    {
        if (!self::maySyncRead($spec, $viewer)) {
            throw Access::deny($viewer->user, "sync $collection");
        }
    }

    private static function digestOf(?array $current): string
    {
        return $current === null ? 'absent' : ($current['digest'] ?? 'refused');
    }

    private static function expect(array $in): string
    {
        $expect = $in['expect'] ?? null;
        if ($expect !== 'absent' && !(is_string($expect) && preg_match('/^sha256:[0-9a-f]{64}$/D', $expect))) {
            throw HttpError::invalidInput('expect must be "absent" or "sha256:<64 hex>"', '/expect');
        }

        return $expect;
    }

    /** 409 sync_stale; `current` (the record now stored, or null when absent) only for callers who may sync-read. */
    private static function stale(array $spec, Viewer $viewer, ?array $current, string $detail): Response
    {
        $problem = App::problem(new HttpError(409, 'sync_stale', $detail));
        if (self::maySyncRead($spec, $viewer)) {
            $problem['current'] = $current === null ? null : array_diff_key($current, ['row' => true, 'uid' => true]);
        }

        return Response::raw(Js::jsonStringify($problem) ?? '{}', 409, ['Content-Type' => 'application/problem+json']);
    }

    private static function input(string $body): array
    {
        try {
            $in = trim($body) === '' ? [] : json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage());
        }
        if (!is_array($in) || ($in !== [] && array_is_list($in))) {
            throw HttpError::invalidInput('Body must be a JSON object', '');
        }

        return $in;
    }

    private static function text(array $in, string $key, string $ptr): string
    {
        return is_string($in[$key] ?? null) ? $in[$key] : throw HttpError::invalidInput("$key must be a string", "$ptr/$key");
    }

    private static function intParam(array $query, string $key, int $min, int $max): ?int
    {
        if (!isset($query[$key])) {
            return null;
        }
        $v = $query[$key];
        if (!is_string($v) || !preg_match('/^\d{1,18}$/D', $v) || (int) $v < $min || (int) $v > $max) {
            throw HttpError::invalidQuery("$key must be an integer from $min to $max", "/$key");
        }

        return (int) $v;
    }
}
