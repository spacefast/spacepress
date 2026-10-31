<?php

declare(strict_types=1);

namespace Zero\Locale;

use Zero\HttpError;
use Zero\Viewer;

use function Zero\db;

/**
 * Localized reads (§7.3). `locale` becomes a Locale\Filter under `where` (compiled by Sql); `*` reads
 * every row. API list reads default to locales.default. A read pinned to one primary key names that
 * row: without `locale` it is returned as is; with `locale` its group's row in that locale is. Trusted
 * reads (hooks, CLI, the write pipeline) see rows as stored, every locale, unless they pass `locale`.
 * `with`: a `one` relation resolves the stored id; a `many` relation follows an explicit locale of a
 * non-localized parent and is attached as stored under a localized parent.
 */
final class Read
{
    public static function query(string $collection, array &$opts, ?Viewer $viewer, string $ptr): void
    {
        $schema = db()->schema();
        if ($schema->locales() === null || !$schema->hasCollection($collection)) {
            return; // nothing is localized here: a `locale` option stays unknown and Db rejects it
        }
        $has = array_key_exists('locale', $opts);
        $locale = $opts['locale'] ?? null;
        unset($opts['locale']);
        $localized = Module::localized($collection);
        if ($has && !$localized) {
            throw HttpError::invalidQuery("$collection is not localized", $ptr . '/locale');
        }
        $locales = $schema->locales();
        if ($has && $locale !== '*' && !(is_string($locale) && in_array($locale, $locales['all'], true))) {
            throw HttpError::invalidQuery('locale must be one of ' . implode(', ', $locales['all']) . ' or *', $ptr . '/locale');
        }
        $spec = $schema->collection($collection);
        if (is_array($opts['with'] ?? null)) {
            foreach ($opts['with'] as $name => &$nested) {
                $rel = $spec['relations'][$name] ?? null;
                if ($rel === null || !Module::localized($rel['collection']) || ($nested !== true && !is_array($nested))
                    || (is_array($nested) && array_key_exists('locale', $nested))) {
                    continue;
                }
                // `one` stores a specific row's id. `many` children follow an explicit query locale
                // from a non-localized parent; under a localized parent (whose rows may be fallbacks in
                // another locale) they are attached as stored, since `with` loads one page for all parents.
                $follow = $rel['kind'] === 'many' && $has && !$localized;
                $nested = ($nested === true ? [] : $nested) + ['locale' => $follow ? $locale : '*'];
            }
            unset($nested);
        }
        if (!$localized) {
            return;
        }
        $pinned = self::pinned($opts['where'] ?? null, $spec['primaryKey']);
        if (!$has) {
            if ($viewer === null || $pinned !== null) {
                return;
            }
            $locale = $locales['default'];
        }
        if ($locale === '*') {
            return;
        }
        $filter = new Filter($locale, ($locales['fallback'] ?? true) ? $locales['default'] : null, $pinned);
        $opts['where'] = $pinned !== null || !isset($opts['where']) ? ['locale' => $filter] : ['AND' => [$opts['where'], ['locale' => $filter]]];
    }

    /** `translations` (locale => id, a JSON object) in locales.all order; API viewers never see the hidden `translationGroup`. */
    public static function read(array $rows, string $collection, ?Viewer $viewer): array
    {
        if ($rows === [] || !Module::localized($collection)) {
            return $rows;
        }
        $order = array_flip(db()->schema()->locales()['all']);
        $pk = db()->schema()->collection($collection)['primaryKey'];
        foreach ($rows as &$row) {
            if (!array_key_exists('locale', $row)) {
                continue;
            }
            $members = Module::members($row, $pk);
            uksort($members, static fn ($a, $b) => ($order[$a] ?? PHP_INT_MAX) <=> ($order[$b] ?? PHP_INT_MAX));
            $row['translations'] = $members;
            if ($viewer !== null) {
                unset($row['translationGroup']);
            }
        }
        unset($row);

        return $rows;
    }

    private static function pinned(mixed $where, string $pk): int|string|null
    {
        if (!is_array($where) || array_keys($where) !== [$pk]) {
            return null;
        }
        $v = $where[$pk];

        return is_int($v) || is_string($v) ? $v : null;
    }
}
