<?php
declare(strict_types=1);
namespace First\Wp;

/** The single runtime and app registry; optional features attach to existing seams. */
final class Runtime
{
    public const SERIES = \First\Schema::SERIES;
    public const VERSION = '0.3.0';
    private static ?Plugin $plugin = null;
    private static ?string $appFile = null;
    private static bool $booted = false;
    /** The runtime plugin's main file, for URLs of the runtime's own browser modules. */
    private static ?string $runtimeFile = null;
    private static bool $managed = false;
    /** @var array<string, callable> `wp first` commands other First plugins register (identity) */
    private static array $commands = [];
    /** Why the shared system tables are behind this runtime (failed or contended upgrade), else null. */
    private static ?string $unavailable = null;

    public static function boot(string $runtimeFile): void
    {
        if (self::$booted) {
            return;
        }
        if (!Platform::wordpressSupported((string) get_bloginfo('version')) || version_compare(PHP_VERSION, Platform::PHP, '<')) {
            self::notice('WordPress ' . Platform::WORDPRESS . '+ and PHP ' . Platform::PHP . '+ are required');
            return;
        }
        self::$booted = true;
        self::$runtimeFile = $runtimeFile;
        // A guarded upgrade step, not a table: staged revisions written before they had their own
        // status get it (WpPostStore::upgradeStagedStatus), once per site with the other steps.
        \First\SystemTables::register('__first_staged_status', [\First\SystemTables::step(1, WpPostStore::upgradeStagedStatus(...))]);
        // First's API (/__first/api/v1) is a REST request outside /wp-json: Polylang must set itself up
        // as for one (every language, the API's own `locale`), not as a front-end page whose language
        // would filter every internal query. Its context is chosen on plugins_loaded, after this file.
        // (With no language yet Polylang sets up no context for a page request; a REST one still gets one.)
        add_filter('pll_context', static fn (mixed $class): mixed => in_array($class, ['PLL_Frontend', ''], true) && Facade::path() !== null ? 'PLL_REST_Request' : $class);
        // Core accepts application passwords on REST requests only; the API is one. Registered here, as
        // the runtime loads, because a plugin (Polylang in its REST context) may resolve the current user
        // before the app's own plugin has booted.
        add_filter('application_password_is_api_request', static fn (bool $api): bool => $api || Facade::path() !== null);
        RouteRequest::register();
        AgentScope::trackCookie();
        // A scoped application password signs in only where an active app enforces its scope.
        add_action('wp_authenticate_application_password_errors', [AgentScope::class, 'authenticating'], 10, 3);
        add_filter('rest_authentication_errors', [AgentScope::class, 'unenforced'], 95);
        register_activation_hook($runtimeFile, [self::class, 'activate']);
        PageCaches::register();
        // A site that ran a build from before the rename to First moves its stored names first, before
        // any table, option or post type of First's exists (ZeroNames). Managed apps do it in initialize().
        add_action('init', static function (): void {
            if (!self::$managed && ZeroNames::pending() && Platform::problems() === []) {
                global $wpdb;
                try {
                    ZeroNames::upgrade(new Connection($wpdb));
                } catch (\Throwable $e) {
                    // WordPress keeps serving; First refuses until the next request retries.
                    self::$unavailable = $e->getMessage();
                    error_log('[first] ' . self::$unavailable);
                    self::notice(self::$unavailable);
                }
            }
            foreach (ZeroNames::kept() as $type) {
                self::notice("posts of type $type were kept under that name: WordPress limits post types to 20 characters, and its First name would be longer. Rename the collection to at most 14 characters and move its posts to first_<name>");
            }
        }, PHP_INT_MIN);
        // As with app migrations: a runtime updated by copying files in sets up its tables on the
        // first request of any kind, once, under a lock.
        add_action('init', static function (): void {
            if (self::$managed || ZeroNames::pending() || get_option('first_runtime_tables') === self::tablesVersion() || Platform::problems() !== []) {
                return;
            }
            global $wpdb;
            $current = static function (): bool {
                wp_cache_delete('first_runtime_tables', 'options');
                return get_option('first_runtime_tables') === self::tablesVersion();
            };
            self::$unavailable = Migrator::upgrade(new Connection($wpdb), 'first_runtime_tables', $current, [self::class, 'applySystemTables']);
        }, 1);
        if (defined('WP_CLI') && WP_CLI) {
            \WP_CLI::add_command('first', static function (array $args, array $flags): void {
                if (in_array($args[0] ?? 'help', ['help', '--help'], true)) {
                    \WP_CLI::line(self::help());
                    return;
                }
                // Commands of other First plugins (identity) don't need an app.
                if (isset(self::$commands[$args[0]])) {
                    $code = (self::$commands[$args[0]])(array_slice($args, 1), $flags);
                    $code === 0 || \WP_CLI::halt($code);
                    return;
                }
                if (self::$plugin === null) {
                    \WP_CLI::error('No compatible First app is active.');
                }
                // While storage is behind, only `migrate` runs; every other command (legacy migration
                // included) would write against tables that don't match the build.
                if (($args[0] ?? '') !== 'migrate' && self::$plugin->unavailable() !== null) {
                    \WP_CLI::line((string) \First\Js::jsonStringify(['error' => \First\App::problem(new \First\HttpError(503, 'unavailable', (string) self::$plugin->unavailable()))]));
                    \WP_CLI::halt(1);
                }
                if (($args[0] ?? '') === 'seed') {
                    $code = \First\Sync\Seed::wpCli(self::$plugin, $args, $flags);
                    $code === 0 || \WP_CLI::halt($code);
                    return;
                }
                if (\First\Wp\Legacy\Module::handles($args)) {
                    $code = \First\Wp\Legacy\Module::wpCli(self::$plugin, $args, $flags);
                    $code === 0 || \WP_CLI::halt($code);
                    return;
                }
                self::$plugin->cli($args, $flags);
            });
        }
        do_action('first_runtime_loaded');
    }

