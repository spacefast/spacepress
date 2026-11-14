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

    /**
     * `schema.php` as the build wrote it, before anything was added: what a change is checked
     * against, with the newest state. Null when nothing with `runtimeSchema` was loaded.
     */
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

    /** Where `schema.php` was loaded from: `references.php` is beside it. */
    private static ?string $dir = null;
    /** @var array|false|null the build's references index; false when the build has none */
    private static array|false|null $references = null;

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

    public const EMPTY = ['format' => self::FORMAT, 'version' => 0, 'hash' => ''];

    /**
     * The seal a state is written with: a hash of everything else in it, the newest version's chain
     * hash included. Only apply writes a state, and it seals what it writes, so a state whose seal
     * doesn't match was written some other way and is not served.
     */
    public static function seal(array $state): string
    {
        unset($state['seal']);
        ksort($state);

        return hash('sha256', serialize($state));
    }

    /** A state with its seal. */
    public static function sealed(array $state): array
    {
        unset($state['seal']);

        return $state + ['seal' => self::seal($state)];
    }

    /** The site's active version ({@see Changes::fold()} for its keys); version 0 before any change. */
    public static function state(string $app): array
    {
        $state = get_option(self::option($app));

        return is_array($state) ? $state : self::EMPTY;
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
        if (($state['version'] ?? 0) !== 0 && ($state['seal'] ?? null) !== self::seal($state)) {
            // Not written by apply: serve the build alone until apply (or `wp first schema list`)
            // rebuilds the option from the stored versions.
            $raw['runtimeSchema']['active'] = ['version' => (int) ($state['version'] ?? 0), 'hash' => (string) ($state['hash'] ?? ''),
                'problem' => 'the runtime schema option does not match its own hash; apply a change, or run `wp first schema list`, to rebuild it from the stored versions'];

            return $raw;
        }
        $problem = is_string($state['problem'] ?? null) ? $state['problem'] : null;

        // The index is read only when the site removed something: nothing else needs it per request.
        $raw = self::apply($raw, $state, isset($state['removed']) ? self::references() : null);
        if ($problem !== null) {
            $raw['runtimeSchema']['active']['problem'] = $problem;
        }

        return $raw;
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
        // The option is data whoever can write options may change, so it is read as the operations a
        // runtime change can make, and nothing else: an added kind is rebuilt from its stored
        // definition (the access rules, post type and hooks are the ones expandCollection gives every
        // runtime kind), and a field is served only in a stored form the validator accepts. Anything
        // else in the option is ignored; the version table is the record, and apply rewrites the option.
        foreach (['collections' => 'columns', 'globals' => 'fields'] as $section => $inner) {
            foreach ($state['added'][$section] ?? [] as $name => $stored) {
                $name = (string) $name;
                // The build declares the kind (after `first pull`): its declaration wins, and the
                // fields the site stored that it leaves out are added to it, as fields added to a
                // kind of the build are.
                if (($section === 'globals' || isset($raw[$section][$name]['wp']['postType'])) && isset($raw[$section][$name])) {
                    $fields = is_array($stored['fields'] ?? null) ? $stored['fields'] : [];
                    $fields = $section === 'collections' ? array_diff_key($fields, ['title' => 1, 'content' => 1]) : $fields;
                    $raw[$section][$name][$inner] += self::fields($name, $fields, $section === 'globals' ? Validator::GLOBAL : Validator::COLLECTION);
                    continue;
                }
                // A name is one thing across the app, so anything else the build declares under it wins.
                if (isset($raw['collections'][$name]) || isset($raw['globals'][$name]) || isset($raw['actions'][$name]) || isset($raw['jobs'][$name])) {
                    continue;
                }
                $kind = self::kind($section, $name, $stored);
                if ($kind !== null) {
                    $raw[$section][$name] = $kind;
                }
            }
        }
        foreach ($state['collections'] ?? [] as $kind => $entry) {
            if (isset($raw['collections'][$kind]['wp']['postType'])) {
                // A row carries its relations under their names, so a relation the build declares wins too.
                $raw['collections'][$kind]['columns'] += array_diff_key(self::fields((string) $kind, $entry['columns'] ?? [], Validator::COLLECTION), $raw['collections'][$kind]['relations'] ?? []);
            }
        }
        foreach ($state['globals'] ?? [] as $kind => $entry) {
            if (isset($raw['globals'][$kind])) {
                $raw['globals'][$kind]['fields'] += self::fields((string) $kind, $entry['fields'] ?? [], Validator::GLOBAL);
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
                if (is_string($override['label'] ?? null) && $override['label'] !== '' && strlen($override['label']) <= 120) {
                    $raw[$section][$kind]['label'] = $override['label'];
                }
                foreach (is_array($override['ui'] ?? null) ? $override['ui'] : [] as $field => $ui) {
                    if (isset($raw[$section][$kind][$inner][$field])) {
                        try {
                            $raw[$section][$kind][$inner][$field]['ui'] = Validator::presentation($ui, "$kind.$field");
                        } catch (Refused) {
                            // Not a presentation a change could set: ignored.
                        }
                    }
                }
            }
        }
        $raw['runtimeSchema']['active'] = $active;

        return $raw;
    }

    /** An added kind's `schema.php` array, built from its stored definition; null when that isn't one. */
    private static function kind(string $section, string $name, mixed $stored): ?array
    {
        try {
            return $section === 'globals'
                ? Kinds::expandGlobal($name, Kinds::global($name, $stored))
                : Kinds::expandCollection($name, Kinds::collection($name, $stored));
        } catch (Refused|\TypeError) {
            return null;
        }
    }

    /** The stored fields the validator accepts, in its stored form; the rest are left out. */
    private static function fields(string $kind, mixed $fields, string $place): array
    {
        $out = [];
        foreach (is_array($fields) ? $fields : [] as $field => $definition) {
            try {
                $out[(string) $field] = Validator::definition("$kind.$field", (string) $field, $definition, $place);
            } catch (Refused|\TypeError) {
                // Not a field a change could add: left out.
            }
        }

        return $out;
    }

}
