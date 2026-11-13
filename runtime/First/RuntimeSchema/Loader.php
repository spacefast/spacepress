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
    /** The stored format this runtime reads and writes (`FORMAT` in src/runtime_schema.rs). */
    public const FORMAT = 1;

    public static function option(string $app): string
    {
        return 'first_' . $app . '_runtime_schema';
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
            $fields = array_diff_key($entry['columns'] ?? [], $raw['collections'][$kind]['columns']);
            if ($fields !== []) {
                $raw['collections'][$kind]['columns'] += $fields;
                $active['added'][$kind] = array_keys($fields);
            }
        }
        $raw['runtimeSchema']['active'] = $active;

        return $raw;
    }
}