    /**
     * A `wp first <name>` command owned by another First plugin; it runs without an app transaction.
     *
     * @param callable(list<string> $args, array<string, string|true> $flags): int $fn prints its own JSON; returns the exit code
     */
    public static function command(string $name, callable $fn): void
    {
        if ($name === '' || isset(self::$commands[$name])) {
            throw new \LogicException("Invalid or duplicate wp first command '$name'");
        }
        self::$commands[$name] = $fn;
    }

    /** `wp first help`: the site commands of the table `first help` prints (Cli/commands.json). */
    private static function help(): string
    {
        $table = json_decode((string) file_get_contents(dirname(__DIR__) . '/Cli/commands.json'), true, 8, JSON_THROW_ON_ERROR);
        $rows = array_values(array_filter($table['site'], static fn (array $row): bool => ($row['via'] ?? null) !== 'wp'));
        $width = max(array_map(static fn (array $row): int => strlen($row['name']), $rows));
        $lines = ['usage: wp first <command> (or first <command> from a project)', ''];
        foreach ($rows as $row) {
            $lines[] = '  ' . str_pad($row['name'], $width) . '  ' . $row['summary'];
        }

        return implode("\n", $lines);
    }

    /** Mount exactly one version after platform plugins load. Visitors never migrate managed apps. */
    public static function mount(string $runtimeFile, string $appDir, array $variables = []): Plugin
    {
        if (self::$booted && !self::$managed) {
            throw new \RuntimeException('A site-wide First runtime is already loaded');
        }
        self::$managed = true;
        \First\Env::isolate($variables);
        self::boot($runtimeFile);
        $plugin = self::app($appDir, $appDir . '/' . basename($appDir) . '.php');
        if ($plugin === null) {
            throw new \RuntimeException('Cannot mount the managed First app; check platform requirements');
        }
        return $plugin;
    }

    public static function managed(): bool
    {
        return self::$managed;
    }

    /**
     * The host calls this on the candidate before exposing its immutable URL. `$drops` are the
     * publisher's `--drop` confirmations (`['likes' => 1204]`); a refused schema change throws
     * SchemaRefused with every refusal and its fix, before any table changes.
     *
     * @param array<string, int> $drops
     */
    public static function initialize(array $drops = []): array
    {
        if (!self::$managed || self::$plugin === null) {
            throw new \LogicException('Mount a managed app before initializing it');
        }
        $problems = Platform::problems(self::$plugin->schema->locales() !== null);
        if ($problems !== []) {
            throw new \RuntimeException(implode('; ', $problems));
        }
        global $wpdb;
        ZeroNames::upgrade(new Connection($wpdb));
        Migrator::locked(new Connection($wpdb), 'first_runtime_tables', [self::class, 'applySystemTables']);
        $applied = self::$plugin->initialize($drops);
        self::install();

        return $applied;
    }

