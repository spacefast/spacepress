<?php

declare(strict_types=1);

namespace First\Wp;

use First\HttpError;

/**
 * What compiled app and plugin-package code may not do through WordPress, whatever its source says:
 * the runtime half of the isolation the compiler's refusals start (src/wordpress/mod.rs reads the
 * same guard.json and refuses literal names at build time). Names built at runtime only meet this.
 *
 * - Options (`get_option`, `update_option`, `delete_option`): the ones that load code, move sign-in,
 *   change roles or hold secrets are refused; the secret ones can't be read either.
 * - `wp_insert_post`: only `post`, `page` and other plugins' public post types. WordPress runs no
 *   capability check there, so a published `customize_changeset` would apply theme and option
 *   settings with the check off, and a First kind's post type would skip its access rules.
 * - `existingTable`: a table on this site's prefix that is not WordPress's, First's or Action
 *   Scheduler's, or this Space's own Zero 0.8 table (`sf_<space>_…`), never another tenant's.
 */
final class Guard
{
    /** @var ?array{options: list<array{match: string, name: string, read: bool}>, functions: array<string, string>} */
    private static ?array $rules = null;
    /** @var array<string, true> existingTable names already checked against this request's prefix */
    private static array $tables = [];

    /** Core table names under a site's prefix (wpdb::$tables, $global_tables, $ms_global_tables and the old ones). */
    private const CORE_TABLES = ['posts', 'comments', 'links', 'options', 'postmeta', 'terms', 'term_taxonomy', 'term_relationships',
        'termmeta', 'commentmeta', 'users', 'usermeta', 'blogs', 'blogmeta', 'signups', 'site', 'sitemeta', 'registration_log',
        'sitecategories', 'categories', 'post2cat', 'link2cat'];

    /**
     * Refuses a catalog call the guard covers, before WordPress sees it. `$args` are the PHP values
     * the call will pass.
     *
     * @param list<mixed> $args
     */
    public static function call(string $function, array $args): void
    {
        $kind = self::rules()['functions'][$function] ?? null;
        if ($kind === 'read' || $kind === 'write') {
            self::option($args[0] ?? null, $kind === 'write' ? 'write' : 'read');
        } elseif ($kind === 'post') {
            $post = $args[0] ?? null;
            // Only the fields the catalog declares, whatever the value's type said at build time.
            $rules = self::rules()['postTypes'];
            foreach (is_array($post) ? array_keys($post) : [] as $field) {
                if (!in_array($field, $rules['fields'], true)) {
                    throw new HttpError(403, 'protected_post_field', 'App code can\'t pass `' . self::shown((string) $field) . "` to wp_insert_post: {$rules['fieldsWhy']}");
                }
            }
            self::postType(is_array($post) ? ($post['post_type'] ?? 'post') : 'post');
        }
    }

    /** The rule that protects an option name, or null: what both halves of the guard compare. */
    public static function protects(string $name): ?array
    {
        // WordPress trims the name; MySQL compares option_name case-insensitively, ignoring trailing
        // spaces, and its unicode collations fold some non-ASCII letters onto ASCII ones. So anything
        // beyond printable ASCII (a space inside the name is) is refused whatever it spells, and the
        // rest is compared lowercased.
        $name = trim($name);
        if (preg_match('/[^\x20-\x7e]/', $name) === 1) {
            return ['match' => 'bytes', 'name' => $name, 'read' => false, 'why' => 'an option name outside printable ASCII can match a protected one in MySQL'];
        }
        $name = strtolower($name);
        // The first matching rule gives the reason; any matching secret rule makes it unreadable
        // (jetpack_private_options is both a jetpack_ option and a private one).
        $found = null;
        foreach (self::rules()['options'] as $rule) {
            $hit = match ($rule['match']) {
                'exact' => $name === $rule['name'],
                'prefix' => str_starts_with($name, $rule['name']),
                'suffix' => str_ends_with($name, $rule['name']),
                'contains' => str_contains($name, $rule['name']),
            };
            if ($hit && $found === null) {
                $found = $rule;
            } elseif ($hit && !$rule['read'] && $found['read']) {
                $found = ['read' => false, 'why' => $rule['why']] + $found;
            }
        }

        return $found;
    }

    private static function option(mixed $name, string $access): void
    {
        $name = is_string($name) ? $name : (is_scalar($name) ? (string) $name : '');
        $rule = self::protects($name);
        if ($rule === null || ($access === 'read' && $rule['read'])) {
            return;
        }
        $verb = $access === 'read' ? 'read' : 'change';
        throw new HttpError(403, 'protected_option', "App code can't $verb the WordPress option `" . self::shown($name) . "`: {$rule['why']}. Store app settings in a global or a table, or under an option name of the app's own");
    }

