<?php

declare(strict_types=1);

namespace Zero\Sync;

use Zero\HttpError;

use function Zero\db;

/**
 * Rows ⇄ sync records (§5.3). A record is `{ uid, fields, body }`: `fields` holds every column except the
 * primary key, the content column, `uid` itself and values the server generates (`onUpdate`, derived and
 * hidden columns); `body` is the content column, as Markdown for `md` collections whose content is
 * richText and verbatim otherwise. Reference columns travel as the target row's uid.
 */
final class Wire
{
    /** @return list<string> the columns a record's `fields` carries, in schema order */
    public static function fieldNames(array $spec): array
    {
        $names = [];
        foreach ($spec['columns'] as $name => $col) {
            $name = (string) $name;
            if ($name === $spec['primaryKey'] || $name === ($spec['content'] ?? null) || $name === 'uid'
                || isset($col['onUpdate']) || ($col['derived'] ?? false) || ($col['hidden'] ?? false)) {
                continue;
            }
            $names[] = $name;
        }

        return $names;
    }

    /**
     * Encode rows (as the viewer may read them) into records. A row whose body can't be written in the
     * collection's format comes back as `refused` instead of a record; it is never dropped.
     *
     * @param list<array> $rows
     * @return list<array{uid: string, record?: array, digest?: string, refused?: string, message?: string}>
     */
    public static function encode(string $collection, array $rows): array
    {
        $spec = db()->schema()->collection($collection);
        $names = self::fieldNames($spec);
        $uids = self::targetUids($spec, $rows);
        $out = [];
        foreach ($rows as $row) {
            $fields = [];
            foreach ($names as $name) {
                if (!array_key_exists($name, $row)) {
                    continue; // hidden from this viewer by field access
                }
                $ref = $spec['columns'][$name]['references'] ?? null;
                $value = $row[$name];
                $fields[$name] = $ref === null || $value === null ? $value : ($uids[$name][self::key($value)] ?? null);
            }
            try {
                $body = self::bodyOut($spec, $row);
            } catch (HttpError $e) {
                if ($e->errorCode !== 'not_representable') {
                    throw $e;
                }
                $out[] = ['uid' => $row['uid'], 'refused' => 'not_representable', 'message' => "{$collection} {$row[$spec['primaryKey']]}: " . $e->getMessage()];
                continue;
            }
            $record = self::record($row['uid'], $fields, $body);
            $out[] = ['uid' => $row['uid'], 'record' => $record, 'digest' => Canon::digest($record)];
        }

        return $out;
    }

    /** PHP decodes `{}` as an empty array; `fields` is always an object on the wire and in digests. */
    public static function record(string $uid, mixed $fields, mixed $body): array
    {
        return ['uid' => $uid, 'fields' => $fields === [] ? new \stdClass() : $fields, 'body' => $body];
    }

    /**
     * A record as a write: the column values it sets (references resolved to ids, body converted to the
     * stored form). Only the keys present in `fields` are set.
     */
    public static function decode(string $collection, array $record): array
    {
        $spec = db()->schema()->collection($collection);
        $fields = $record['fields'] ?? [];
        if (!is_array($fields) || ($fields !== [] && array_is_list($fields))) {
            throw HttpError::invalidInput('fields must be an object', '/fields');
        }
        $allowed = array_flip(self::fieldNames($spec));
        $data = [];
        foreach ($fields as $name => $value) {
            $name = (string) $name;
            if (!isset($allowed[$name])) {
                throw HttpError::invalidInput("Unknown or generated field '$name'", '/fields' . HttpError::seg($name));
            }
            $ref = $spec['columns'][$name]['references'] ?? null;
            $data[$name] = $ref === null || $value === null ? $value : self::resolve($ref, $name, $value);
        }
        $content = $spec['content'] ?? null;
        if ($content !== null && array_key_exists('body', $record)) {
            $body = $record['body'];
            if ($body !== null && !is_string($body)) {
                throw HttpError::invalidInput('body must be a string or null', '/body');
            }
            $data[$content] = $body === null ? null : self::bodyIn($spec, $body);
        }

        return $data;
    }

    private static function markdown(array $spec): bool
    {
        $content = $spec['content'] ?? null;

        return ($spec['sync']['format'] ?? null) === 'md' && $content !== null && ($spec['columns'][$content]['type'] ?? null) === 'richText';
    }

    private static function bodyOut(array $spec, array $row): ?string
    {
        $content = $spec['content'] ?? null;
        if ($content === null || !array_key_exists($content, $row) || $row[$content] === null) {
            return null;
        }

        return self::markdown($spec) ? Markdown::fromBlocks((string) $row[$content]) : (string) $row[$content];
    }

    private static function bodyIn(array $spec, string $body): string
    {
        return self::markdown($spec) ? Markdown::toBlocks($body) : $body;
    }

    /** uid of each referenced row, per reference column; rows without one get one now. */
    private static function targetUids(array $spec, array $rows): array
    {
        $out = [];
        foreach ($spec['columns'] as $name => $col) {
            $ref = $col['references'] ?? null;
            if ($ref === null) {
                continue;
            }
            $values = array_values(array_unique(array_filter(array_column($rows, $name), static fn ($v) => $v !== null), SORT_REGULAR));
            if ($values === []) {
                continue;
            }
            $targets = db()->findMany($ref['collection'], ['where' => [$ref['column'] => ['in' => $values]]]);
            foreach (Module::ensureUids($ref['collection'], $targets) as $target) {
                $out[$name][self::key($target[$ref['column']])] = $target['uid'];
            }
        }

        return $out;
    }

    private static function resolve(array $ref, string $name, mixed $uid): int|string
    {
        $pointer = '/fields' . HttpError::seg($name);
        if (!Uid::valid($uid)) {
            throw HttpError::invalidInput("$name must be the uid of a {$ref['collection']} row", $pointer);
        }
        $target = db()->findFirst($ref['collection'], ['where' => ['uid' => $uid]])
            ?? throw new HttpError(422, 'sync_missing_reference', "No {$ref['collection']} row has uid $uid; sync {$ref['collection']} first", $pointer);

        return $target[$ref['column']];
    }

    private static function key(mixed $v): string
    {
        return is_string($v) ? 's' . $v : 'n' . $v;
    }
}