    /**
     * What a plugin-installed site installs on requests and a managed build installs only here, once
     * storage matches the build: each step is idempotent and checks whether it is already done.
     */
    private static function install(): void
    {
        \First\RuntimeSchema\Surfaces::grant();
        Uploads::install();
        if (self::$plugin->schema->files() !== []) {
            WpFiles::install();
        }
        if (function_exists('as_schedule_recurring_action')) {
            Jobs\ActionSchedulerQueue::install();
            Guests::install();
        }
        ContentPages::install();
        RoutePages::install();
        \First\Search\Index::reindexChanged();
        self::installRewrites();
        // The Pages log and swallow a failure on a request (the next one retries); initialize's
        // receipt must mean everything is installed, so what is still to do is a failure here.
        $left = self::installPlan();
        if ($left !== []) {
            throw new \RuntimeException('First could not install ' . implode(', ', array_column($left, 'id')) . '; see the PHP error log');
        }
    }

    /**
     * Whether the stored rewrite rules need rebuilding for this build: kind URL patterns other than the
     * ones recorded, rules First didn't build (or none), or First Admin's rule not recorded for its version.
     */
    private static function rewritesBehind(): bool
    {
        return !KindUrls::recorded() || !Hardening::rulesCurrent()
            || (function_exists('first_admin_rewrite_recorded') && !first_admin_rewrite_recorded());
    }

    /**
     * One rebuild of the stored rewrite rules, with every rule this build registers (kind URLs, First
     * Admin's): first the `rewrite_rules` option (and First's fingerprint of it), then, where WordPress
     * writes one, the server's `.htaccess`. Two steps because WP-CLI, where a host initializes, has no
     * Apache module to ask: WordPress there never writes `.htaccess`, so the file is written only when
     * the site's own web server is Apache with mod_rewrite (`$is_apache`, set from the server software).
     * A server that never reads the file sends `/wp-admin/new/` to index.php, where First Admin answers.
     *
     * @return array{rules: bool, htaccess: ?bool} what was written; `htaccess` null when not attempted
     */
    public static function installRewrites(): array
    {
        if (!self::rewritesBehind()) {
            return ['rules' => false, 'htaccess' => null];
        }
        // The rules this build registers on `init`, which has run: KindUrls, First Admin's.
        if (function_exists('first_admin_add_rewrite_rule')) {
            first_admin_add_rewrite_rule();
        }
        flush_rewrite_rules(false);
        KindUrls::record();
        $htaccess = null;
        if (function_exists('first_admin_add_rewrite_rule')) {
            $htaccess = self::writeHtaccess();
            first_admin_record_rewrite();
        }

        return ['rules' => true, 'htaccess' => $htaccess];
    }

    /**
     * `.htaccess` with the rules just stored, as WordPress writes it from a web request under Apache
     * with mod_rewrite. From WP-CLI, `got_mod_rewrite()` is false (no Apache module to ask), so it says
     * yes when the site's `.htaccess` already holds WordPress's own block: core put it there from a web
     * request under Apache. Anywhere else it writes nothing.
     */
    private static function writeHtaccess(): bool
    {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/misc.php';
        $file = get_home_path() . '.htaccess';
        $apache = is_file($file) && str_contains((string) @file_get_contents($file), '# BEGIN WordPress');
        $force = static fn (bool $got): bool => $got || $apache;
        add_filter('got_rewrite', $force);
        try {
            return save_mod_rewrite_rules() === true;
        } finally {
            remove_filter('got_rewrite', $force);
        }
    }

    /**
     * One step of a plan: `kind` says what it does (`page.create`, `rewrite-rules`, …; the set is open:
     * a reader must accept kinds it doesn't know, data migrations among the expected ones), `id` names
     * it uniquely within the plan, and `state` is `pending` until a deployment records its progress.
     * Anything else is the kind's own detail.
     *
     * @param array<string, mixed> $detail
     * @return array{kind: string, id: string, state: string}
     */
    public static function step(string $kind, string $id, array $detail = []): array
    {
        return ['kind' => $kind, 'id' => $id, 'state' => 'pending'] + $detail;
    }