    private static function postType(mixed $type): void
    {
        $type = is_string($type) ? trim($type) : '';
        $object = $type === '' ? null : get_post_type_object($type);
        $allowed = in_array($type, ['post', 'page'], true)
            || ($object !== null && !$object->_builtin && $object->public && !str_starts_with($type, 'first_'));
        if (!$allowed) {
            throw new HttpError(403, 'protected_post_type', 'App code can insert posts of type post, page or another plugin\'s public post type, not `' . self::shown($type) . '`: WordPress checks no capability here, and First\'s kinds are written through db');
        }
    }

    /**
     * Refuses an `existingTable` binding that isn't this site's to bind. `$prefix` is `$wpdb->prefix`,
     * which the host sets before WordPress loads (docs/host-contract.md "Table prefix"). `$names` are
     * the table names a Zero 0.8 table's digest may be over (see `names`).
     *
     * @param list<string> $names
     */
    public static function table(string $name, string $prefix, array $names = []): void
    {
        $key = $prefix . "\0" . $name . "\0" . implode("\0", $names);
        if (isset(self::$tables[$key])) {
            return;
        }
        // Only names the converter could have digested (identifiers, of any length: it cuts only the
        // physical name), so a name can't be varied freely in search of a digest that matches
        // another Space's table. A stored name
        // (`my_tasks`) stands for the key it was made from, so its camelCase form is tried too.
        $spellings = [];
        foreach ($names as $n) {
            if (preg_match('/\A[A-Za-z][A-Za-z0-9_]*\z/', $n) === 1) {
                $spellings[] = $n;
                $spellings[] = (string) preg_replace_callback('/(?<=[a-z0-9])_([a-z])/', static fn (array $m) => strtoupper($m[1]), $n);
            }
        }
        $names = array_values(array_unique($spellings));
        $reason = self::tableRefusal($name, $prefix, $names);
        if ($reason !== null) {
            throw new HttpError(409, 'existing_table_refused', "existingTable `" . self::shown($name) . "` is refused: $reason");
        }
        self::$tables[$key] = true;
    }

    /**
     * The 0.8 table names a collection's binding may carry the digest of: the key it was first
     * adopted under (`adoptedAs`, which the compiler keeps across `was` renames), its key, and its
     * table name. The converter names a collection after its 0.8 table.
     *
     * @return list<string>
     */
    public static function names(string $collection, array $spec): array
    {
        $names = array_filter([$spec['adoptedAs'] ?? null, $spec['key'] ?? null, $collection], static fn ($n) => is_string($n) && $n !== '');

        return array_values(array_unique($names));
    }

    /** @param list<string> $names */
    private static function tableRefusal(string $name, string $prefix, array $names): ?string
    {
        if (preg_match('/\A[A-Za-z][A-Za-z0-9_]{0,63}\z/', $name) !== 1) {
            return 'it is not an exact SQL identifier';
        }
        // Table names are case-insensitive on some MySQL hosts (lower_case_table_names) and SQLite.
        $lower = strtolower($name);
        $own = strtolower($prefix);
        // As this site names them: CUSTOM_USER_TABLE and CUSTOM_USER_META_TABLE move users and usermeta.
        if (in_array($lower, self::wordpressTables(), true)) {
            return "it is one of WordPress's own tables";
        }
        if ($own !== '' && str_starts_with($lower, $own)) {
            $rest = substr($lower, strlen($own));
            if (in_array($rest, self::CORE_TABLES, true)) {
                return "it is WordPress's own `$rest` table";
            }
            if (str_starts_with($rest, 'first_')) {
                return "it is one of First's tables (`{$prefix}first_*`), which First manages itself";
            }
            if (str_starts_with($rest, 'actionscheduler_')) {
                return "it is one of Action Scheduler's tables, which queue the site's background jobs";
            }
            if (preg_match('/\A[0-9]+_/', $rest) === 1) {
                return 'it belongs to another site of this network';
            }
            if (str_starts_with($rest, 'identity_') || str_starts_with($rest, 'wc_') || str_starts_with($rest, 'woocommerce_')) {
                return "it is one of the identity or WooCommerce tables, which hold sign-in and payment records";
            }
            // Another site can have a longer prefix that starts with this one (`wp_shop_`, or `wp_shop`
            // with tables like `wp_shopusers`): every WordPress site has a `<its prefix>options` table.
            foreach (self::otherPrefixes($prefix) as $other) {
                if (str_starts_with($lower, $other)) {
                    return "it is under `$other`, another site's table prefix in this database";
                }
            }

            return null;
        }
        if (self::ownLegacyTable($lower, $own, $names)) {
            return null;
        }

        return str_starts_with($lower, 'sf_')
            ? "it is not this Space's Zero 0.8 table: on Spacefast the table prefix names the Space, elsewhere the host defines FIRST_SPACE_ID"
            : "it is outside this site's table prefix `$prefix`; other prefixes belong to other sites sharing the database";
    }

