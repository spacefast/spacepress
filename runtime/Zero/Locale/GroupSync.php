<?php

declare(strict_types=1);

namespace Zero\Locale;

use Zero\HttpError;
use Zero\Js;
use Zero\Schema;
use Zero\Viewer;

use function Zero\db;

/**
 * Translation groups on write (§7.3). Create: `locale` defaults to locales.default; `translationOf`
 * joins that row's group (at most one row per locale) and pre-fills every synced column, refusing a
 * payload value that differs. Update: `locale` is immutable; a write that changes synced columns
 * applies them to every other row of the group through the update pipeline (hooks and revisions per
 * row, trusted: the group shares those values by definition). A row that joins a group outside the
 * API (Polylang's "+" in wp-admin) adopts the values of the group's oldest row. Delete removes only
 * that row, so the group shrinks.
 */
final class GroupSync
{
    /** @var array<string, true> translation groups whose synced values are being propagated right now */
    private static array $active = [];

    public static function normalize(string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided): void
    {
        if (!Module::localized($collection)) {
            return; // `translationOf` stays an unknown field there
        }
        foreach (['translations', 'translationGroup'] as $system) {
            if (array_key_exists($system, $data)) {
                throw HttpError::invalidInput("$system is managed by Zero", HttpError::seg($system));
            }
        }
        if ($op === 'update' && array_key_exists('translationOf', $data)) {
            throw HttpError::invalidInput('translationOf only applies on create', '/translationOf');
        }
        if ($op === 'update' && array_key_exists('locale', $data) && $data['locale'] !== $existing['locale']) {
            throw HttpError::invalidInput('locale cannot be changed; create a translation instead', '/locale');
        }
        unset($data['translationOf']);
    }

    /**
     * Prepares a create's group membership without persisting it (operations may replay before
     * persistence): one row per locale is enforced where the row is stored, by the
     * (translationGroup, locale) index on tables and under a group lock in Wp\Polylang::assign.
     */
    public static function write(string $op, string $collection, array &$data, ?array $existing, ?Viewer $viewer, array $provided): void
    {
        if ($op !== 'create' || !Module::localized($collection)) {
            return;
        }
        $spec = db()->schema()->collection($collection);
        $pk = $spec['primaryKey'];
        $data['locale'] = Schema::normalize($spec['columns']['locale'], $data['locale'] ?? null, 'locale', '/locale');
        $of = $provided['translationOf'] ?? null;
        if ($of === null) {
            if (!Module::polylang($collection)) {
                $data['translationGroup'] = self::uuid();
            }

            return;
        }
        if (!Js::isInteger($of) && !is_string($of)) {
            throw HttpError::invalidInput('translationOf must be the id of an existing row', '/translationOf');
        }
        $find = static fn (?Viewer $v) => db()->findFirst($collection, ['where' => [$pk => $of], 'locale' => '*'], $v);
        // The caller must be able to read the source; its values are copied from storage, not from
        // the caller's (possibly field-filtered) view of it.
        if (($viewer !== null && $find($viewer) === null) || ($source = $find(null)) === null) {
            throw HttpError::invalidInput("No $collection row with $pk " . Js::str($of), '/translationOf');
        }
        Lock::members($collection, $source, Module::members($source, $pk)); // holds the group: joins serialize
        Lock::unchanged($collection, $source[$pk]); // and the values about to be copied are current
        foreach (Module::synced($spec) as $col) {
            if (array_key_exists($col, $provided)
                && !Module::same(Schema::normalize($spec['columns'][$col], $provided[$col], $col, HttpError::seg($col)), $source[$col])) {
                throw HttpError::invalidInput("$col is synced across translations; change it on any row to change all", HttpError::seg($col));
            }
            $data[$col] = $source[$col];
        }
        if (Module::polylang($collection)) {
            $data['translations'] = Module::members($source, $pk); // the group WpPostStore::insert joins
        } else {
            if ($source['translationGroup'] === null) { // a row from before the collection was localized
                $source['translationGroup'] = self::uuid();
                db()->store()->update($collection, $source[$pk], ['translationGroup' => $source['translationGroup']]);
            }
            $data['translationGroup'] = $source['translationGroup'];
        }
    }

    public static function written(string $op, string $collection, array $row, ?array $previous): void
    {
        if ($op === 'delete' || !Module::localized($collection)) {
            return;
        }
        $spec = db()->schema()->collection($collection);
        $pk = $spec['primaryKey'];
        if (isset(self::$active[self::key($collection, $row, $pk)])) {
            return; // this row is being given its group's values
        }
        $changed = [];
        foreach ($previous === null ? [] : Module::synced($spec) as $col) {
            if (!Module::same($row[$col], $previous[$col])) {
                $changed[$col] = $row[$col];
            }
        }
        if ($changed === []) {
            if ($previous === null) {
                self::adopt($collection, $row); // a row that joined a group outside the API (wp-admin "+")
            }

            return;
        }
        // Every member as currently committed, locked: a translation created concurrently can't be missed.
        $members = Lock::members($collection, $row, Module::members($row, $pk));
        $siblings = array_values(array_filter($members, static fn ($id) => $id !== $row[$pk]));
        self::quietly(self::key($collection, $row, $pk), static function () use ($collection, $pk, $siblings, $changed): void {
            foreach ($siblings === [] ? [] : db()->findMany($collection, ['where' => [$pk => ['in' => $siblings]], 'locale' => '*']) as $sibling) {
                $patch = array_filter($changed, static fn ($v, $col) => !Module::same($sibling[$col], $v), ARRAY_FILTER_USE_BOTH);
                if ($patch !== []) {
                    db()->update($collection, $patch, [$pk => $sibling[$pk]]);
                }
            }
        });
    }

    /** Give $row (decoded, `translations` filled) the synced values of its group's oldest row, unless it is that row. */
    public static function adopt(string $collection, array $row): void
    {
        $spec = db()->schema()->collection($collection);
        $pk = $spec['primaryKey'];
        $ids = array_values(Module::members($row, $pk));
        $oldest = $ids === [] ? null : min($ids);
        if ($oldest === null || $oldest === $row[$pk]
            || ($source = db()->findFirst($collection, ['where' => [$pk => $oldest], 'locale' => '*'])) === null) {
            return;
        }
        $patch = [];
        foreach (Module::synced($spec) as $col) {
            if (!Module::same($row[$col], $source[$col])) {
                $patch[$col] = $source[$col];
            }
        }
        if ($patch !== []) {
            self::quietly(self::key($collection, $row, $pk), static fn () => db()->update($collection, $patch, [$pk => $row[$pk]]));
        }
    }

    /** A translation group's identity while its members don't change: its oldest member. */
    private static function key(string $collection, array $row, string $pk): string
    {
        $ids = array_values(Module::members($row, $pk));

        return $collection . ':' . Js::str($ids === [] ? $row[$pk] : min($ids));
    }

    /** Propagation writes are trusted pipeline updates that must not re-propagate within the same group. */
    private static function quietly(string $group, callable $fn): void
    {
        $was = self::$active[$group] ?? null;
        self::$active[$group] = true;
        try {
            $fn();
        } finally {
            if ($was === null) {
                unset(self::$active[$group]);
            }
        }
    }

    private static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