    /**
     * The install steps {@see install()} would run for this build, computed without writing: Pages
     * (each created, changed, adopted, hidden, restored or trashed), the front-page options, and one
     * rebuild of the rewrite rules. An empty list means installing changes nothing.
     *
     * @return list<array>
     */
    public static function installPlan(): array
    {
        $steps = [...ContentPages::plan(), ...RoutePages::plan()];
        if (class_exists(\First\Search\Index::class, false) && \First\Search\Index::shapeChanged()) {
            $steps[] = self::step('search-shape', 'search-shape');
        }
        if (self::rewritesBehind()) {
            $steps[] = self::step('rewrite-rules', 'rewrite-rules');
        }

        return $steps;
    }

    /**
     * What {@see initialize()} would run on this site for the mounted managed build, computed without
     * writing anything: the shared system steps when the site recorded another set, the stored-name
     * upgrade from before the rename, the identity schema, the app's migrations and the runtime-schema
     * comparison. Refusals (platform, schema check with `$drops`, runtime schema) are listed, all at
     * once; nothing is thrown for them.
     *
     * @param array<string, int> $drops
     * @return array{steps: list<array{kind: string, id: string, state: string}>, platform: list<string>, legacyNames: bool, systemTables: ?array{from: mixed, to: string, steps: array<string, list<string>>}, identitySchema: ?array{from: int, to: int}, migrations: list<array>, install: list<array>, runtimeSchema: ?array, refusals: list<array>}
     */
    public static function inspect(array $drops = []): array
    {
        if (!self::$managed || self::$plugin === null) {
            throw new \LogicException('Mount a managed app before inspecting it');
        }
        global $wpdb;
        // Read past the object cache: another process may have written since this request started.
        $option = static function (string $name) use ($wpdb): mixed {
            $value = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $name));

