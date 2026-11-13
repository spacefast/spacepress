<?php

declare(strict_types=1);

namespace First\RuntimeSchema;

/**
 * A runtime change set (spec §2.10) resolved against the schema a site runs: what it would add,
 * and the site's schema state after it. Nothing is stored here; {@see \First\Wp\SchemaVersions}
 * stores the result as a numbered version.
 *
 * A change set is `{ "format": 1, "changes": [ { "op": "addField", "kind", "field", "definition" } ] }`.
 * Field rules are the compiler's ({@see Validator}). The rules below are the running site's own:
 * a build can't hit them, so they have their own problem codes and no compiler diagnostic.
 */
final class Changes
{
    /** The resolved state is one autoloaded option; past this it is time to `first pull` and build. */
    public const MAX_STATE_BYTES = 65536;
    public const MAX_CHANGES = 50;
    /** WordPress keeps meta keys in 255 characters and cuts longer ones off without an error. */
    public const MAX_NAME = 64;

    /**
     * @param array<string, array> $kinds the collections of the schema this request runs (build + active version)
     * @param array $state the site's active version ({@see Loader::state()})
     * @return array{changes: list<array>, state: array} the changes in stored form and the state after them
     * @throws Refused
     */
    public static function resolve(array $kinds, array $state, mixed $changeSet): array
    {
        if (!is_array($changeSet) || ($changeSet['format'] ?? null) !== Loader::FORMAT) {
            throw new Refused('schema_format', 'A change set is { "format": ' . Loader::FORMAT . ', "changes": [...] }; this runtime reads format ' . Loader::FORMAT, null, '/format');
        }
        if (array_diff(array_keys($changeSet), ['format', 'changes']) !== []) {
            throw new Refused('schema_format', 'A change set has `format` and `changes` only', null, \First\HttpError::seg((string) array_values(array_diff(array_keys($changeSet), ['format', 'changes']))[0]));
        }
        $changes = $changeSet['changes'] ?? null;
        if (!is_array($changes) || !array_is_list($changes) || $changes === []) {
            throw new Refused('schema_format', '`changes` must be a list with at least one change', null, '/changes');
        }
        if (count($changes) > self::MAX_CHANGES) {
            throw new Refused('schema_format', 'One version holds at most ' . self::MAX_CHANGES . ' changes', null, '/changes');
        }
        $resolved = [];
        foreach ($changes as $i => $change) {
            $pointer = "/changes/$i";
            if (!is_array($change) || !is_string($change['op'] ?? null)) {
                throw new Refused('schema_format', 'A change is an object with an `op`', null, $pointer);
            }
            $resolved[] = match ($change['op']) {
                'addField' => self::addField($kinds, $state, $change, $pointer),
                default => throw self::buildOnly($change['op'], $pointer),
            };
        }
        if (strlen(serialize($state)) > self::MAX_STATE_BYTES) {
            throw new Refused('schema_too_large', 'The site\'s runtime schema would pass ' . self::MAX_STATE_BYTES . ' bytes. Move what it holds into the project: run `first pull`, build and deploy, then apply this change', null, '/changes');
        }

        return ['changes' => $resolved, 'state' => $state];
    }

    private static function addField(array &$kinds, array &$state, array $change, string $pointer): array
    {
        if (array_diff(array_keys($change), ['op', 'kind', 'field', 'definition']) !== [] || !is_string($change['kind'] ?? null) || !is_string($change['field'] ?? null)) {
            throw new Refused('schema_format', 'addField is { "op": "addField", "kind", "field", "definition" }', null, $pointer);
        }
        [$kind, $field] = [$change['kind'], $change['field']];
        try {
            $stored = Validator::field($kind, $kinds[$kind] ?? null, $field, $change['definition'] ?? null);
        } catch (Refused $refused) {
            throw new Refused($refused->errorCode, $refused->getMessage(), $refused->diagnostic, "$pointer/definition");
        }
        if (isset($kinds[$kind]['columns'][$field]) || isset($state['collections'][$kind]['columns'][$field])) {
            // The compiler's refusal for a lock field the source declares differently.
            throw new Refused('schema_invalid', "$kind.$field: `$field` is already a field of `$kind`", 'F3001', "$pointer/field");
        }
        // Not verified for these kinds yet, so refused rather than guessed: a translated kind's fields
        // are copied or translated per the build's wpml-config.xml, and a synced kind's fields come
        // from content files in the project.
        foreach (['localized' => 'translated', 'sync' => 'synced from content files'] as $key => $why) {
            if ($kinds[$kind][$key] ?? false) {
                throw new Refused('schema_build_only', "$kind.$field: `$kind` is $why, and fields of such a kind can't be added at runtime yet: add `$field` to `$kind` in the project's schema file, then build and deploy", null, "$pointer/kind");
            }
        }
        if (isset($kinds[$kind]['relations'][$field])) {
            throw new Refused('schema_invalid', "$kind.$field: `$field` is already a relation of `$kind`", 'F3001', "$pointer/field");
        }
        if (strlen($field) > self::MAX_NAME) {
            throw new Refused('schema_name', "$kind.$field: a field added at runtime has a name of at most " . self::MAX_NAME . ' characters; it is stored as the post meta key `' . $kinds[$kind]['wp']['metaPrefix'] . '<name>`', null, "$pointer/field");
        }
        if (in_array($field, self::RESERVED, true)) {
            throw new Refused('schema_reserved', "$kind.$field: `$field` is a field every kind has or will have (docs/spec/spec.md §2.4); choose another name", null, "$pointer/field");
        }
        if (($stored['notNull'] ?? false) && !isset($stored['default'])) {
            throw new Refused('schema_required', "$kind.$field: a field added at runtime is optional or has a default, because existing items have no value for it. Leave out `notNull`, or add `default`", null, "$pointer/definition/notNull");
        }
        $change = ['op' => 'addField', 'kind' => $kind, 'field' => $field, 'definition' => $stored];
        $kinds[$kind]['columns'][$field] = $stored;
        $state = self::fold($state, [$change]);

        return $change;
    }

    /**
     * The state after stored changes, which are already in resolved form: what {@see resolve()}
     * returned when each version was applied. Replaying every version from an empty state gives
     * the site's active state again, so the option {@see Loader} reads is a copy, never the record.
     *
     * @param list<array> $changes
     */
    public static function fold(array $state, array $changes): array
    {
        foreach ($changes as $change) {
            if ($change['op'] === 'addField') {
                $state['collections'][$change['kind']]['columns'][$change['field']] = $change['definition'];
            }
        }

        return $state;
    }

    /** Names spec §2.4 gives every kind; a runtime field may not take one before the build does. */
    private const RESERVED = ['id', 'author', 'createdAt', 'updatedAt', 'status', 'publishedAt', 'url', 'terms', 'uid', 'locale', 'translations'];

    /** An operation only a build can make, with the source edit that makes it. */
    private static function buildOnly(string $op, string $pointer): Refused
    {
        $edit = match ($op) {
            'removeField', 'renameField', 'changeField' => 'edit the field in the project\'s schema file',
            'addTable', 'changeTable' => 'declare the table() in the project\'s schema file; its SQL changes are checked against live rows at deploy',
            'addAction', 'addJob', 'addHook', 'addPage', 'addRoute' => 'write it in the project under first/',
            default => 'make the change in the project',
        };

        return new Refused('schema_build_only', "`$op` can't be done at runtime: $edit, then build and deploy", null, "$pointer/op");
    }
}
