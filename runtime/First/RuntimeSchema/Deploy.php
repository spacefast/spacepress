<?php

declare(strict_types=1);

namespace First\RuntimeSchema;

/**
 * What a build about to run on a site does to the site's runtime changes (spec §2.10): a pure
 * comparison of the build's `schema.php` with the state of the site's newest version, so the deploy
 * check ({@see \First\Wp\SchemaVersions::deployCheck()}) and the suites read the same answer.
 *
 * Nothing is ever dropped. A runtime change the build doesn't contain is `kept`. A field both declare
 * with the same stored shape and other rules (a length, a default, presentation) is `changed`: the
 * build's declaration is used and its values read the same. Everything that reads stored values
 * another way is a refusal: another type, another set of options, a list against a single value,
 * other sub-fields or layouts, and a `table()` of the same name as a runtime collection.
 */
final class Deploy
{
    /**
     * @return array{kept: list<string>, changed: list<string>, refusals: list<array{code: string, name: string, message: string, fix: string}>}
     */
    public static function check(array $compiled, array $state): array
    {
        $kept = $changed = $refusals = [];
        $compare = static function (string $name, array $site, array $built) use (&$changed, &$refusals): void {
            $why = self::stored($site, $built);
            if ($why !== null) {
                $refusals[] = ['code' => 'runtime_type_differs', 'name' => $name,
                    'message' => "$name is stored on this site as " . self::describe($site) . " (a runtime schema change) and declared in this build as " . self::describe($built) . ": $why.",
                    'fix' => "Declare $name as the site stores it (run `first pull` to take the site's definition), or give the build's field another name."];
            } elseif (self::rules($site) !== self::rules($built)) {
                $changed[] = $name;
            }
        };
        foreach (['collections' => 'columns', 'globals' => 'fields'] as $section => $inner) {
            foreach ($state[$section] ?? [] as $kind => $entry) {
                foreach ($entry[$inner] ?? [] as $field => $definition) {
                    $built = $compiled[$section][$kind][$inner][$field] ?? null;
                    $built === null ? $kept[] = "$kind.$field" : $compare("$kind.$field", $definition, $built);
                }
            }
            foreach ($state['added'][$section] ?? [] as $kind => $stored) {
                $built = $compiled[$section][$kind] ?? null;
                if ($built === null) {
                    $kept[] = $kind;
                    continue;
                }
                if ($section === 'collections' && !isset($built['wp']['postType'])) {
                    $refusals[] = ['code' => 'runtime_kind_differs', 'name' => $kind,
                        'message' => "$kind is a collection on this site (a runtime schema change), and this build declares a table() of that name: its items are posts, which a table can't read.",
                        'fix' => "Declare $kind as a collection() in the project (run `first pull`), or give the table another name."];
                    continue;
                }
                foreach ($stored['fields'] as $field => $definition) {
                    if (isset($built[$inner][$field])) {
                        $compare("$kind.$field", $definition, $built[$inner][$field]);
                    }
                }
            }
            // A removed name keeps its values; a build that declares it again must read them as they were stored.
            foreach ($state['removed'][$section] ?? [] as $kind => $removed) {
                foreach ($removed['fields'] ?? [] as $field => $type) {
                    $built = $compiled[$section][$kind][$inner][$field] ?? null;
                    if ($built !== null && $built['type'] !== $type) {
                        $compare("$kind.$field", ['type' => $type], $built);
                    }
                }
            }
        }

        return ['kept' => $kept, 'changed' => $changed, 'refusals' => $refusals];
    }

    /** Why two definitions read stored values differently, or null when they read them the same. */
    private static function stored(array $site, array $built): ?string
    {
        if ($site['type'] !== $built['type']) {
            return 'another type';
        }
        if (($site['enum'] ?? null) !== ($built['enum'] ?? null)) {
            return 'other options';
        }
        if (($site['accept'] ?? 'any') !== ($built['accept'] ?? 'any')) {
            return 'another kind of media';
        }
        foreach (['fields' => 'sub-fields', 'layouts' => 'layouts'] as $key => $what) {
            $a = $site[$key] ?? [];
            $b = $built[$key] ?? [];
            if ($key === 'layouts') {
                if (array_keys($a) !== array_keys($b)) {
                    return "other $what";
                }
                foreach ($a as $layout => $fields) {
                    $why = self::stored(['type' => 'group', 'fields' => $fields], ['type' => 'group', 'fields' => $b[$layout]]);
                    if ($why !== null) {
                        return "layout $layout has $why";
                    }
                }
                continue;
            }
            if (array_keys($a) !== array_keys($b)) {
                return "other $what";
            }
            foreach ($a as $sub => $definition) {
                $why = self::stored($definition, $b[$sub]);
                if ($why !== null) {
                    return "sub-field $sub has $why";
                }
            }
        }

        return null;
    }

    /** What, beside the stored shape, a definition says: rules, a default, whether it is required, presentation. */
    private static function rules(array $definition): array
    {
        $out = array_intersect_key($definition, ['notNull' => 1, 'default' => 1, 'rules' => 1, 'ui' => 1, 'multiline' => 1]);
        foreach (['fields', 'layouts'] as $key) {
            foreach ($definition[$key] ?? [] as $name => $sub) {
                $out[$key][$name] = $key === 'layouts' ? array_map(self::rules(...), $sub) : self::rules($sub);
            }
        }
        ksort($out);

        return $out;
    }

    private static function describe(array $definition): string
    {
        $type = $definition['type'];
        if (isset($definition['enum'])) {
            return "$type (" . implode(', ', $definition['enum']) . ')';
        }
        if (isset($definition['fields'])) {
            return "$type of " . implode(', ', array_keys($definition['fields']));
        }

        return $type;
    }
}
