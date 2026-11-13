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

    /** The compiled `schema.php` of this request, before anything was added to it. */
    private static ?array $compiled = null;
    /** Where it was loaded from: `references.php` is beside it. */
    private static ?string $dir = null;
    /** @var array|false|null the build's references index; false when the build has none */
    private static array|false|null $references = null;

    public const EMPTY = ['format' => self::FORMAT, 'version' => 0, 'hash' => ''];

    /** The site's active version ({@see Changes::fold()} for its keys); version 0 before any change. */
    public static function state(string $app): array
    {
        $state = get_option(self::option($app));

        return is_array($state) ? $state : self::EMPTY;
    }

    /** `schema.php` as the build wrote it: what a change is checked against, with the newest state. */
    public static function compiled(): array
    {
        return self::$compiled ?? throw new \LogicException('No schema with runtimeSchema is loaded');
    }

    /**
     * Which fields the build's compiled code can name (`first/app/references.php`, written by `first
     * build`); null for a build without one, which then has nothing that may be hidden.
     */
    public static function references(): ?array
    {
        if (self::$references === null) {
            $file = self::$dir === null ? null : self::$dir . '/references.php';
            $loaded = $file !== null && is_file($file) ? require $file : false;
            self::$references = is_array($loaded) && ($loaded['format'] ?? null) === self::FORMAT ? $loaded : false;
        }

        return self::$references === false ? null : self::$references;
    }

    /**
     * Whether the running site may hide a field the build declares: only an optional one that no
     * compiled code names. Such a field reads "no value" either way, so hiding it changes nothing a
     * hook, action, job or page can observe.
     */
    public static function hidableField(array $compiled, ?array $references, string $section, string $kind, string $field): bool
    {
        $definition = $compiled[$section][$kind][$section === 'globals' ? 'fields' : 'columns'][$field] ?? null;

        return $definition !== null && $references !== null && !($definition['notNull'] ?? false)
            && !($definition['system'] ?? false) && !in_array($field, $references[$section][$kind] ?? [$field], true);
    }

    /** The same for a whole kind the build declares: one no compiled code names. */
    public static function hidableKind(array $compiled, ?array $references, string $section, string $kind): bool
    {
        return isset($compiled[$section][$kind]) && $references !== null && !in_array($kind, $references['kinds'] ?? [$kind], true);
    }

    /** `schema.php` with the site's active version on top; `runtimeSchema.active` says which version. */
    public static function merge(array $raw, ?string $dir = null): array
    {
        self::$compiled = $raw;
        self::$dir = $dir;
        self::$references = null;
        if (!function_exists('get_option')) {
            // A host that reads the build before WordPress has loaded its options gets the compiled
            // schema; the app mounts later (plugins_loaded) and loads it again with the options there.
            $raw['runtimeSchema']['active'] = ['version' => 0, 'hash' => '', 'problem' => 'WordPress has not loaded its options yet'];

            return $raw;
        }

        $state = self::state((string) ($raw['name'] ?? 'app'));

        // The index is read only when the site removed something: nothing else needs it per request.
        return self::apply($raw, $state, isset($state['removed']) ? self::references() : null);
    }

    /**
     * A compiled schema with a state on top. The build's own declarations are never replaced: a kind,
     * a field or a relation it declares wins over a stored one of the same name. Only a label and a
     * field's `ui`, which are presentation and nothing else, replace what the build says, and a
     * name the site removed is hidden from the build only where that is safe ({@see hidableField()}).
     */
    public static function apply(array $raw, array $state, ?array $references = null): array
    {
        $compiled = $raw;
        $active = ['version' => (int) ($state['version'] ?? 0), 'hash' => (string) ($state['hash'] ?? '')];
        if (($state['format'] ?? null) !== self::FORMAT) {
            // Written by a newer runtime: this one serves the compiled schema and says so.
            $active['problem'] = 'the site\'s runtime schema is in format ' . json_encode($state['format'] ?? null) . '; this runtime reads format ' . self::FORMAT;
            $raw['runtimeSchema']['active'] = $active;

            return $raw;
        }
        foreach (['collections', 'globals'] as $section) {
            foreach ($state['compiled'][$section] ?? [] as $name => $kind) {
                // A name is one thing across the app, so anything the build declares under it wins.
                if (!isset($raw['collections'][$name]) && !isset($raw['globals'][$name]) && !isset($raw['actions'][$name]) && !isset($raw['jobs'][$name])) {
                    $raw[$section][$name] = $kind;
                }
            }
        }
        foreach ($state['collections'] ?? [] as $kind => $entry) {
            if (isset($raw['collections'][$kind]['wp']['postType'])) {
                // A row carries its relations under their names, so a relation the build declares wins too.
                $raw['collections'][$kind]['columns'] += array_diff_key($entry['columns'] ?? [], $raw['collections'][$kind]['relations'] ?? []);
            }
        }
        foreach ($state['globals'] ?? [] as $kind => $entry) {
            if (isset($raw['globals'][$kind])) {
                $raw['globals'][$kind]['fields'] += $entry['fields'] ?? [];
            }
        }
        foreach (['collections' => 'columns', 'globals' => 'fields'] as $section => $inner) {
            foreach ($state['removed'][$section] ?? [] as $kind => $removed) {
                if (!isset($compiled[$section][$kind])) {
                    continue;
                }
                if ($removed['kind'] ?? false) {
                    if (self::hidableKind($compiled, $references, $section, $kind)) {
                        unset($raw[$section][$kind]);
                    }
                    continue;
                }
                foreach ($removed['fields'] ?? [] as $field => $_) {
                    if (self::hidableField($compiled, $references, $section, $kind, (string) $field)) {
                        unset($raw[$section][$kind][$inner][$field]);
                    }
                }
            }
            foreach ($state['overrides'][$section] ?? [] as $kind => $override) {
                if (!isset($raw[$section][$kind])) {
                    continue;
                }
                if (isset($override['label'])) {
                    $raw[$section][$kind]['label'] = $override['label'];
                }
                foreach ($override['ui'] ?? [] as $field => $ui) {
                    if (isset($raw[$section][$kind][$inner][$field])) {
                        $raw[$section][$kind][$inner][$field]['ui'] = $ui;
                    }
                }
            }
        }
        $raw['runtimeSchema']['active'] = $active;

        return $raw;
    }
}