    /**
     * The other sites' table prefixes in this database that start with `$prefix`, lowercased: the
     * leading part of each `<prefix>…options` table with WordPress's options columns, found with one
     * query. A prefix is any run of `[A-Za-z0-9_]`, so it need not end in `_`; a plugin's own
     * `wp_myplugin_options` without those columns is not another site.
     *
     * @return list<string>
     */
    private static function otherPrefixes(string $prefix): array
    {
        global $wpdb;
        if (!isset($wpdb) || !($wpdb instanceof \wpdb)) {
            return [];
        }
        $own = strtolower($prefix);
        $found = [];
        $sql = "SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE %s
            AND COLUMN_NAME IN ('option_name', 'option_value', 'autoload') GROUP BY TABLE_NAME HAVING COUNT(DISTINCT COLUMN_NAME) = 3";
        foreach ((array) $wpdb->get_col($wpdb->prepare($sql, $wpdb->esc_like($prefix) . '%options')) as $table) {
            $other = strtolower(substr((string) $table, 0, -strlen('options')));
            if ($other !== $own && str_starts_with($other, $own)) {
                $found[] = $other;
            }
        }

        return $found;
    }

    /**
     * WordPress's tables as wpdb names them on this site, lowercased: `tables()` (which applies
     * CUSTOM_USER_TABLE and CUSTOM_USER_META_TABLE), the old ones, and the users and usermeta names
     * wpdb queries.
     *
     * @return list<string>
     */
    private static function wordpressTables(): array
    {
        global $wpdb;
        if (!isset($wpdb) || !($wpdb instanceof \wpdb)) {
            return [];
        }
        $tables = [...array_values($wpdb->tables('all')), ...array_values($wpdb->tables('old')), $wpdb->users, $wpdb->usermeta];

        return array_map('strtolower', array_filter($tables, 'is_string'));
    }

    /**
     * Whether `$lower` is this site's own Zero 0.8 table, `sf_<space>_<table>_<10 hex>` as the converter
     * writes it (src/config_migrate/app/transform.rs `physical`): `<space>` and `<table>` lowercased,
     * other characters `_`, the base cut to 53 characters, and the digest SHA-256(space NUL table). The
     * Space is the host's: Spacefast's `spacefast_content_space_id()`, else FIRST_SPACE_ID, and on a
     * `sfz_<24 hex>_` prefix it must also be the Space that prefix was made from. The digest needs the
     * real id and table name, so a table of another Space whose id starts with this one never matches.
     * `$names` are the candidate 0.8 table names (`names`); a name not cut to 53 characters also
     * holds its table name, lowercased.
     *
     * @param list<string> $names
     */
    private static function ownLegacyTable(string $lower, string $prefix, array $names): bool
    {
        if (preg_match('/\A(sf_[a-z0-9_]+)_([0-9a-f]{10})\z/', $lower, $m) !== 1) {
            return false;
        }
        $space = '';
        if (function_exists('spacefast_content_space_id')) {
            try {
                $space = \spacefast_content_space_id();
            } catch (\Throwable) {
                return false;
            }
            $space = is_string($space) ? $space : '';
        }
        if ($space === '' && defined('FIRST_SPACE_ID') && is_string(constant('FIRST_SPACE_ID'))) {
            $space = (string) constant('FIRST_SPACE_ID');
        }
        if ($space === '') {
            return false;
        }
        if (preg_match('/\Asfz_[0-9a-f]{24}_\z/', $prefix) === 1 && $prefix !== 'sfz_' . substr(hash('sha256', $space), 0, 24) . '_') {
            return false;
        }
        $part = static function (string $s): string {
            $s = substr(trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($s)), '_'), 0, 48);

            return $s === '' ? 'zero' : $s;
        };
        $head = 'sf_' . $part($space) . '_';
        if (!str_starts_with($m[1], $head)) {
            return false;
        }
        // The digest is over the 0.8 table's own name, case included.
        $rest = substr($lower, strlen($head), -11);
        foreach (array_unique(array_filter([...$names, $rest], static fn ($t) => $t !== '')) as $table) {
            $base = substr($head . $part($table), 0, 53);
            if ($base === $m[1] && hash_equals($m[2], substr(hash('sha256', $space . "\0" . $table), 0, 10))) {
                return true;
            }
        }

        return false;
    }

    /** A name as an error message shows it: printable, bounded. */
    private static function shown(string $name): string
    {
        $shown = (string) preg_replace('/[^\x20-\x7e]/', '?', $name);

        return strlen($shown) > 80 ? substr($shown, 0, 80) . '…' : $shown;
    }

    private static function rules(): array
    {
        return self::$rules ??= json_decode((string) file_get_contents(__DIR__ . '/guard.json'), true, flags: JSON_THROW_ON_ERROR);
    }
}
