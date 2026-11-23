<?php

declare(strict_types=1);

namespace SpacePress\Wp;

/**
 * Moves what a site stored under SpacePress's pre-release name onto the current names, once, in place.
 *
 * Until the rename the runtime stored its state as `typedpress…` and `tp_…`: tables, options, meta
 * keys, post types, taxonomies, roles and capabilities, Action Scheduler hooks and groups, wp-cron
 * events, the private-files directory and plugin basenames. This class is the only place in the
 * runtime with those spellings, and it names each one exactly: the runtime's own names
 * ({@see RUNTIME_OPTIONS} and friends) and the names it derives from each app's schema
 * ({@see plan()}). A `tp_` name the runtime never wrote (another plugin's option) is left alone.
 *
 * Forward only, and nothing is deleted. Tables are renamed, not recreated, so the migration ledger
 * keeps each applied file's recorded SHA-256, the revisions table its chain, and every row its ids.
 * The ledger gains one `data` row per app saying what moved. A site whose config sets no
 * `uploads.prefix` keeps the S3 key prefix its objects were stored under ({@see uploadPrefix()}).
 *
 * The whole plan is computed and checked before anything changes: if any new name is already taken
 * by something else, nothing is renamed, and the site reports which name to look at. Runs under the
 * migration lock, before anything reads storage: when a plugin-installed site's app registers
 * ({@see Runtime::app()}, on `plugins_loaded` or its activation) and when the host initializes a
 * managed build. Until then the runtime and identity install nothing on such a site, so no empty
 * table is created beside a stored one. A site with no legacy state changes nothing; running it
 * again changes nothing.
 */
final class BrandUpgrade
{
    public const DONE = 'sp_brand_upgrade';
    public const VERSION = 1;
    /** The S3 key prefix stored objects keep when the app's config sets none (see {@see uploadPrefix()}). */
    public const UPLOAD_PREFIX = 'sp_upload_prefix';

    private const LEGACY = 'typedpress';
    private const LEGACY_UPLOAD_PREFIX = 'typedpress';

    /**
     * Options a plugin writes on boot when they are missing (a secret, a probe verdict, identity's
     * password material and inventory cursor, the private-files directory): on a request that ran
     * before the move, a fresh value may already sit under the current name. The site's stored value
     * is the one that counts, so it replaces that seconds-old one instead of counting as a conflict.
     */
    private const REGENERATED = [
        'tp_runtime_secret', 'tp_runtime_private_ok', 'tp_runtime_private_checked',
        'tp_identity_dummy_password_hash', 'tp_identity_password_profiles', 'tp_identity_password_inventory',
    ];
    /** Options with fixed names (runtime, deploy plugin, identity, admin). */
    private const RUNTIME_OPTIONS = [
        'tp_runtime_tables', 'tp_installed', 'tp_runtime_site_id', 'tp_runtime_secret', 'tp_runtime_private_ok',
        'tp_runtime_private_checked', 'tp_jobs_prepared', 'tp_jobs_scheduled', 'tp_rewrite_rules', 'tp_kind_urls',
        'tp_polylang_languages', 'tp_upload_namespace', 'tp_search_shape', 'tp_schema_apply_granted',
        'tp_sitemap_pages', 'tp_public_symlinks', 'tp_prebuilt_id', 'tp_prebuilt_stale', 'tp_prebuilt_forgotten',
        'tp_git_dispatch_repository', 'tp_live_build', 'tp_deployments', 'tp_pending_deployments', 'tp_store_key',
        'tp_identity_schema_version', 'tp_identity_signing_keys', 'tp_identity_webhooks',
        'tp_identity_dummy_password_hash', 'tp_identity_password_profiles', 'tp_identity_password_inventory',
        'tp_admin_rewrite',
    ];
    /** Options named `<prefix><something>`: per build, per upload prefix, per global field. */
    private const RUNTIME_OPTION_PREFIXES = ['tp_prebuilt_', 'tp_upload_cursor_', 'tp_global_'];
    /** Options named `tp_<app><suffix>`. */
    private const APP_OPTION_SUFFIXES = [
        '_schema', '_refused', '_post_types', '_adopted_posts', '_seed', '_seed_refused', '_shipping', '_content',
        '_route_pages', '_runtime_schema', '_declared_fields', '_schema_apply_denied',
    ];
    /** Transients by prefix (their `_transient_` and `_transient_timeout_` rows), and site transients. */
    private const TRANSIENT_PREFIXES = ['tp_setup_notice_', 'tp_api_reference_'];
    private const SITE_TRANSIENTS = ['tp_admin_prev_update_plugins'];
    /** System tables (below `{prefix}`); identity's are `tp_identity_<name>`. */
    private const SYSTEM_TABLES = ['tp__migrations', 'tp__revisions', 'tp__jobs', 'tp__receipts', 'tp__versions', 'tp__files', 'tp__rates', 'tp__app_reads', 'tp__search', 'tp__schema_versions'];
    private const IDENTITY_TABLES = ['accounts', 'emails', 'providers', 'sessions', 'challenges', 'applications', 'codes', 'tokens', 'events', 'limits', 'organizations', 'members', 'passkeys', 'mfa', 'recovery_codes', 'deliveries'];
    /** Meta keys the runtime writes on posts, terms and users; app field values are `tp_<field>` ({@see plan()}). */
    private const META_KEYS = [
        '_tp_uid', '_tp_created_at', '_tp_updated_at', '_tp_deleted_at', '_tp_deleted_by', '_tp_deleted_group',
        '_tp_rev_meta', '_tp_rev_seq', '_tp_system', '_tp_staged', '_tp_route', '_tp_code_page', '_tp_focal',
        '_tp_uploads', 'tp_role', 'tp_admin_developer_mode', 'tp_excerpt',
    ];
    private const META_PREFIXES = ['_tp_coediting_schema', '_tp_field_'];
    /** Action Scheduler and wp-cron hooks, and runtime job names in `{prefix}sp__jobs`. */
    private const HOOKS = ['tp_job', 'tp_jobs_maintain', 'tp_job_schedule', 'tp_prebuild', 'tp_uploads_maintain', 'typedpress.prune-guests', 'tp_identity_maintenance', 'tp_identity_password_inventory'];
    private const CRON_SCHEDULES = ['tp_identity_minute' => 'sp_identity_minute'];
    private const JOBS = ['typedpress.mail', 'typedpress.connector', 'typedpress.webhook', 'typedpress.git-dispatch', 'typedpress.search.reindex'];
    private const ROLES = ['tp_guest' => 'sp_guest'];
    private const CAPABILITIES = ['tp_apply_schema' => 'sp_apply_schema'];
    private const POST_STATUSES = ['typedpress-staged' => 'spacepress-staged'];
    private const PAGE_SLUGS = ['typedpress-home' => 'spacepress-home'];
    private const GUEST_CLIENT = ['app_typedpress_guest' => 'app_spacepress_guest'];
    private const TWO_FACTOR = ['TypedPress_Identity_TwoFactorProvider' => 'SpacePress_Identity_TwoFactorProvider'];
    private const PRIVATE_DIR = ['typedpress-private' => 'spacepress-private'];
    /** The key of an application password's scope on its entry. */
    private const SCOPE_KEY = 'tp_scope';