            return $value === null ? null : maybe_unserialize($value);
        };
        $platform = Platform::problems(self::$plugin->schema->locales() !== null);
        $recorded = $option('first_runtime_tables');
        $identity = null;
        if (class_exists(\First\Identity\Schema::class)) {
            $from = (int) ($option('first_identity_schema_version') ?? 0);
            $identity = $from < \First\Identity\Schema::VERSION ? ['from' => $from, 'to' => \First\Identity\Schema::VERSION] : null;
        }
        $app = self::$plugin->inspect($drops);
        $install = self::installPlan();
        $legacy = ZeroNames::pending();
        // Every step initialize would run, in order, as one open set: whatever reads it (the deployment
        // that decides whether a plan is empty) counts kinds it doesn't know too.
        $steps = [];
        // The one-time moves of a site that ran 0.3 (before the rename): identity's names first, as
        // initialize runs them, then the runtime's. `state` is `started` for a run that was interrupted.
        $connection = new Connection($wpdb);
        $names = [];
        if (class_exists(\First\Identity\Legacy\ZeroNames::class)) {
            $names['identity'] = \First\Identity\Legacy\ZeroNames::state($wpdb);
        }
        $names['runtime'] = ZeroNames::state($connection);
        foreach ($names as $which => $state) {
            if ($state === 'pending' || $state === 'started') {
                $steps[] = array_replace(self::step('names', "names:$which"), ['state' => $state]);
            }
        }
        if ($recorded !== self::tablesVersion()) {
            $steps[] = self::step('system-tables', 'system-tables', ['to' => self::tablesVersion()]);
        }
        if ($identity !== null) {
            $steps[] = self::step('identity-schema', 'identity-schema', $identity);
        }
        foreach ($app['migrations'] as $migration) {
            $steps[] = self::step('migration', 'migration:' . $migration['id'], ['sql' => $migration['sql']]);
        }

        return [
            'steps' => [...$steps, ...$install],
            'platform' => $platform,
            'legacyNames' => $legacy,
            'systemTables' => $recorded === self::tablesVersion() ? null : ['from' => $recorded, 'to' => self::tablesVersion(), 'steps' => \First\SystemTables::plan()],
            'identitySchema' => $identity,
            'migrations' => $app['migrations'],
            'install' => $install,
            'runtimeSchema' => $app['runtimeSchema'],
            'refusals' => array_merge(array_map(static fn (string $p): array => ['code' => 'platform', 'message' => $p], $platform), $app['refusals']),
        ];
    }

    public static function activate(): void
    {
        $problems = Platform::problems();
        if ($problems !== []) {
            wp_die(esc_html('First: ' . implode('; ', $problems)), 'First', ['back_link' => true]);
        }
        global $wpdb;
        ZeroNames::upgrade(new Connection($wpdb));
        Migrator::locked(new Connection($wpdb), 'first_runtime_tables', [self::class, 'applySystemTables']);
    }

    /** Shared system tables (jobs, outbox, receipts, …): idempotent DDL, recorded by tablesVersion(). */
    public static function applySystemTables(): void
    {
        global $wpdb;
        $schema = new \First\Schema(['version' => 3, 'runtime' => self::SERIES]);
        \First\SystemTables::apply(CompositeStore::create($schema, new Connection($wpdb)));
        // Features finish their own install here (private files write their deny rules and probe).
        do_action('first_runtime_tables_installed');
        update_option('first_runtime_tables', self::tablesVersion(), false);
    }

    /** `<series>+<fingerprint>`: a runtime that registers another system table or step upgrades sites. */
    public static function tablesVersion(): string
    {
        return self::SERIES . '+' . \First\SystemTables::fingerprint();
    }

    public static function app(string $dir, string $mainFile): ?Plugin
    {
        if (self::$appFile === $mainFile) {
            return self::$plugin;
        }
        try {
            if (self::$plugin !== null) {
                throw new \RuntimeException('only one First app can be active; deactivate the other app first');
            }
            $schema = \First\Schema::load($dir . '/first/app/schema.php');
            $problems = Platform::problems($schema->locales() !== null);
            if ($problems !== []) {
                throw new \RuntimeException(implode('; ', $problems));
            }
            self::$plugin = new Plugin($dir, $mainFile, $schema);
            self::$appFile = $mainFile;
            \First\Extensions::schemaDescribe(static function (array $description): array {
                $description['runtime']['wp'] = Platform::versions();
                $description['runtime']['wp']['hardening'] = Hardening::SWITCHES;
                $description['runtime']['wp']['publicAuthors'] = Authors::public(self::$plugin->schema);
                // The names of what is loaded are for the site's administrators (and `first doctor`
                // signed in as one); anyone else learns only whether the site is sealed.
                $sealed = Sealed::report();
                if ($sealed !== null) {
                    $description['runtime']['wp']['sealed'] = current_user_can('activate_plugins') ? $sealed : ['enforced' => $sealed['enforced']];
                }
                $description['runtime']['wp']['incompatibleTables'] = self::$plugin->storageProblems();
                $description['runtime']['identity'] = self::identity();
                $description['runtime']['version'] = self::VERSION;
                $description['runtime']['pendingMigrations'] = self::$plugin->pendingMigrations();
                $description['runtime']['languages'] = function_exists('pll_languages_list') ? pll_languages_list(['fields' => 'slug']) : [];
                return $description;
            });
            return self::$plugin;
        } catch (\Throwable $error) {
            self::notice($error->getMessage());
            return null;
        }
    }

    /** The runtime plugin's main file (`first-runtime/first-runtime.php`, or the build store's mount). */
    public static function file(): string
    {
        return self::$runtimeFile ?? dirname(__DIR__, 2) . '/first-runtime.php';
    }

    public static function unavailable(): ?string
    {
        return self::$unavailable;
    }

    public static function plugin(): ?Plugin
    {
        return self::$plugin;
    }

    public static function identity(): bool
    {
        return class_exists(\First\Identity\Plugin::class) && defined(\First\Identity\Plugin::class . '::VERSION')
            && constant(\First\Identity\Plugin::class . '::VERSION') === self::VERSION;
    }

    private static function notice(string $problem): void
    {
        add_action('admin_notices', static fn () => printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('First: ' . $problem . '. Rebuild with first ' . self::SERIES . '.x.')));
    }
}
