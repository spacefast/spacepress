<?php

declare(strict_types=1);

namespace First\RuntimeSchema;

/**
 * The schema a request uses when the app sets `runtimeSchema: true` (spec §2.10): the compiled
 * `schema.php` plus the fields of the site's active schema version.
 *
 * The active version is one autoloaded option, written by {@see Store} when a change is applied.
 * WordPress reads autoloaded options in the query it already runs, so a request adds no query: it
 * adds the stored fields to the compiled array and does nothing else. Nothing is validated here;
 * the fields were checked when they were applied. A name the build declares itself is never
 * replaced, so a build made after `first pull` simply stops needing the stored copy.
 */
final class Loader
{
    /** The compiled `schema.php` this request loaded, before anything was added to it. */
    private static ?array $compiled = null;

    /** The compiled schema of this request; null when nothing with `runtimeSchema` was loaded. */
    public static function compiled(): ?array
    {
        return self::$compiled;
    }

    /** The stored format this runtime reads and writes (`FORMAT` in src/runtime_schema.rs). */
    public const FORMAT = 1;

    public static function option(string $app): string
    {
        return 'first_' . $app . '_runtime_schema';
    }

    /** The stored type of every field a build that initialized on this site declared. */
    public static function declaredOption(string $app): string
    {
        return 'first_' . $app . '_declared_fields';
    }

    /**
     * Records the fields the build this request runs declares, beside those of every build before
     * it, so a runtime change is checked against all of them, not only against the build it is made
     * on. Called where a build initializes on the site (its migrations), not per request.
     */
    public static function rememberDeclared(array $compiled): void
    {
        $app = (string) ($compiled['name'] ?? 'app');
        $known = get_option(self::declaredOption($app));
        $known = is_array($known) ? $known : [];
        $before = $known;
        foreach ($compiled['collections'] ?? [] as $kind => $spec) {
            if (isset($spec['wp']['postType'])) {
                foreach ($spec['columns'] as $field => $column) {
                    $known['collections'][$kind][$field] ??= $column['type'];
                }
            }
        }
        foreach ($compiled['globals'] ?? [] as $kind => $spec) {
            foreach ($spec['fields'] as $field => $column) {
                $known['globals'][$kind][$field] ??= $column['type'];
            }
        }
        if ($known !== $before) {
            update_option(self::declaredOption($app), $known, false);
        }
    }

    /** `{collections: {kind: {field: type}}, globals: …}` of every build that initialized here. */
    public static function declared(string $app): array
    {
        $known = get_option(self::declaredOption($app));

        return is_array($known) ? $known : [];
    }

    /**
     * The fields of `$data` that are a runtime change's, not the build's: what the write path keeps
     * aside while compiled hooks run, so a hook that returns a new object can't drop them.
     *
     * @return array{array, array} [the build's fields, the runtime fields]
     */
    public static function split(array $spec, array $data, array $compiled): array
    {
        $own = null;
        foreach ($compiled['collections'] ?? [] as $candidate) {
            if (isset($spec['wp']['postType']) && ($candidate['wp']['postType'] ?? null) === $spec['wp']['postType']) {
                $own = $candidate;
            }
        }
        if ($own === null) {
            return [$data, []];
        }
        $runtime = array_diff_key($data, $own['columns']);

        return [array_diff_key($data, $runtime), $runtime];
    }

    /** The site's active version: `{format, version, hash, collections}`; version 0 before any change. */
    public static function state(string $app): array
    {
        $state = get_option(self::option($app));

        return is_array($state) ? $state : ['format' => self::FORMAT, 'version' => 0, 'hash' => '', 'collections' => []];
    }

    /**
     * `schema.php` with the active version's fields added. `runtimeSchema.active` says what was added
     * and from which version, or why nothing was (`problem`).
     */
    public static function merge(array $raw): array
    {
        self::$compiled = $raw;
        if (!function_exists('get_option')) {
            // A host that reads the build before WordPress has loaded its options gets the compiled
            // schema; the app mounts later (plugins_loaded) and loads it again with the options there.
            $raw['runtimeSchema']['active'] = ['version' => 0, 'hash' => '', 'added' => [], 'problem' => 'WordPress has not loaded its options yet'];

            return $raw;
        }
        $state = self::state((string) ($raw['name'] ?? 'app'));
        $active = ['version' => (int) ($state['version'] ?? 0), 'hash' => (string) ($state['hash'] ?? ''), 'added' => []];
        if (($state['format'] ?? null) !== self::FORMAT) {
            // Written by a newer runtime: this one serves the compiled schema and says so.
            $active['problem'] = 'the site\'s runtime schema is in format ' . json_encode($state['format'] ?? null) . '; this runtime reads format ' . self::FORMAT;
            $raw['runtimeSchema']['active'] = $active;

            return $raw;
        }
        foreach ($state['collections'] ?? [] as $kind => $entry) {
            if (!isset($raw['collections'][$kind]['wp']['postType'])) {
                continue;
            }
            // A row carries its relations under their names, so a relation the build declares wins too.
            $fields = array_diff_key($entry['columns'] ?? [], $raw['collections'][$kind]['columns'], $raw['collections'][$kind]['relations'] ?? []);
            if ($fields !== []) {
                $raw['collections'][$kind]['columns'] += $fields;
                $active['added'][$kind] = array_keys($fields);
            }
        }
        $raw['runtimeSchema']['active'] = $active;

        return $raw;
    }
}