    /** `sp_brand_upgrade`: the version once the move finished, `started` while one is under way. */
    private const STARTED = 'started';

    public static function done(): bool
    {
        $value = get_option(self::DONE, 0);

        return $value !== self::STARTED && (int) $value >= self::VERSION;
    }

    /**
     * Whether this site holds state under the pre-release name at all: the runtime's tables version
     * option, which every installed site has. One indexed read; false on a new site.
     */
    public static function pending(): bool
    {
        // Settled sites answer from the autoloaded marker: no query.
        $marker = get_option(self::DONE, 0);
        if ($marker === self::STARTED) {
            // A move that started and stopped part way is still pending: the next request resumes it.
            return true;
        }
        if ((int) $marker >= self::VERSION) {
            return false;
        }
        global $wpdb;
        if ($wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$wpdb->options} WHERE option_name = %s", 'tp_runtime_tables')) !== null) {
            return true;
        }
        // No state under the earlier name (a site installed after the rename): record that once, so
        // later requests skip the probe. add_option keeps a concurrent move's marker if one won.
        add_option(self::DONE, self::VERSION, '', true);

        return false;
    }

    /**
     * Runs the move once under the migration lock, for the app `$schema` describes (the build being
     * loaded: its storage names are the current ones, each the old one with `sp_` for `tp_`). The app
     * is needed: its tables, post types and fields are named from it, so until one registers, the
     * runtime installs nothing on a site that still holds the earlier names ({@see pending()}). Returns
     * what it renamed, by kind; empty when nothing was left or it already ran. Throws when the plan
     * conflicts, leaving everything as it was.
     *
     * @return array<string, int>
     */
    public static function ensure(\SpacePress\Schema $schema): array
    {
        if (self::done()) {
            return [];
        }
        global $wpdb;
        $db = new Connection($wpdb);
        $moved = [];
        Migrator::locked($db, 'sp_brand_upgrade', static function () use ($db, $schema, &$moved): void {
            wp_cache_delete(self::DONE, 'options');
            if (self::done()) {
                return;
            }
            $plan = self::plan($db, $schema);
            // A resumed move finds the names it already moved under both spellings only where it left
            // them half done; each step below is safe to run again, so only a first attempt checks.
            if (get_option(self::DONE) !== self::STARTED) {
                $conflicts = self::conflicts($db, $plan);
                if ($conflicts !== []) {
                    throw new \RuntimeException('SpacePress cannot move this site\'s stored names: ' . implode('; ', $conflicts) . '. Nothing was changed. Each of these exists under both its earlier name and its current one; keep the one this site uses and rename or export the other, then reload.');
                }
                update_option(self::DONE, self::STARTED, true);
            }
            $moved = self::apply($db, $plan);
            update_option(self::DONE, self::VERSION, true);
            InstallMarker::forget();
        });

        return $moved;
    }

    /** The S3 key prefix uploads use when the app's config sets none. */
    public static function uploadPrefix(): string
    {
        $stored = get_option(self::UPLOAD_PREFIX);

        return is_string($stored) && $stored !== '' ? $stored : 'spacepress';
    }

    // ================================================================ the plan

    /**
     * Every rename this site needs, as exact old => new names, read without changing anything.
     *
     * @return array{tables: array<string, string>, options: array<string, string>, sitemeta: array<string, string>, meta: array<string, array<string, string>>, metaValues: array<string, string>, postTypes: array<string, string>, taxonomies: array<string, string>, hooks: array<string, string>, groups: array<string, string>, jobs: array<string, string>, plugins: array<string, string>, private: ?array{string, string}, apps: list<string>}
     */
    public static function plan(Connection $db, \SpacePress\Schema $schema): array
    {
        $wpdb = $db->wpdb();
        $prefix = $db->prefix();
        $old = static fn (string $current): string => 'tp_' . substr($current, 3);

        $names = self::SYSTEM_TABLES;
        foreach (self::IDENTITY_TABLES as $table) {
            $names[] = 'tp_identity_' . $table;
        }
        $apps = [];
        $postTypes = [];
        $taxonomies = [];
        $fields = [];
        $fieldKeys = [];
        $apps[] = $schema->name();
        foreach (self::appStorage($schema) as [$kind, $current]) {
            match ($kind) {
                'table' => $names[] = $old($current),
                'postType' => $postTypes[$old($current)] = $current,
                'taxonomy' => $taxonomies[$old($current)] = $current,
                'field' => $fields[$old($current)] = $current,
                'fieldKey' => $fieldKeys['field_tp_' . substr($current, 9)] = $current,
            };
        }
        $ledger = $prefix . 'tp__migrations';
        if (self::existingTables($db, $ledger, exact: true) !== []) {
            foreach (array_column($db->run("SELECT DISTINCT `app` FROM `$ledger`"), 'app') as $app) {
                $apps[] = (string) $app;
            }
        }
        $apps = array_values(array_unique($apps));
        $tables = [];
        $owned = [];
        foreach (array_unique($names) as $name) {
            $owned[] = $prefix . 'sp_' . substr($name, 3);
            if (self::existingTables($db, $prefix . $name, exact: true) !== []) {
                $tables[$prefix . $name] = $prefix . 'sp_' . substr($name, 3);
            }
        }

        $options = [];
        foreach (self::RUNTIME_OPTIONS as $name) {
            $options[$name] = 'sp_' . substr($name, 3);
        }
        foreach ($apps as $app) {
            foreach (self::APP_OPTION_SUFFIXES as $suffix) {
                $options['tp_' . $app . $suffix] = 'sp_' . $app . $suffix;
            }
        }
        foreach (self::RUNTIME_OPTION_PREFIXES as $head) {
            foreach (self::keys($db, $wpdb->options, 'option_name', $head) as $name) {
                $options[$name] = 'sp_' . substr($name, 3);
            }
        }
        foreach (self::TRANSIENT_PREFIXES as $head) {
            foreach (['_transient_', '_transient_timeout_'] as $kind) {
                foreach (self::keys($db, $wpdb->options, 'option_name', $kind . $head) as $name) {
                    $options[$name] = $kind . 'sp_' . substr($name, strlen($kind) + 3);
                }
            }
        }
        $sitemeta = [];
        foreach (self::SITE_TRANSIENTS as $name) {
            foreach (['_site_transient_', '_site_transient_timeout_'] as $kind) {
                $options[$kind . $name] = $kind . 'sp_' . substr($name, 3);
                $sitemeta[$kind . $name] = $kind . 'sp_' . substr($name, 3);
            }
        }
        $options = self::present($db, $wpdb->options, 'option_name', $options);
        $postTypes = self::present($db, $wpdb->posts, 'post_type', $postTypes);
        $taxonomies = self::present($db, $wpdb->term_taxonomy, 'taxonomy', $taxonomies);
        $sitemeta = is_multisite() ? self::present($db, $wpdb->sitemeta, 'meta_key', $sitemeta) : [];

        $metaKeys = [];
        foreach (self::META_KEYS as $key) {
            $metaKeys[$key] = str_starts_with($key, '_') ? '_sp_' . substr($key, 4) : 'sp_' . substr($key, 3);
        }
        foreach ($fields as $from => $to) {
            $metaKeys[$from] = $to;
            // SCF's reference row beside each value, holding the field key.
            $metaKeys['_' . $from] = '_' . $to;
        }
        $meta = [];
        foreach (['postmeta', 'termmeta', 'usermeta'] as $table) {
            $found = $metaKeys;
            foreach (self::META_PREFIXES as $head) {
                foreach (self::keys($db, $wpdb->$table, 'meta_key', $head) as $key) {
                    $found[$key] = '_sp_' . substr($key, 4);
                }
            }
            $meta[$table] = self::present($db, $wpdb->$table, 'meta_key', $found);
        }

        $hooks = [];
        foreach (self::HOOKS as $hook) {
            $hooks[$hook] = str_starts_with($hook, self::LEGACY) ? 'spacepress' . substr($hook, strlen(self::LEGACY)) : 'sp_' . substr($hook, 3);
        }
        $groups = [self::LEGACY => 'spacepress', self::LEGACY . '-app' => 'spacepress-app'];
        foreach ($apps as $app) {
            $groups[self::LEGACY . '-' . $app] = 'spacepress-' . $app;
        }
        $jobs = [];
        foreach (self::JOBS as $job) {
            $jobs[$job] = 'spacepress' . substr($job, strlen(self::LEGACY));
        }

        $plugins = [];
        foreach (self::activePluginList() as $basename) {
            $to = self::pluginBasename($basename);
            if ($to !== $basename && is_file(WP_PLUGIN_DIR . '/' . $to)) {
                $plugins[$basename] = $to;
            }
        }
        $private = null;
        $from = WP_CONTENT_DIR . '/uploads/' . array_key_first(self::PRIVATE_DIR);
        if (is_dir($from) && !is_link($from)) {
            $private = [$from, WP_CONTENT_DIR . '/uploads/' . self::PRIVATE_DIR[array_key_first(self::PRIVATE_DIR)]];
        }

        return ['tables' => $tables, 'owned' => $owned, 'options' => $options, 'sitemeta' => $sitemeta, 'meta' => $meta, 'metaValues' => $fieldKeys,
            'postTypes' => $postTypes, 'taxonomies' => $taxonomies, 'hooks' => $hooks, 'groups' => $groups, 'jobs' => $jobs,
            'plugins' => $plugins, 'private' => $private, 'apps' => $apps];
    }

    /**
     * What the app's schema names in storage, by its current names: `[kind, name]` for its tables, post
     * types, taxonomies, field meta keys and SCF field keys.
     *
     * @return list<array{string, string}>
     */
    private static function appStorage(\SpacePress\Schema $schema): array
    {
        $out = [];
        foreach ([...$schema->kinds(), ...$schema->globals()] as $spec) {
            if (!is_array($spec)) {
                continue;
            }
            $wp = is_array($spec['wp'] ?? null) ? $spec['wp'] : [];
            if (is_string($spec['table'] ?? null) && str_starts_with($spec['table'], 'sp_')) {
                $out[] = ['table', $spec['table']];
            }
            foreach (['postType', 'taxonomy'] as $kind) {
                if (is_string($wp[$kind] ?? null) && str_starts_with($wp[$kind], 'sp_')) {
                    $out[] = [$kind, $wp[$kind]];
                }
            }
            foreach ((array) ($spec['columns'] ?? []) as $column => $def) {
                if (($wp['metaPrefix'] ?? null) === 'sp_') {
                    $out[] = ['field', 'sp_' . $column];
                }
                if (is_string($wp['fieldKeyPrefix'] ?? null) && str_starts_with($wp['fieldKeyPrefix'], 'field_sp_')) {
                    $out[] = ['fieldKey', $wp['fieldKeyPrefix'] . $column];
                }
                $join = is_array($def) ? ($def['references']['join'] ?? null) : null;
                if (is_string($join) && !str_starts_with($join, 'term:')) {
                    $out[] = ['table', 'sp__join_' . $join];
                }
            }
        }

        return $out;
    }

    /**
     * Every new name that is already taken: a table, option, meta key, post type, taxonomy or
     * directory present under both spellings.
     *
     * @return list<string>
     */
    public static function conflicts(Connection $db, array $plan): array
    {
        $wpdb = $db->wpdb();
        $found = [];
        foreach ($plan['tables'] as $from => $to) {
            self::existingTables($db, $to, exact: true) !== [] && $found[] = "table $to (and $from)";
        }
        $regenerated = array_map(static fn (string $o): string => 'sp_' . substr($o, 3), self::REGENERATED);
        foreach (self::taken($db, $wpdb->options, 'option_name', $plan['options']) as $name) {
            in_array($name, $regenerated, true) || $found[] = "option $name";
        }
        foreach ($plan['meta'] as $table => $keys) {
            foreach (self::taken($db, $wpdb->$table, 'meta_key', $keys) as $key) {
                $found[] = "$table key $key";
            }
        }
        foreach (self::taken($db, $wpdb->posts, 'post_type', $plan['postTypes']) as $type) {
            $found[] = "post type $type";
        }
        foreach (self::taken($db, $wpdb->term_taxonomy, 'taxonomy', $plan['taxonomies']) as $taxonomy) {
            $found[] = "taxonomy $taxonomy";
        }
        if ($plan['private'] !== null && file_exists($plan['private'][1]) && !self::freshPrivateRoot($plan['private'][1])) {
            $found[] = "directory {$plan['private'][1]}";
        }

        return $found;
    }

    /** A private-files directory holding only what the runtime writes into a new one. */
    private static function freshPrivateRoot(string $dir): bool
    {
        if (is_link($dir) || !is_dir($dir)) {
            return false;
        }

        return array_diff(scandir($dir) ?: [], ['.', '..', '.htaccess', 'index.php']) === [];
    }

    // ================================================================ applying it

    /** @return array<string, int> */
    private static function apply(Connection $db, array $plan): array
    {
        $wpdb = $db->wpdb();
        $moved = [];
        $moved['tables'] = self::moveTables($db, $plan['tables']);
        if (!$db->sqlite()) {
            // Every table the runtime and this app own, by its current name: those moved just now, and
            // those an earlier attempt moved before it stopped.
            self::renameForeignKeys($db, array_values(array_filter($plan['owned'], static fn (string $t): bool => self::existingTables($db, $t, exact: true) !== [])));
        }
        // A value a boot wrote under the current name moments ago gives way to the site's stored one.
        // The plan lists only old names still present, so on a resumed run an option already moved
        // is not in it and keeps its value.
        foreach (self::REGENERATED as $name) {
            if (isset($plan['options'][$name])) {
                $db->run("DELETE FROM `{$wpdb->options}` WHERE `option_name` = ?", [$plan['options'][$name]]);
            }
        }
        $moved['options'] = self::rename($db, $wpdb->options, 'option_name', $plan['options']);
        $moved['sitemeta'] = is_multisite() ? self::rename($db, $wpdb->sitemeta, 'meta_key', $plan['sitemeta']) : 0;
        $moved['meta'] = 0;
        foreach ($plan['meta'] as $table => $keys) {
            $moved['meta'] += self::rename($db, $wpdb->$table, 'meta_key', $keys);
        }
        foreach (['postmeta', 'termmeta', 'usermeta'] as $table) {
            $moved['meta'] += self::rename($db, $wpdb->$table, 'meta_value', $plan['metaValues']);
        }
        $moved['posts'] = self::rename($db, $wpdb->posts, 'post_type', $plan['postTypes'])
            + self::rename($db, $wpdb->posts, 'post_status', self::POST_STATUSES)
            + self::renameWhere($db, $wpdb->posts, 'post_name', self::PAGE_SLUGS, "`post_type` = 'page'");
        $moved['taxonomies'] = self::rename($db, $wpdb->term_taxonomy, 'taxonomy', $plan['taxonomies']);
        $moved['roles'] = self::roles($db, $plan['postTypes'] + $plan['taxonomies']);
        $moved['twoFactor'] = self::rename($db, $wpdb->usermeta, 'meta_value', self::TWO_FACTOR) + self::twoFactorLists($db);
        $moved['scopes'] = self::scopes($db);
        $moved['scheduler'] = self::scheduler($db, $plan['hooks'], $plan['groups']);
        $moved['cron'] = self::cron($plan['hooks']);
        $moved['jobs'] = self::rename($db, $db->prefix() . 'sp__jobs', 'job', $plan['jobs'], optional: true);
        $identity = $db->prefix() . 'sp_identity_applications';
        $moved['clients'] = self::rename($db, $identity, 'id', self::GUEST_CLIENT, optional: true)
            + self::rename($db, $db->prefix() . 'sp_identity_codes', 'client_id', self::GUEST_CLIENT, optional: true)
            + self::rename($db, $db->prefix() . 'sp_identity_tokens', 'client_id', self::GUEST_CLIENT, optional: true);
        $moved['plugins'] = self::activePlugins($plan['plugins']);
        if ($plan['private'] !== null) {
            if (self::freshPrivateRoot($plan['private'][1])) {
                // Only the deny rules a boot wrote just now; the site's own directory has them too.
                array_map('unlink', array_filter([$plan['private'][1] . '/.htaccess', $plan['private'][1] . '/index.php'], 'is_file'));
                rmdir($plan['private'][1]);
            }
            if (!rename($plan['private'][0], $plan['private'][1])) {
                throw new \RuntimeException("Cannot move {$plan['private'][0]} to {$plan['private'][1]}");
            }
            $moved['files'] = 1;
        }
        // Objects already in S3 keep their keys: the prefix a site without `uploads.prefix` used.
        if (isset($plan['options']['tp_upload_namespace']) && get_option(self::UPLOAD_PREFIX) === false) {
            add_option(self::UPLOAD_PREFIX, self::LEGACY_UPLOAD_PREFIX, '', false);
        }
        // Core's cache of theme directories, which named the earlier runtime's theme path; core rebuilds it.
        delete_site_transient('theme_roots');
        wp_cache_flush();
        $moved = array_filter($moved);
        self::ledger($db, $plan['apps'], $moved);

        return $moved;
    }

    /** Renames tables in one pass; SQLite keeps its rows, indexes, foreign keys and MySQL metadata. */
    private static function moveTables(Connection $db, array $tables): int
    {
        if ($tables === []) {
            return 0;
        }
        $q = static fn (string $n): string => '`' . str_replace('`', '``', $n) . '`';
        if (!$db->sqlite()) {
            // One statement: atomic, and foreign keys follow the renamed tables.
            $db->run('RENAME TABLE ' . implode(', ', array_map(static fn (string $from, string $to): string => $q($from) . ' TO ' . $q($to), array_keys($tables), $tables)));

            return count($tables);
        }
        $driver = $db->wpdb()->dbh;
        $pdo = method_exists($driver, 'get_sqlite_pdo') ? $driver->get_sqlite_pdo() : $driver;
        $quote = static fn (string $n): string => '"' . str_replace('"', '""', $n) . '"';
        $counts = [];
        foreach (array_keys($tables) as $from) {
            $counts[$from] = (int) $pdo->query('SELECT COUNT(*) FROM ' . $quote($from))->fetchColumn();
        }
        $info = array_column($pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_wp\\_sqlite\\_mysql\\_information\\_schema\\_%' ESCAPE '\\'")->fetchAll(\PDO::FETCH_ASSOC), 'name');
        $pdo->exec('PRAGMA legacy_alter_table = OFF');
        $pdo->beginTransaction();
        try {
            foreach ($tables as $from => $to) {
                // Native rename: SQLite rewrites references to the table in other tables' foreign keys.
                $pdo->exec('ALTER TABLE ' . $quote($from) . ' RENAME TO ' . $quote($to));
                // The driver names an index `<table>__<index>`; it keeps answering by those names.
                foreach ($pdo->query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = " . $pdo->quote($to) . ' AND sql IS NOT NULL')->fetchAll(\PDO::FETCH_ASSOC) as $index) {
                    if (!str_starts_with((string) $index['name'], $from . '__')) {
                        continue;
                    }
                    $renamed = $to . substr((string) $index['name'], strlen($from));
                    $sql = preg_replace('/^(CREATE (?:UNIQUE )?INDEX )(?:`(?:[^`]|``)+`|"(?:[^"]|"")+")/', '$1' . $quote($renamed), (string) $index['sql'], 1, $replaced);
                    if ($replaced !== 1) {
                        throw new \RuntimeException("Cannot rename index {$index['name']}");
                    }
                    $pdo->exec('DROP INDEX ' . $quote((string) $index['name']));
                    $pdo->exec((string) $sql);
                }
                foreach ($info as $meta) {
                    $columns = array_column($pdo->query('PRAGMA table_info(' . $quote((string) $meta) . ')')->fetchAll(\PDO::FETCH_ASSOC), 'name');
                    foreach (['TABLE_NAME', 'REFERENCED_TABLE_NAME'] as $column) {
                        if (in_array($column, $columns, true)) {
                            $pdo->prepare('UPDATE ' . $quote((string) $meta) . " SET $column = ? WHERE $column = ?")->execute([$to, $from]);
                        }
                    }
                }
            }
            // Constraint names, as on MySQL ({@see renameForeignKeys()}): the driver rebuilds a table's
            // SQLite definition from these rows on its next ALTER, so this is where the name lives.
            foreach ($info as $meta) {
                $columns = array_column($pdo->query('PRAGMA table_info(' . $quote((string) $meta) . ')')->fetchAll(\PDO::FETCH_ASSOC), 'name');
                if (!in_array('CONSTRAINT_NAME', $columns, true) || !in_array('TABLE_NAME', $columns, true)) {
                    continue;
                }
                $marks = implode(', ', array_fill(0, count($tables), '?'));
                $rename = $pdo->prepare('UPDATE ' . $quote((string) $meta) . " SET CONSTRAINT_NAME = 'sp_' || SUBSTR(CONSTRAINT_NAME, 4) WHERE CONSTRAINT_NAME LIKE 'tp\\_%' ESCAPE '\\' AND TABLE_NAME IN ($marks)");
                $rename->execute(array_values($tables));
            }
            foreach ($tables as $from => $to) {
                $count = (int) $pdo->query('SELECT COUNT(*) FROM ' . $quote($to))->fetchColumn();
                if ($count !== $counts[$from]) {
                    throw new \RuntimeException("$to holds $count rows after the move, $from held {$counts[$from]}");
                }
            }
            if ($pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) {
                throw new \RuntimeException('a foreign key no longer holds after moving the tables');
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return count($tables);
    }

    /**
     * Foreign keys keep the name they were created with across RENAME TABLE, and a later migration
     * drops one by the name the compiler gives it now (`sp_<table>_<column>_fk`, or `m<hash>_sp_…` on
     * a non-default prefix). Each `tp_…` constraint on `$tables` (current names) is added again under
     * that name, with the same columns, target (schema included) and rules, then the old one dropped.
     * Two statements per key, not one combined ALTER: MySQL refuses some drop-and-add combinations of
     * one key that MariaDB takes. It reads the keys from the database each time, so a run that stopped
     * between the rename and this step finishes it on the next attempt.
     *
     * @param list<string> $tables
     */
    private static function renameForeignKeys(Connection $db, array $tables): void
    {
        if ($tables === []) {
            return;
        }
        $marks = implode(', ', array_fill(0, count($tables), '?'));
        $rows = $db->run(
            "SELECT k.TABLE_NAME AS t, k.CONSTRAINT_NAME AS n, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_SCHEMA AS rs, k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS d, r.UPDATE_RULE AS u
             FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME IN ($marks) AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
            $tables,
        );
        // Every key of these tables by name, as `columns -> schema.table(columns) delete/update`: a key
        // already added under its new name by a run that stopped before dropping the old one is reused.
        $defined = [];
        foreach ($rows as $row) {
            $defined[$row['t']][(string) $row['n']][] = $row;
        }
        // InnoDB enforces NO ACTION as RESTRICT, and MySQL reports an omitted rule as either.
        $rule = static fn (string $r): string => $r === 'NO ACTION' ? 'RESTRICT' : $r;
        $shape = static fn (array $parts): string => implode(',', array_column($parts, 'c')) . '>' . $parts[0]['rs'] . '.' . $parts[0]['rt'] . '(' . implode(',', array_column($parts, 'rc')) . ')'
            . $rule((string) $parts[0]['d']) . '/' . $rule((string) $parts[0]['u']);
        $keys = [];
        foreach ($rows as $row) {
            $name = (string) $row['n'];
            if (preg_match('/\A(m[0-9a-f]{7}_)?tp_/', $name, $m) !== 1) {
                continue;
            }
            $head = $m[1] ?? '';
            $key = &$keys[$row['t']][$name];
            $key ??= ['to' => substr($head . 'sp_' . substr($name, strlen($head . 'tp_')), 0, 64), 'cols' => [], 'refs' => [],
                'schema' => (string) $row['rs'], 'table' => (string) $row['rt'], 'delete' => $row['d'], 'update' => $row['u']];
            $key['cols'][] = $row['c'];
            $key['refs'][] = $row['rc'];
            unset($key);
        }
        $q = static fn (string $n): string => '`' . str_replace('`', '``', $n) . '`';
        $rules = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'];
        $here = (string) ($db->run('SELECT DATABASE() AS d')[0]['d'] ?? '');
        foreach ($keys as $table => $constraints) {
            foreach ($constraints as $name => $k) {
                $delete = in_array($k['delete'], $rules, true) ? $k['delete'] : 'RESTRICT';
                $update = in_array($k['update'], $rules, true) ? $k['update'] : 'RESTRICT';
                // The target as stored: another database's table stays that database's.
                $target = ($k['schema'] !== '' && $k['schema'] !== $here ? $q($k['schema']) . '.' : '') . $q($k['table']);
                $existing = $defined[$table][$k['to']] ?? null;
                if ($existing !== null && $shape($existing) !== $shape($defined[$table][$name])) {
                    throw new \RuntimeException("Cannot rename foreign key $name on $table: $table already has a different key named {$k['to']}");
                }
                if ($existing === null) {
                    $db->run('ALTER TABLE ' . $q((string) $table) . ' ADD CONSTRAINT ' . $q($k['to']) . ' FOREIGN KEY (' . implode(', ', array_map($q, $k['cols'])) . ') REFERENCES ' . $target
                        . ' (' . implode(', ', array_map($q, $k['refs'])) . ") ON DELETE $delete ON UPDATE $update");
                }
                $db->run('ALTER TABLE ' . $q((string) $table) . ' DROP FOREIGN KEY ' . $q($name));
                // The index MySQL made for the old key outlives it; the new key made its own.
                if ($db->run('SELECT 1 AS x FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [(string) $table, $name]) !== []) {
                    $db->run('ALTER TABLE ' . $q((string) $table) . ' DROP INDEX ' . $q($name));
                }
            }
        }
    }

    /** Capability names on roles and users: the schema capability, the guest role, post-type and taxonomy caps. */
    private static function roles(Connection $db, array $kinds): int
    {
        $wpdb = $db->wpdb();
        $map = static function (string $name) use ($kinds): string {
            if (isset(self::ROLES[$name])) {
                return self::ROLES[$name];
            }
            if (isset(self::CAPABILITIES[$name])) {
                return self::CAPABILITIES[$name];
            }
            // `edit_tp_x_item`, `create_tp_x`, `manage_tp_tax`: a kind's own caps.
            foreach ($kinds as $from => $to) {
                if (preg_match('/^([a-z_]+_)' . preg_quote($from, '/') . '(_[a-z]+)?$/D', $name, $m)) {
                    return $m[1] . $to . ($m[2] ?? '');
                }
            }

            return $name;
        };
        $count = 0;
        $roles = get_option($wpdb->prefix . 'user_roles');
        if (is_array($roles)) {
            $next = [];
            foreach ($roles as $role => $spec) {
                $caps = [];
                foreach ((array) ($spec['capabilities'] ?? []) as $cap => $grant) {
                    $caps[$map((string) $cap)] = $grant;
                }
                $to = $map((string) $role);
                // A boot may have added the role under its new name already: one role, both grants.
                $next[$to] = ['capabilities' => $caps + (array) ($next[$to]['capabilities'] ?? [])] + (array) $spec + (array) ($next[$to] ?? []);
            }
            if ($next !== $roles) {
                update_option($wpdb->prefix . 'user_roles', $next);
                // WP_Roles holds its own copy and writes it back on the next role change: reload it.
                wp_roles()->for_site();
                $count++;
            }
        }
        $key = $wpdb->prefix . 'capabilities';
        foreach ($db->run("SELECT `umeta_id` AS id, `meta_value` AS v FROM `{$wpdb->usermeta}` WHERE `meta_key` = ?", [$key]) as $row) {
            $caps = maybe_unserialize((string) $row['v']);
            if (!is_array($caps)) {
                continue;
            }
            $next = [];
            foreach ($caps as $cap => $grant) {
                $next[$map((string) $cap)] = $grant;
            }
            if ($next !== $caps) {
                $db->run("UPDATE `{$wpdb->usermeta}` SET `meta_value` = ? WHERE `umeta_id` = ?", [serialize($next), (int) $row['id']]);
                $count++;
            }
        }

        return $count;
    }

    /** Each application password's scope, kept on its entry under {@see AgentScope::KEY}. */
    private static function scopes(Connection $db): int
    {
        $wpdb = $db->wpdb();
        [$from, $to] = [self::SCOPE_KEY, AgentScope::KEY];
        $count = 0;
        foreach ($db->run("SELECT `umeta_id` AS id, `meta_value` AS v FROM `{$wpdb->usermeta}` WHERE `meta_key` = '_application_passwords' AND `meta_value` LIKE ?", ['%"' . $from . '"%']) as $row) {
            $passwords = maybe_unserialize((string) $row['v']);
            if (!is_array($passwords)) {
                continue;
            }
            foreach ($passwords as $i => $entry) {
                if (is_array($entry) && array_key_exists($from, $entry)) {
                    $passwords[$i][$to] ??= $entry[$from];
                    unset($passwords[$i][$from]);
                }
            }
            $db->run("UPDATE `{$wpdb->usermeta}` SET `meta_value` = ? WHERE `umeta_id` = ?", [serialize($passwords), (int) $row['id']]);
            $count++;
        }

        return $count;
    }

    /** Two Factor's enabled-providers list, a serialized array that names the provider class. */
    private static function twoFactorLists(Connection $db): int
    {
        $wpdb = $db->wpdb();
        [$from, $to] = [array_key_first(self::TWO_FACTOR), self::TWO_FACTOR[array_key_first(self::TWO_FACTOR)]];
        $count = 0;
        foreach ($db->run("SELECT `umeta_id` AS id, `meta_value` AS v FROM `{$wpdb->usermeta}` WHERE `meta_key` = '_two_factor_enabled_providers' AND `meta_value` LIKE ?", ['%' . $from . '%']) as $row) {
            $list = maybe_unserialize((string) $row['v']);
            if (is_array($list)) {
                $next = array_values(array_unique(array_map(static fn ($p) => $p === $from ? $to : $p, $list)));
                $db->run("UPDATE `{$wpdb->usermeta}` SET `meta_value` = ? WHERE `umeta_id` = ?", [serialize($next), (int) $row['id']]);
                $count++;
            }
        }

        return $count;
    }

    /** Action Scheduler: every action's hook, and the groups under their current slugs. */
    private static function scheduler(Connection $db, array $hooks, array $groups): int
    {
        $prefix = $db->prefix();
        $actions = $prefix . 'actionscheduler_actions';
        $table = $prefix . 'actionscheduler_groups';
        if (self::existingTables($db, $actions, exact: true) === [] || self::existingTables($db, $table, exact: true) === []) {
            return 0;
        }
        $count = self::rename($db, $actions, 'hook', $hooks);
        foreach ($groups as $from => $to) {
            $old = $db->run("SELECT `group_id` AS id FROM `$table` WHERE `slug` = ?", [$from]);
            if ($old === []) {
                continue;
            }
            $current = $db->run("SELECT MIN(`group_id`) AS id FROM `$table` WHERE `slug` = ?", [$to])[0]['id'] ?? null;
            if ($current === null) {
                $db->run("UPDATE `$table` SET `slug` = ? WHERE `slug` = ?", [$to, $from]);
            } else {
                // A request already scheduled under the new slug: its group takes the old one's actions.
                foreach (array_column($old, 'id') as $id) {
                    $db->run("UPDATE `$actions` SET `group_id` = ? WHERE `group_id` = ?", [(int) $current, (int) $id]);
                }
            }
            wp_cache_delete($from, \ActionScheduler_DBStore::GROUP_IDS_CACHE_GROUP);
            wp_cache_delete($to, \ActionScheduler_DBStore::GROUP_IDS_CACHE_GROUP);
            $count += count($old);
        }

        return $count;
    }

    /** wp-cron events of the runtime's hooks, with the same times, arguments and schedules. */
    private static function cron(array $hooks): int
    {
        $cron = _get_cron_array();
        if (!is_array($cron)) {
            return 0;
        }
        $count = 0;
        foreach ($cron as $time => $events) {
            foreach ((array) $events as $hook => $instances) {
                if (!isset($hooks[$hook])) {
                    continue;
                }
                foreach ((array) $instances as $key => $event) {
                    if (is_string($event['schedule'] ?? null) && isset(self::CRON_SCHEDULES[$event['schedule']])) {
                        $event['schedule'] = self::CRON_SCHEDULES[$event['schedule']];
                    }
                    $cron[$time][$hooks[$hook]][$key] = $event;
                }
                unset($cron[$time][$hook]);
                $count++;
            }
        }
        if ($count > 0) {
            _set_cron_array($cron);
        }

        return $count;
    }

    /**
     * Replaces renamed plugins in the active lists, in place, so the same set stays active. When this
     * runs inside a plugin's activation (`activate_plugin()` appends that plugin to the list after its
     * hook), the plugin may already be listed by now: the rest of this request keeps the list unique.
     */
    private static function activePlugins(array $plugins): int
    {
        if ($plugins === []) {
            return 0;
        }
        add_filter('pre_update_option_active_plugins', static fn ($list) => is_array($list) ? array_values(array_unique($list)) : $list);
        $active = get_option('active_plugins', []);
        if (is_array($active)) {
            update_option('active_plugins', array_values(array_unique(array_map(static fn ($p) => $plugins[$p] ?? $p, $active))));
        }
        if (is_multisite()) {
            $network = get_site_option('active_sitewide_plugins', []);
            if (is_array($network)) {
                $next = [];
                foreach ($network as $basename => $time) {
                    $next[$plugins[$basename] ?? $basename] = $time;
                }
                update_site_option('active_sitewide_plugins', $next);
            }
        }

        return count($plugins);
    }

    /** @return list<string> */
    private static function activePluginList(): array
    {
        $list = array_values(array_filter((array) get_option('active_plugins', []), 'is_string'));
        if (is_multisite()) {
            $list = [...$list, ...array_keys((array) get_site_option('active_sitewide_plugins', []))];
        }

        return array_values(array_unique($list));
    }

    /** `typedpress/typedpress.php`, `typedpress-app-x/typedpress-app-x.php`: the same plugin's current basename. */
    private static function pluginBasename(string $basename): string
    {
        $parts = explode('/', $basename);
        if (count($parts) !== 2 || !($parts[0] === self::LEGACY || str_starts_with($parts[0], self::LEGACY . '-'))) {
            return $basename;
        }

        return implode('/', array_map(static fn (string $part): string => 'spacepress' . substr($part, strlen(self::LEGACY)), $parts));
    }

    /** One `data` row per app in the ledger: what moved. The rows already there are left as they are. */
    private static function ledger(Connection $db, array $apps, array $moved): void
    {
        $ledger = $db->prefix() . 'sp__migrations';
        if ($apps === [] || self::existingTables($db, $ledger, exact: true) === []) {
            return;
        }
        $id = 'brand-upgrade-v' . self::VERSION;
        foreach ($apps as $app) {
            if ($db->run("SELECT 1 AS x FROM `$ledger` WHERE `app` = ? AND `id` = ?", [$app, $id]) === []) {
                $db->run(
                    "INSERT INTO `$ledger` (`app`, `id`, `kind`, `applied_at`, `sql`, `actor`, `reason`, `rows_affected`) VALUES (?, ?, 'data', ?, NULL, 'spacepress', ?, ?)",
                    [$app, $id, gmdate('Y-m-d\TH:i:s.000\Z'), 'stored names moved from the pre-release name: ' . (string) \SpacePress\Json::encode($moved), array_sum($moved)],
                );
            }
        }
    }

    // ================================================================ helpers

    /** @return list<string> tables named `$name` exactly, or starting with it */
    private static function existingTables(Connection $db, string $name, bool $exact = false): array
    {
        $match = $exact ? $name : addcslashes($name, '\\_%') . '%';
        $op = $exact ? '=' : 'LIKE';
        $rows = $db->sqlite()
            ? $db->run("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name $op ?", [$match])
            : $db->run("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME $op ?", [$match]);
        $names = array_map('strval', array_column($rows, 'n'));

        // LIKE is case-insensitive; table names here are not.
        return array_values(array_filter($names, static fn (string $n): bool => $exact ? $n === $name : str_starts_with($n, $name)));
    }

    /** @return list<string> values of `$column` starting with `$head` (and ending with `$tail`) */
    private static function keys(Connection $db, string $table, string $column, string $head, string $tail = ''): array
    {
        $like = addcslashes($head, '\\_%') . '%' . addcslashes($tail, '\\_%');
        $values = array_map('strval', array_column($db->run("SELECT DISTINCT `$column` AS v FROM `$table` WHERE `$column` LIKE ?", [$like]), 'v'));

        return array_values(array_filter($values, static fn (string $v): bool => str_starts_with($v, $head) && str_ends_with($v, $tail)));
    }

    /** The entries of `$map` whose old name exists in `$column`. */
    private static function present(Connection $db, string $table, string $column, array $map): array
    {
        $out = [];
        foreach (array_chunk(array_keys($map), 200) as $chunk) {
            $marks = implode(', ', array_fill(0, count($chunk), '?'));
            foreach (array_column($db->run("SELECT DISTINCT `$column` AS v FROM `$table` WHERE `$column` IN ($marks)", $chunk), 'v') as $name) {
                if (isset($map[(string) $name])) {
                    $out[(string) $name] = $map[(string) $name];
                }
            }
        }

        return $out;
    }

    /** New names of `$map` already present in `$column`. @return list<string> */
    private static function taken(Connection $db, string $table, string $column, array $map): array
    {
        return array_keys(self::present($db, $table, $column, array_combine(array_values($map), array_values($map)) ?: []));
    }

    private static function rename(Connection $db, string $table, string $column, array $map, bool $optional = false): int
    {
        return self::renameWhere($db, $table, $column, $map, null, $optional);
    }

    /** Sets `$column` from each old value to its new one; with `$optional`, a missing table is no work. */
    private static function renameWhere(Connection $db, string $table, string $column, array $map, ?string $where = null, bool $optional = false): int
    {
        if ($map === [] || ($optional && self::existingTables($db, $table, exact: true) === [])) {
            return 0;
        }
        $count = 0;
        foreach ($map as $from => $to) {
            $rows = (int) ($db->run("SELECT COUNT(*) AS n FROM `$table` WHERE `$column` = ?" . ($where ? " AND $where" : ''), [(string) $from])[0]['n'] ?? 0);
            if ($rows > 0) {
                $db->run("UPDATE `$table` SET `$column` = ? WHERE `$column` = ?" . ($where ? " AND $where" : ''), [(string) $to, (string) $from]);
                $count += $rows;
            }
        }

        return $count;
    }
}
