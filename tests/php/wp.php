<?php

declare(strict_types=1);

/*
 * The fast lane: a real WordPress, on SQLite, in this process.
 *
 * WordPress core, the SQLite Database Integration plugin and the pinned platform plugins are
 * downloaded once (SHA-256 checked) into tests/wp/cache. A suite gets its own site in a temp dir:
 * the runtime plugin assembled from runtime/, the identity plugin, and an app plugin built from a
 * fixture (schema.php, functions.php, a MySQL migration). A child PHP process installs the site and
 * activates the plugins; this process then loads WordPress with everything active, so `init`,
 * `acf/init` and `rest_api_init` fire as they do on a request. Tests drive TypedPress through the same
 * seams the REST route and WP-CLI use: App::handle() as a WordPress user, App::cli(), and the
 * shared `TypedPress\db()`.
 *
 *   $wp = wpSite('db', $fixture);        // $fixture: ['schema' => array, 'functions' => php, 'migration' => sql, ...]
 *   [$status, $data] = $wp->request('GET', '/items', as: 'editor');
 *
 * No Docker, no web server, no MySQL: the SQLite plugin is a supported TypedPress platform (Playground
 * runs on it), and the WordPress suites on MariaDB stay the reference for engine behaviour.
 */

// WordPress plus SCF want more than the CLI default; the suites run with this limit either way.
if ((int) ini_get('memory_limit') !== -1 && (int) ini_get('memory_limit') < 512) {
    ini_set('memory_limit', '512M');
}

const WP_CORE_VERSION = '7.1';
const WP_CORE_SHA256 = 'd1ae02b5ae18428031ffc3943659fa87ab361d827f4aa804adf9276e4dc75df6';
const WP_SQLITE_VERSION = '3.1.2';
const WP_SQLITE_SHA256 = '04c43be5e200a1633499f7577f3fdc25345d389e1a8ffa64dbd6a4eacfbaaaf6';
const WP_CLI_PHAR_VERSION = '2.12.0';
const WP_CLI_PHAR_SHA256 = 'ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c';

final class WpCliHalt extends \RuntimeException
{
    public function __construct(public readonly int $exit)
    {
        parent::__construct("WP_CLI::halt($exit)");
    }
}

final class WpSite
{
    public readonly string $dir;
    public readonly string $content;
    /** @var array<string, int> user name => id */
    private array $users = [];
    /** @var array<string, string> user name => `name:application password` */
    private array $passwords = [];
    private ?\TypedPress\App $app = null;
    /** Set once WordPress is loaded with the app active: the site is a suite's to keep or drop. */
    private bool $loaded = false;
    /** @var resource|null the php -S child that stands in for the web server (private-file probes) */
    private $server = null;
    private bool $serverIsProcessGroup = false;
    private int $port = 0;
    /** The path the site lives under (`/blog` for a subdirectory install), or '' at the server's root. */
    private string $base = '';

    private function __construct(string $dir)
    {
        $this->dir = $dir;
        $this->content = "$dir/content";
    }

    // ================================================================ building the site

    /**
     * @param array{schema: array, functions?: string, migration?: string, identity?: bool, users?: array<string, string>, server?: bool, akismet?: bool, muPlugins?: array<string, string>, plugins?: array<string, array{version: string, sha256: string}>} $fixture
     *   schema: the app's schema.php array (name, collections, ...); functions: PHP after `namespace TypedPressApp;`;
     *   migration: MySQL DDL for the app's `editor: false` tables ({prefix} replaced);
     *   identity: install typedpress-identity too; users: extra WordPress users (name => role);
     *   server: start a php -S that answers the private-files probe (needed for file buckets);
     *   akismet: activate the Akismet core ships (Jetpack's), with no key unless the suite sets one;
     *   plugins: extra pinned WordPress.org plugins, activated before the runtime;
     *   base: a path such as `/blog` the site lives under (WordPress in a subdirectory); the web
     *   server answers only below it.
     */
    public static function create(string $label, array $fixture): self
    {
        $repo = dirname(__DIR__, 2);
        $dir = sys_get_temp_dir() . "/typedpress-wp-$label-" . bin2hex(random_bytes(4));
        $site = new self($dir);
        // Whatever fails below (download, install, activation, boot), the directory and server go.
        register_shutdown_function(static function () use ($site): void {
            if (!$site->loaded && getenv('TP_WP_KEEP') !== '1') {
                $site->destroy();
            }
        });
        foreach (['content/plugins', 'content/mu-plugins', 'content/themes', 'content/database', 'content/uploads'] as $d) {
            mkdir("$dir/$d", 0777, true);
        }
        $core = wpCore();
        $sqlite = wpPlugin('sqlite-database-integration', WP_SQLITE_VERSION, WP_SQLITE_SHA256);
        wpCopy($sqlite, "$dir/content/plugins/sqlite-database-integration");
        file_put_contents("$dir/content/db.php", str_replace(
            ['{SQLITE_IMPLEMENTATION_FOLDER_PATH}', '{SQLITE_PLUGIN}'],
            ["$dir/content/plugins/sqlite-database-integration", 'sqlite-database-integration/load.php'],
            (string) file_get_contents("$sqlite/db.copy"),
        ));
        $activate = [];
        if (isset($fixture['wpContent'])) {
            if (is_dir($fixture['wpContent'] . '/mu-plugins')) {
                foreach (glob($fixture['wpContent'] . '/mu-plugins/*.php') ?: [] as $file) {
                    copy($file, "$dir/content/mu-plugins/" . basename($file));
                }
            }
            // A `typedpress build` artifact: its plugins as built, activated in the manifest's order.
            $manifest = json_decode((string) file_get_contents($fixture['wpContent'] . '/typedpress-manifest.json'), true, 512, JSON_THROW_ON_ERROR);
            foreach (array_keys($manifest['plugins']) as $slug) {
                if (is_dir($fixture['wpContent'] . "/plugins/$slug") && ($slug !== 'typedpress-identity' || ($fixture['identity'] ?? false))) {
                    wpCopy($fixture['wpContent'] . "/plugins/$slug", "$dir/content/plugins/$slug");
                    $activate[] = $slug;
                }
            }
            // Dependencies first, then the runtime, then the app, as an installer would.
            usort($activate, static fn (string $a, string $b): int => (str_starts_with($a, 'typedpress-') ? 1 + (int) str_starts_with($a, 'typedpress-app-') : 0) <=> (str_starts_with($b, 'typedpress-') ? 1 + (int) str_starts_with($b, 'typedpress-app-') : 0));
            $fixture['schema'] = ['name' => $manifest['app'], 'locales' => $manifest['locales'] ?? null];
        } else {
            $platform = json_decode((string) file_get_contents("$repo/tests/fixtures/platform.json"), true, 512, JSON_THROW_ON_ERROR);
            $localized = ($fixture['schema']['locales'] ?? null) !== null;
            foreach ($platform['plugins'] as $slug => $pin) {
                if ($slug === 'polylang' && !$localized) {
                    continue;
                }
                wpCopy(wpPlugin($slug, $pin['version'], $pin['sha256']), "$dir/content/plugins/$slug");
                $activate[] = $slug;
            }
            foreach ($fixture['plugins'] ?? [] as $slug => $pin) {
                wpCopy(wpPlugin($slug, $pin['version'], $pin['sha256']), "$dir/content/plugins/$slug");
                $activate[] = $slug;
            }
            // Not a platform plugin: a site gets Akismet through Jetpack. `akismet: true` activates the copy
            // WordPress core ships, the one a Jetpack setup turns on.
            if ($fixture['akismet'] ?? false) {
                wpCopy("$core/wp-content/plugins/akismet", "$dir/content/plugins/akismet");
                $activate[] = 'akismet';
            }
            $site->runtimePlugin($repo, $fixture);
            $activate[] = 'typedpress-runtime';
            if ($fixture['identity'] ?? false) {
                wpCopy("$repo/runtime/identity", "$dir/content/plugins/typedpress-identity", ['apps', 'composer.json', 'composer.lock']);
                $activate[] = 'typedpress-identity';
            }
            $name = (string) ($fixture['schema']['name'] ?? 'app');
            $site->appPlugin($repo, $name, $fixture);
            $activate[] = "typedpress-app-$name";
        }
        // Test-only must-use plugin: no outgoing mail, isolated public symlink root, and the private-file probe goes to our server.
        $publicRoot = var_export("$dir/public-root", true);
        file_put_contents("$dir/content/mu-plugins/typedpress-tests.php", <<<PHP
            <?php
            add_filter('pre_wp_mail', static fn () => true);
            add_filter('tp_public_root', static fn (): string => $publicRoot);
            add_filter('tp_private_probe_url', static function (string \$url): string {
                \$port = getenv('TP_TEST_SERVER_PORT');
                return \$port ? preg_replace('#^https?://[^/]+#', "http://127.0.0.1:\$port", \$url) : \$url;
            });
            PHP);
        // A suite's own must-use plugins (name => PHP source), loaded before anything else boots.
        foreach ($fixture['muPlugins'] ?? [] as $file => $code) {
            file_put_contents("$dir/content/mu-plugins/$file.php", $code);
        }
        $users = ['editor' => 'editor', 'author' => 'author', 'subscriber' => 'subscriber'] + ($fixture['users'] ?? []);
        // The site's URL is where its php -S would listen, so WordPress never redirects a client elsewhere.
        $site->port = wpFreePort();
        $site->base = rtrim((string) ($fixture['base'] ?? ''), '/');
        file_put_contents("$dir/site.json", json_encode(['core' => $core, 'activate' => $activate, 'users' => $users, 'url' => $site->url(), 'base' => $site->base], JSON_THROW_ON_ERROR));
        if ($fixture['server'] ?? false) {
            $site->startServer();
        }
        // Install and activate in a child, so this process loads WordPress with everything active.
        $out = [];
        exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__FILE__) . ' install ' . escapeshellarg($dir) . ' 2>&1', $out, $code);
        if ($code !== 0) {
            throw new RuntimeException("WordPress install failed:\n" . implode("\n", $out));
        }
        $installed = json_decode((string) end($out), true);
        if (!is_array($installed)) {
            throw new RuntimeException("WordPress install printed no site description:\n" . implode("\n", $out));
        }
        $site->users = $installed['users'];
        $site->passwords = $installed['passwords'];
        $site->load($core, $fixture);
        $site->loaded = true;

        return $site;
    }

    /** typedpress-runtime as `typedpress build` lays it out: runtime/TypedPress under tp/, the plugin templates rendered. */
    private function runtimePlugin(string $repo, array $fixture): void
    {
        $plugin = "$this->content/plugins/typedpress-runtime";
        wpCopy("$repo/runtime/TypedPress", "$plugin/tp");
        foreach (['typedpress-runtime.php' => 'typedpress-runtime.php', 'typedpress-runtime-uninstall.php' => 'uninstall.php'] as $template => $file) {
            file_put_contents("$plugin/$file", wpTemplate("$repo/runtime/wp-plugin/$template", $fixture));
        }
    }

    private function appPlugin(string $repo, string $name, array $fixture): void
    {
        $plugin = "$this->content/plugins/typedpress-app-$name";
        mkdir("$plugin/tp/app/migrations", 0777, true);
        file_put_contents("$plugin/typedpress-app-$name.php", wpTemplate("$repo/runtime/wp-plugin/typedpress-app.php", $fixture));
        file_put_contents("$plugin/uninstall.php", wpTemplate("$repo/runtime/wp-plugin/typedpress-app-uninstall.php", $fixture));
        $this->writeSchema($fixture['schema']);
        $functions = $fixture['functions'] ?? '';
        if (!str_starts_with(ltrim($functions), '<?php')) {
            $functions = "<?php\n\ndeclare(strict_types=1);\n\nnamespace TypedPressApp;\n\n" . $functions;
        }
        file_put_contents("$plugin/tp/app/functions.php", $functions);
        $migration = $fixture['migration'] ?? wpDdl($fixture['schema']);
        if ($migration !== '') {
            $initDir = "$plugin/tp/app/migrations/20261121000000_000000_init";
            mkdir($initDir, 0777, true);
            file_put_contents("$initDir/migration.sql", $migration);
            file_put_contents("$initDir/ops.json", json_encode(['version' => 1, 'id' => '20261121000000_000000_init', 'ops' => []]));
        }
    }

    /** The app's schema.php. Rewriting it after boot models an app update; the next request migrates. */
    public function writeSchema(array $schema): void
    {
        $name = (string) ($schema['name'] ?? 'app');
        $schema += ['version' => 5, 'runtime' => wpConstant(dirname(__DIR__, 2) . '/runtime/TypedPress/Schema.php', 'SERIES'), 'name' => $name, 'site' => ['uidPrefix' => 'zr_'],
            'locales' => null, 'media' => ['sizes' => []], 'files' => [], 'jobs' => [], 'webhooks' => [], 'globals' => [], 'actions' => []];
        $schema['auth'] ??= ['collection' => null, 'guests' => true, 'accessTtl' => 300, 'refreshTtl' => 2592000];
        foreach ($schema['collections'] as $c => &$spec) {
            $spec += ['relations' => [], 'hooks' => [], 'access' => [], 'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true]];
            // Hand-written fixtures are custom tables unless they say they're post-backed.
            $spec['editor'] ??= isset($spec['wp']);
            if ($spec['editor'] && !isset($spec['wp'])) {
                $spec['wp'] = ['postType' => "tp_$c", 'groupKey' => "group_tp_$c", 'metaPrefix' => 'tp_', 'fieldKeyPrefix' => "field_tp_{$c}_"];
            }
            $spec['table'] ??= $spec['editor'] ? null : "tp_$c";
        }
        unset($spec);
        foreach ($schema['globals'] as $g => &$spec) {
            $spec['wp'] ??= ['postId' => "tp_global_$g", 'menuSlug' => "typedpress-global-$g", 'groupKey' => "group_tp_global_$g", 'fieldKeyPrefix' => "field_tp_global_{$g}_", 'optionPrefix' => "tp_global_{$g}_"];
            $spec += ['label' => $g, 'agents' => true, 'access' => ['read' => ['role' => 'anyone'], 'update' => ['role' => 'editor']]];
        }
        unset($spec);
        file_put_contents("$this->content/plugins/typedpress-app-$name/tp/app/schema.php", '<?php return ' . var_export($schema, true) . ';');
    }

    /** The site's URL (WP_HOME); `startServer()` makes it answer. */
    public function url(): string
    {
        return "http://127.0.0.1:$this->port$this->base";
    }

    /**
     * `php -S` on this site with the WP-CLI style router: the web server for probes and clients. The
     * port was free when chosen; another process may have taken it since, so the server must answer
     * for this site (the router's `/__tp_site`) before it counts as started, else another port is tried.
     */
    public function startServer(int $workers = 1): int
    {
        if ($this->server !== null) {
            return $this->port;
        }
        // Start workers in their own process group so stopping the fixture also stops every worker.
        $processGroup = $workers > 1 && function_exists('posix_setsid') && function_exists('pcntl_exec');
        $environment = ['TP_TEST_SITE' => $this->dir];
        $command = [PHP_BINARY];
        if ($processGroup) {
            $command = [PHP_BINARY, '-r', 'posix_setsid() < 0 && exit(1); pcntl_exec(PHP_BINARY, array_slice($argv, 1)); exit(1);', '--'];
            $environment['PHP_CLI_SERVER_WORKERS'] = (string) $workers;
        }
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $port = $this->port;
            putenv("TP_TEST_SERVER_PORT=$port");
            $server = proc_open(
                // A suite that rewrites schema.php (an app update) is served the new file by the next request.
                // macOS counts lock-wait sleeps toward PHP's execution limit; each test client
                // already has its own timeout, and must be allowed to observe the 30s lock timeout.
                [...$command, '-d', 'opcache.revalidate_freq=0', '-d', 'max_execution_time=0', '-S', "127.0.0.1:$port", __DIR__ . '/wp-router.php'],
                [1 => ['file', "$this->dir/server.log", 'a'], 2 => ['file', "$this->dir/server.log", 'a']],
                $pipes,
                $this->dir,
                $environment + array_filter(getenv(), 'is_string'),
            );
            $deadline = microtime(true) + 10;
            while (microtime(true) < $deadline) {
                if (!(proc_get_status($server)['running'] ?? false)) {
                    break; // the port was taken: php -S exited
                }
                $answer = @file_get_contents("http://127.0.0.1:$port/__tp_site", false, stream_context_create(['http' => ['timeout' => 1, 'ignore_errors' => true]]));
                if ($answer === $this->dir) {
                    $this->server = $server;
                    $this->serverIsProcessGroup = $processGroup;

                    return $port;
                }
                if (is_string($answer) && $answer !== '') {
                    break; // someone else answers on this port
                }
                usleep(20_000);
            }
            self::terminateServer($server, $processGroup);
            // Another port: the site's URL moves with it (WP_HOME is defined per process from site.json).
            $this->port = wpFreePort();
            $site = json_decode((string) file_get_contents("$this->dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
            $site['url'] = $this->url();
            file_put_contents("$this->dir/site.json", json_encode($site, JSON_THROW_ON_ERROR));
        }
        throw new RuntimeException("php -S didn't start:\n" . file_get_contents("$this->dir/server.log"));
    }

    private function load(string $core, array $fixture): void
    {
        $site = json_decode((string) file_get_contents("$this->dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
        wpDefine($this->dir, $site['url']);
        $_SERVER['REQUEST_METHOD'] = 'GET';
        require_once ABSPATH . 'wp-settings.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        // The runtime's bootstrap routes errors to the log (right for a site); a test wants them on stderr,
        // and a fatal error as text, not WordPress's "critical error" page.
        ini_set('display_errors', 'stderr');
        add_filter('wp_php_error_message', static fn (string $message, array $error): string => $error['message'] . ' in ' . $error['file'] . ':' . $error['line'], 10, 2);
        // WordPress reports a fatal error through wp_die() with `exit => false`, from inside a
        // shutdown function. Exiting there would skip every shutdown function registered later:
        // the suite's own cleanup, so its php -S child and its site directory would stay behind.
        add_filter('wp_die_handler', static fn () => static function (mixed $message, mixed $title = '', mixed $args = []): void {
            fwrite(STDERR, 'wp_die: ' . (is_string($message) ? $message : json_encode($message)) . "\n");
            if (!is_array($args) || ($args['exit'] ?? true)) {
                exit(255);
            }
        });
        $plugin = \TypedPress\Wp\Runtime::plugin() ?? throw new RuntimeException('the TypedPress app did not boot: ' . $this->debugLog());
        if ($plugin->unavailable() !== null) {
            throw new RuntimeException('TypedPress storage is behind: ' . $plugin->unavailable() . "\n" . $this->debugLog());
        }
        $this->app = $plugin->app();
    }

    public function debugLog(): string
    {
        return is_file("$this->content/debug.log") ? (string) file_get_contents("$this->content/debug.log") : '(no debug.log)';
    }

    /** Stops the php -S child; `startServer()` starts a new one (a new process: no cached code). */
    public function stopServer(): void
    {
        if ($this->server !== null) {
            self::terminateServer($this->server, $this->serverIsProcessGroup);
            $this->server = null;
        }
    }

    /** @param resource $server */
    private static function terminateServer($server, bool $processGroup): void
    {
        if (!$processGroup || !posix_kill(-proc_get_status($server)['pid'], SIGTERM)) {
            proc_terminate($server);
        }
        proc_close($server);
    }

    public function destroy(): void
    {
        $this->stopServer();
        if (is_dir($this->dir)) {
            exec('rm -rf ' . escapeshellarg($this->dir));
        }
        clearstatcache(true, $this->dir);
    }

    // ================================================================ driving the app

    public function app(): \TypedPress\App
    {
        return $this->app ?? throw new LogicException('site not loaded');
    }

    public function plugin(): \TypedPress\Wp\Plugin
    {
        return \TypedPress\Wp\Runtime::plugin() ?? throw new LogicException('no TypedPress app');
    }

    public function connection(): \TypedPress\Wp\Connection
    {
        return $this->plugin()->connection();
    }

    /** The WordPress user id behind a test user name (admin plus the fixture's users). */
    public function userId(string $name): int
    {
        return $this->users[$name] ?? throw new LogicException("no test user '$name'");
    }

    /** `name:application password` for a test user: the Basic credential WordPress accepts over HTTP. */
    public function appPassword(string $name): string
    {
        return $this->passwords[$name] ?? throw new LogicException("no application password for '$name'");
    }

    /** @return array<string, array{id: int, appPassword: string}> every test user's id and credential */
    public function credentials(): array
    {
        $out = [];
        foreach ($this->users as $name => $id) {
            $out[$name] = ['id' => $id, 'appPassword' => $this->passwords[$name]];
        }

        return $out;
    }

    /** The php -S child's process id, or null when no server runs. */
    public function serverPid(): ?int
    {
        return $this->server === null ? null : (proc_get_status($this->server)['pid'] ?? null);
    }

    /** Whether the php -S child is still running. */
    public function serving(): bool
    {
        return $this->server !== null && (proc_get_status($this->server)['running'] ?? false);
    }

    /** A new WordPress user; the role is one of TypedPress's (admin, editor, author, subscriber). */
    public function addUser(string $name, string $role, string $password = 'typedpress-test-pass'): int
    {
        $id = wp_insert_user(['user_login' => $name, 'user_pass' => $password, 'user_email' => "$name@example.test", 'display_name' => $name,
            'role' => $role === 'admin' ? 'administrator' : $role]);
        if ($id instanceof WP_Error) {
            throw new RuntimeException($id->get_error_message());
        }

        return $this->users[$name] = (int) $id;
    }

    /** TypedPress's user array for a test user, as hooks and rules see it. */
    public function user(string $name): array
    {
        return \TypedPress\Wp\WpAuth::map(get_userdata($this->userId($name)));
    }

    /** Make $who the current WordPress user (a test user name or a user id; null: anonymous), as the REST authentication would. */
    public function actAs(string|int|null $who): void
    {
        wp_set_current_user($who === null ? 0 : (is_int($who) ? $who : $this->userId($who)));
    }

    /**
     * One API request through the seam the REST route uses, as $as (a test user name, null anonymous).
     *
     * @return array{int, mixed, array<string, string>, string|\Closure} status, data or problem, headers, raw body
     */
    public function call(string $method, string $path, mixed $body = null, string|int|null $as = null, array $query = [], array $files = [], array $form = [], array $headers = []): array
    {
        $this->actAs($as);
        try {
            [$status, $out, $payload] = $this->app()->handle($method, $path, $query, is_string($body) ? $body : ($body === null ? '' : json_encode($body)), $headers, $files, $form);
        } finally {
            wp_set_current_user(0);
        }
        $json = is_string($payload) && $payload !== '' ? json_decode($payload, true) : null;

        return [$status, $status < 300 ? ($json['data'] ?? null) : $json, array_change_key_case($out, CASE_LOWER), $payload];
    }

    /**
     * App::handle as $as, with the raw result: [status, response headers as sent, payload]. For checks
     * on header names and bodies; `call()` decodes for everything else.
     *
     * @return array{int, array<string, string>, string|\Closure}
     */
    public function handle(string $method, string $path, string $body = '', string|int|null $as = null, array $headers = [], array $query = []): array
    {
        $this->actAs($as);
        try {
            return $this->app()->handle($method, $path, $query, $body, $headers);
        } finally {
            wp_set_current_user(0);
        }
    }

    /**
     * The `serveRoute` match for a `tp/app/` HTTP handler, as the app router finds it: the
     * route whose pattern takes `$path`, that file's `$method` handler, and its access rule.
     *
     * @return array{name: string, params: array<string, string>, route: array<string, mixed>}
     */
    public function route(string $method, string $path): array
    {
        $app = $this->plugin()->schema->app();
        $match = \TypedPress\Wp\AppRouter::match($app['routes'], $path) ?? throw new \RuntimeException("no route takes $path");
        $file = $app['files'][$match['route']['handler'] ?? $match['route']['page']];
        return [
            'name' => (string) $match['route']['id'],
            'params' => array_map(static fn ($v) => is_array($v) ? implode('/', $v) : $v, $match['params']),
            'route' => ['handler' => $file['methods'][$method] ?? throw new \RuntimeException("$path has no $method"), 'access' => $file['handlerGuard'] ?? ['allow' => false], 'signature' => $file['signature'] ?? null],
        ];
    }

    /** Where an upload URL of this site lives on disk. */
    public function uploadPath(string $url): string
    {
        return $this->uploads() . substr((string) parse_url($url, PHP_URL_PATH), strlen('/wp-content/uploads'));
    }

    /** `wp typedpress <args>` as the trusted CLI runs it: [exit code, decoded JSON]. */
    public function cli(string ...$args): array
    {
        [$code, $out] = $this->app()->cli($args);

        return [$code, json_decode($out, true)];
    }

    /**
     * `wp typedpress <args>` through the plugin's WP-CLI command (migrate included), with a WP_CLI stand-in
     * that records the output: [exit code, decoded JSON].
     */
    public function wpCli(array $args, array $assoc = []): array
    {
        if (!class_exists('WP_CLI')) {
            eval('final class WP_CLI { public static array $lines = []; public static function line(string $s): void { self::$lines[] = $s; } public static function halt(int $c): never { throw new WpCliHalt($c); } }');
        }
        \WP_CLI::$lines = [];
        try {
            $this->plugin()->cli($args, $assoc);
            $code = 0;
        } catch (WpCliHalt $halt) {
            $code = $halt->exit;
        }

        return [$code, json_decode(implode("\n", \WP_CLI::$lines), true)];
    }

    /** Rows of one SQL statement on the site's connection; `{prefix}` is the table prefix. */
    public function sql(string $sql, array $params = []): array
    {
        return $this->connection()->run(str_replace('{prefix}', $this->connection()->prefix(), $sql), $params);
    }

    public function scalar(string $sql, array $params = []): mixed
    {
        $row = $this->sql($sql, $params)[0] ?? [];

        return $row === [] ? null : reset($row);
    }

    public function exec(string $sql, array $params = []): void
    {
        $this->sql($sql, $params);
    }

    /** The site's upload directory (media and private files land here). */
    public function uploads(): string
    {
        return "$this->content/uploads";
    }
}

// ================================================================ helpers

function wpSite(string $label, array $fixture): WpSite
{
    $site = WpSite::create($label, $fixture);
    register_shutdown_function(static function () use ($site): void {
        // A failing suite shows WordPress's log (minus core's early-theme notices); TP_WP_KEEP=1 keeps the site.
        if (($GLOBALS['failed'] ?? 0) > 0 || getenv('TP_WP_KEEP') === '1') {
            $log = array_filter(explode("\n", $site->debugLog()), static fn (string $l) => $l !== '' && !str_contains($l, 'wp_is_block_theme'));
            fwrite(STDERR, "--- {$site->dir}/content/debug.log\n" . implode("\n", $log) . "\n");
        }
        if (getenv('TP_WP_KEEP') === '1') {
            fwrite(STDERR, "site kept at {$site->dir}\n");
            return;
        }
        $site->destroy();
    });

    return $site;
}

/**
 * The MySQL migration `typedpress build` would emit for a hand-written schema's custom tables (the type map
 * of src/migrate.rs): every `editor: false` collection, its unique keys and foreign keys between
 * custom tables, plus the shared revisions table when one of them keeps revisions.
 */
function wpDdl(array $schema): string
{
    $collections = $schema['collections'] ?? [];
    // Custom tables: not post-backed, and not the auth collection (its rows are WordPress users).
    $tables = [];
    foreach ($collections as $name => $spec) {
        if (!($spec['editor'] ?? isset($spec['wp'])) && !($spec['auth'] ?? false) && ($schema['auth']['collection'] ?? null) !== $name) {
            $tables[$name] = $spec['table'] ?? "tp_$name";
        }
    }
    $autoPk = static fn (string $c) => (bool) ($collections[$c]['columns'][$collections[$c]['primaryKey'] ?? 'id']['autoIncrement'] ?? false);
    $statements = [];
    $joins = [];
    $revisions = false;
    foreach ($tables as $name => $table) {
        $spec = $collections[$name];
        $revisions = $revisions || ($spec['revisions'] ?? false);
        $lines = [];
        $keys = [];
        $fks = [];
        foreach ($spec['columns'] as $col => $def) {
            if ($def['derived'] ?? false) {
                continue;
            }
            if (($def['type'] ?? null) === 'refList') {
                // A many-ref's links live in its join table, with cascading keys between two custom tables.
                $join = $def['references']['join'];
                $fk = static fn (string $side, string $c) => isset($tables[$c]) && isset($tables[$def['references']['collection']])
                    ? ",\n\tCONSTRAINT `tp_{$join}_{$side}_fk` FOREIGN KEY (`$side`) REFERENCES `{prefix}{$tables[$c]}` (`id`) ON DELETE CASCADE" : '';
                $joins[] = "CREATE TABLE `{prefix}tp__join_$join` (\n\t`owner_id` BIGINT UNSIGNED NOT NULL,\n\t`target_id` BIGINT UNSIGNED NOT NULL,\n\t`position` BIGINT NOT NULL,"
                    . "\n\tPRIMARY KEY (`owner_id`, `target_id`),\n\tKEY `target_id` (`target_id`)" . $fk('owner_id', $name) . $fk('target_id', $def['references']['collection']) . "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
                continue;
            }
            $type = $def['type'] ?? 'text';
            $pk = $def['primaryKey'] ?? false;
            $auto = $def['autoIncrement'] ?? false;
            $ref = $def['references'] ?? null;
            $unsignedRef = $ref !== null && $autoPk($ref['collection']) && isset($tables[$ref['collection']]);
            $max = $def['rules']['max'] ?? $def['max'] ?? null;
            $sql = match (true) {
                in_array($type, ['integer', 'media', 'file'], true) && (($pk && $auto) || $unsignedRef) => 'BIGINT UNSIGNED',
                in_array($type, ['integer', 'media', 'file'], true) => 'BIGINT',
                $type === 'real' => 'DOUBLE',
                $type === 'boolean' => 'TINYINT(1)',
                $type === 'timestamp' => 'CHAR(24)',
                $type === 'date' => 'CHAR(10)',
                $type === 'slug' => 'VARCHAR(' . min((int) ($max ?? 200), 200) . ')',
                $pk && $type === 'text' => 'VARCHAR(191)',
                $col === 'translationGroup' => 'VARCHAR(36)',
                in_array($type, ['text', 'email', 'url'], true) && (($def['unique'] ?? false) || ($max !== null && $max <= 191)) => 'VARCHAR(' . ($max ?? 191) . ')',
                $type === 'text' && isset($def['enum']) => 'VARCHAR(191)',
                default => 'LONGTEXT',
            };
            $line = "`$col` $sql";
            if ($pk) {
                $line .= $auto ? ' NOT NULL AUTO_INCREMENT' : ' NOT NULL';
            }
            if (isset($def['default']['value'])) {
                $v = $def['default']['value'];
                $literal = match (true) {
                    $type === 'boolean' => $v ? '1' : '0',
                    is_int($v) || is_float($v) => (string) $v,
                    is_string($v) => "'" . str_replace("'", "''", $v) . "'",
                    default => "'" . str_replace("'", "''", (string) json_encode($v)) . "'",
                };
                $line .= $sql === 'LONGTEXT' ? " DEFAULT ($literal)" : " DEFAULT $literal";
            }
            if (($def['notNull'] ?? false) && !$pk) {
                $line .= ' NOT NULL';
            }
            $lines[] = $line;
            if (($def['unique'] ?? false) && !$pk) {
                $keys[] = "UNIQUE KEY `{$col}_unique` (`$col`)";
            }
            if ($ref !== null && isset($tables[$ref['collection']])) {
                $fk = "CONSTRAINT `tp_{$name}_{$col}_fk` FOREIGN KEY (`$col`) REFERENCES `{prefix}{$tables[$ref['collection']]}` (`{$ref['column']}`)";
                if (isset($ref['onDelete'])) {
                    $fk .= ' ON DELETE ' . strtoupper($ref['onDelete']);
                }
                $fks[] = $fk;
            }
        }
        if ($spec['localized'] ?? false) {
            $keys[] = 'UNIQUE KEY `translationGroup_locale` (`translationGroup`, `locale`)';
        }
        $lines[] = 'PRIMARY KEY (`' . ($spec['primaryKey'] ?? 'id') . '`)';
        $statements[] = "CREATE TABLE `{prefix}$table` (\n\t" . implode(",\n\t", [...$lines, ...$keys, ...$fks]) . "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    }
    // Post-backed owners' many-refs too: the join table is TypedPress's own whatever stores the sides.
    foreach ($collections as $name => $spec) {
        if (isset($tables[$name])) {
            continue;
        }
        foreach ($spec['columns'] ?? [] as $def) {
            // A `terms` field's links are core's term relationships (`term:<taxonomy>`): no table.
            if (($def['type'] ?? null) === 'refList' && !str_starts_with($def['references']['join'], 'term:')) {
                $join = $def['references']['join'];
                $joins[] = "CREATE TABLE `{prefix}tp__join_$join` (\n\t`owner_id` BIGINT UNSIGNED NOT NULL,\n\t`target_id` BIGINT UNSIGNED NOT NULL,\n\t`position` BIGINT NOT NULL,"
                    . "\n\tPRIMARY KEY (`owner_id`, `target_id`),\n\tKEY `target_id` (`target_id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
            }
        }
    }
    array_push($statements, ...$joins);
    if ($revisions) {
        $statements[] = "CREATE TABLE `{prefix}tp__revisions` (\n\t`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n\t`collection` VARCHAR(64) NOT NULL,\n\t`pk` VARCHAR(191) NOT NULL,"
            . "\n\t`version` BIGINT UNSIGNED NOT NULL DEFAULT 1,\n\t`op` VARCHAR(16) NOT NULL DEFAULT 'update',"
            . "\n\t`at` CHAR(24) NOT NULL,\n\t`userId` BIGINT UNSIGNED NULL,\n\t`schemaMigration` VARCHAR(191) NULL,"
            . "\n\t`row` LONGTEXT NOT NULL,\n\t`changed` LONGTEXT NULL,\n\tPRIMARY KEY (`id`),\n\tKEY `row` (`collection`, `pk`),\n\tUNIQUE KEY `row_version` (`collection`, `pk`, `version`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
    }

    return implode("\n--> statement-breakpoint\n", $statements) . ($statements === [] ? '' : "\n");
}

/** A free TCP port on the loopback interface. */
function wpFreePort(): int
{
    $listener = stream_socket_server('tcp://127.0.0.1:0') ?: throw new RuntimeException('cannot bind a loopback port');
    $port = (int) substr(strrchr((string) stream_socket_get_name($listener, false), ':'), 1);
    fclose($listener);

    return $port;
}

function wpCache(): string
{
    $cache = getenv('TP_WP_CACHE') ?: dirname(__DIR__) . '/wp/cache';
    if (!is_dir($cache) && !mkdir($cache, 0777, true) && !is_dir($cache)) {
        throw new RuntimeException("cannot create $cache");
    }

    return $cache;
}

/** A verified download, extracted once: the directory inside the ZIP. */
function wpArchive(string $file, string $url, string $sha256, string $root): string
{
    $cache = wpCache();
    $zip = "$cache/$file";
    $dir = "$cache/" . substr($file, 0, -4);
    if (is_dir($dir)) {
        return "$dir/$root";
    }
    if (!is_file($zip)) {
        // Download under a private name, publish by rename: a concurrent suite never sees a partial ZIP.
        $tmp = "$zip." . getmypid();
        $ch = curl_init($url);
        $fh = fopen($tmp, 'wb') ?: throw new RuntimeException("cannot write $tmp");
        curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_FAILONERROR => true, CURLOPT_TIMEOUT => 600]);
        $ok = curl_exec($ch);
        fclose($fh);
        if ($ok !== true) {
            @unlink($tmp);
            throw new RuntimeException("download of $url failed: " . curl_error($ch));
        }
        if (hash_file('sha256', $tmp) !== $sha256) {
            @unlink($tmp);
            throw new RuntimeException("$url does not match its pinned SHA-256");
        }
        rename($tmp, $zip);
    }
    if (hash_file('sha256', $zip) !== $sha256) {
        throw new RuntimeException("$zip does not match its pinned SHA-256; delete it");
    }
    $tmp = "$dir." . getmypid();
    $archive = new ZipArchive();
    if ($archive->open($zip) !== true || !$archive->extractTo($tmp)) {
        throw new RuntimeException("cannot extract $zip");
    }
    $archive->close();
    if (!@rename($tmp, $dir)) {
        exec('rm -rf ' . escapeshellarg($tmp)); // another suite extracted it first
    }

    return "$dir/$root";
}

/** The pinned WP-CLI phar, downloaded once into the cache. */
function wpCliPhar(): string
{
    $phar = wpCache() . '/wp-cli-' . WP_CLI_PHAR_VERSION . '.phar';
    if (!is_file($phar) || hash_file('sha256', $phar) !== WP_CLI_PHAR_SHA256) {
        $tmp = "$phar." . getmypid();
        $ch = curl_init('https://github.com/wp-cli/wp-cli/releases/download/v' . WP_CLI_PHAR_VERSION . '/wp-cli-' . WP_CLI_PHAR_VERSION . '.phar');
        $fh = fopen($tmp, 'wb') ?: throw new RuntimeException("cannot write $tmp");
        curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_FAILONERROR => true, CURLOPT_TIMEOUT => 600]);
        $ok = curl_exec($ch);
        fclose($fh);
        if ($ok !== true || hash_file('sha256', $tmp) !== WP_CLI_PHAR_SHA256) {
            @unlink($tmp);
            throw new RuntimeException('WP-CLI ' . WP_CLI_PHAR_VERSION . ' download failed or does not match its pinned SHA-256');
        }
        rename($tmp, $phar);
    }

    return $phar;
}

/**
 * A directory WP-CLI can boot this site from (`wp --path=<dir>`): core linked in, plus a
 * wp-config.php that defines the site as wpDefine() does.
 */
function wpCliRoot(string $dir): string
{
    $site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
    $root = "$dir/wp-cli-root";
    if (!is_dir($root)) {
        // Built aside and moved in, so a concurrent request (the test server's) never sees half of it.
        $final = $root;
        $root = "$final." . getmypid() . '.' . bin2hex(random_bytes(4));
        mkdir($root);
        foreach (scandir($site['core']) as $entry) {
            if ($entry !== '.' && $entry !== '..' && $entry !== 'wp-config.php' && $entry !== 'wp-content') {
                symlink($site['core'] . "/$entry", "$root/$entry");
            }
        }
        file_put_contents("$root/wp-config.php", '<?php' . "\n"
            . 'require_once ' . var_export(__FILE__, true) . ";\n"
            . 'wpDefine(' . var_export($dir, true) . ', ' . var_export($site['url'], true) . ");\n"
            . "require_once ABSPATH . 'wp-settings.php';\n");
        if (!@rename($root, $final)) {
            array_map('unlink', glob("$root/*"));
            rmdir($root);
            if (!is_dir($final)) {
                throw new RuntimeException("could not create $final");
            }
        }
        $root = $final;
    }

    return $root;
}

function wpCore(): string
{
    // The WordPress-ahead workflow (.github/workflows/wordpress-ahead.yml) boots a WordPress build other than the pinned one: a ZIP in the cache
    // it downloaded itself (`TP_WP_CORE_ZIP`, with its SHA-256 in `TP_WP_CORE_SHA256`).
    $other = getenv('TP_WP_CORE_ZIP');
    if (is_string($other) && $other !== '') {
        return wpArchive($other, 'file://' . wpCache() . "/$other", (string) getenv('TP_WP_CORE_SHA256'), 'wordpress');
    }

    return wpArchive('wordpress-' . WP_CORE_VERSION . '.zip', 'https://wordpress.org/wordpress-' . WP_CORE_VERSION . '.zip', WP_CORE_SHA256, 'wordpress');
}

/**
 * Only the pinned core's HTML API and the formatting functions it calls, without a site or database:
 * for suites that exercise the bundled toolkit on core's classes and need nothing else of WordPress.
 */
function wpCoreHtmlApi(): void
{
    $core = wpCore();
    defined('ABSPATH') || define('ABSPATH', "$core/");
    defined('WPINC') || define('WPINC', 'wp-includes');
    foreach (['load', 'plugin', 'compat', 'compat-utf8', 'utf8', 'functions', 'l10n', 'formatting', 'kses', 'class-wp-token-map'] as $file) {
        require_once "$core/wp-includes/$file.php";
    }
    foreach (['html5-named-character-references', 'class-wp-html-attribute-token', 'class-wp-html-span', 'class-wp-html-doctype-info',
        'class-wp-html-text-replacement', 'class-wp-html-decoder', 'class-wp-html-tag-processor', 'class-wp-html-unsupported-exception',
        'class-wp-html-active-formatting-elements', 'class-wp-html-open-elements', 'class-wp-html-token', 'class-wp-html-stack-event',
        'class-wp-html-processor-state', 'class-wp-html-processor'] as $file) {
        require_once "$core/wp-includes/html-api/$file.php";
    }
    add_filter('pre_option_blog_charset', static fn (): string => 'UTF-8');
}

function wpPlugin(string $slug, string $version, string $sha256): string
{
    return wpArchive("$slug.$version.zip", "https://downloads.wordpress.org/plugin/$slug.$version.zip", $sha256, $slug);
}

/** Copy a tree (the app's plugins are copies, never symlinks: WordPress resolves plugin paths). */
function wpCopy(string $from, string $to, array $skip = []): void
{
    mkdir($to, 0777, true);
    $it = new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($from, FilesystemIterator::SKIP_DOTS),
        static fn (SplFileInfo $f): bool => !in_array($f->getFilename(), $skip, true),
    ), RecursiveIteratorIterator::SELF_FIRST);
    foreach ($it as $file) {
        $dest = $to . '/' . substr($file->getPathname(), strlen($from) + 1);
        $file->isDir() ? @mkdir($dest, 0777, true) : copy($file->getPathname(), $dest);
    }
}

/** A plugin template rendered as `typedpress build` renders it (`{{key}}` placeholders). */
function wpTemplate(string $file, array $fixture): string
{
    $repo = dirname(__DIR__, 2);
    $name = (string) ($fixture['schema']['name'] ?? 'app');
    $platform = json_decode((string) file_get_contents("$repo/tests/fixtures/platform.json"), true, 512, JSON_THROW_ON_ERROR);
    $localized = ($fixture['schema']['locales'] ?? null) !== null;
    $runtimeRequires = array_keys(array_filter($platform['plugins'], static fn (string $slug): bool => $slug !== 'polylang', ARRAY_FILTER_USE_KEY));
    $requires = implode(', ', [...$runtimeRequires, ...($localized ? ['polylang'] : []), 'typedpress-runtime']);
    $vars = ['name' => $name, 'slug' => "typedpress-app-$name", 'label' => ucfirst($name), 'Name' => ucfirst($name), 'requires' => $requires, 'runtimeRequires' => implode(', ', $runtimeRequires),
        'wpVersion' => $platform['wordpress'], 'phpVersion' => $platform['php'], 'runtimeSeries' => wpConstant("$repo/runtime/TypedPress/Schema.php", 'SERIES'),
        'tpVersion' => wpConstant("$repo/runtime/TypedPress/Wp/Runtime.php", 'VERSION'), 'version' => wpConstant("$repo/runtime/TypedPress/Wp/Runtime.php", 'VERSION'),
        'schemaHash' => substr(hash('sha256', json_encode($fixture['schema'])), 0, 16), 'runtimeHash' => 'tests'];
    $out = (string) file_get_contents($file);
    foreach ($vars as $k => $v) {
        $out = str_replace('{{' . $k . '}}', (string) $v, $out);
    }

    return $out;
}

/** A string class constant read from source: the runtime isn't loaded until WordPress loads the plugin. */
function wpConstant(string $file, string $name): string
{
    if (preg_match('/const ' . $name . " = '([^']*)';/", (string) file_get_contents($file), $m) !== 1) {
        throw new RuntimeException("no $name constant in $file");
    }

    return $m[1];
}

/** Load an existing site (made by WpSite::create) into this process, with everything active. */
function wpLoad(string $dir): void
{
    $site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
    wpDefine($dir, $site['url']);
    require_once ABSPATH . 'wp-settings.php';
}

/** The constants a wp-config.php would define, for a site directory. */
function wpDefine(string $dir, string $url): void
{
    $site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
    defined('ABSPATH') || define('ABSPATH', $site['core'] . '/'); // WP-CLI defines it from --path
    define('WP_CONTENT_DIR', "$dir/content");
    define('WP_CONTENT_URL', "$url/wp-content");
    define('WP_PLUGIN_DIR', "$dir/content/plugins");
    define('WP_PLUGIN_URL', "$url/wp-content/plugins");
    define('DB_PATH', "$dir/content/database/wp.sqlite");
    foreach (['DB_NAME' => 'wordpress', 'DB_USER' => '', 'DB_PASSWORD' => '', 'DB_HOST' => '', 'DB_CHARSET' => 'utf8mb4', 'DB_COLLATE' => ''] as $k => $v) {
        define($k, $v);
    }
    foreach (['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'] as $k) {
        define($k, "typedpress-test-$k");
    }
    $GLOBALS['table_prefix'] = 'wp_';
    define('WP_DEBUG', true);
    define('WP_DEBUG_DISPLAY', false);
    define('WP_DEBUG_LOG', "$dir/content/debug.log");
    // The front end (template_redirect, the theme) runs only for suites that serve pages.
    define('WP_USE_THEMES', getenv('TP_WP_THEMES') === '1');
    // The unminified Interactivity runtime, which is the only build that logs hydration warnings.
    define('SCRIPT_DEBUG', getenv('TP_WP_SCRIPT_DEBUG') === '1');
    define('WP_SITEURL', $url);
    define('WP_HOME', $url);
    define('DISABLE_WP_CRON', true);
    define('WP_ENVIRONMENT_TYPE', 'local');
    $host = (string) parse_url($url, PHP_URL_HOST) . ':' . (string) parse_url($url, PHP_URL_PORT);
    $_SERVER += ['HTTP_HOST' => $host, 'SERVER_NAME' => (string) parse_url($url, PHP_URL_HOST), 'REQUEST_URI' => '/', 'SERVER_PROTOCOL' => 'HTTP/1.1', 'REQUEST_METHOD' => 'GET'];
}

// ================================================================ the install child

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__ && ($argv[1] ?? '') === 'install') {
    $dir = $argv[2];
    $site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
    wpDefine($dir, $site['url']);
    define('WP_INSTALLING', true);
    require_once ABSPATH . 'wp-settings.php';
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $installed = wp_install('TypedPress test site', 'admin', 'admin@example.test', true, '', 'typedpress-test-admin');
    // Pretty permalinks, so rest_url() is /wp-json/… (what the router serves) rather than ?rest_route=.
    update_option('permalink_structure', '/%postname%/');
    $users = ['admin' => (int) $installed['user_id']];
    foreach ($site['users'] as $name => $role) {
        $id = wp_insert_user(['user_login' => $name, 'user_pass' => "typedpress-test-$name", 'user_email' => "$name@example.test", 'display_name' => $name,
            'role' => $role === 'admin' ? 'administrator' : $role]);
        if ($id instanceof WP_Error) {
            fwrite(STDERR, $id->get_error_message() . "\n");
            exit(1);
        }
        $users[$name] = (int) $id;
    }
    // One application password per user, for clients over HTTP (WordPress's own Basic auth channel).
    $passwords = [];
    foreach ($users as $name => $id) {
        [$password] = WP_Application_Passwords::create_new_application_password($id, ['name' => 'first tests']);
        $passwords[$name] = "$name:$password";
    }
    foreach ($site['activate'] as $slug) {
        $main = $slug === 'sqlite-database-integration' ? 'load.php' : "$slug.php";
        $error = activate_plugin("$slug/$main", '', false, $slug !== 'woocommerce');
        if ($error instanceof WP_Error) {
            fwrite(STDERR, "activating $slug: " . $error->get_error_message() . "\n");
            exit(1);
        }
    }
    echo json_encode(['users' => $users, 'passwords' => $passwords]), "\n";
    exit(0);
}

// ================================================================ eval: run PHP on a site built from an artifact
//
//   php tests/php/wp.php eval <wp-content dir> <php code> [json argument] [name=role ...]
//
// Installs a site from a `typedpress build` artifact, loads it with the app active, and runs
// the code with `$app` (the TypedPress\App), `$wp` (the WpSite), `$arg` (the decoded JSON argument) and
// `$site` bound; the site goes when the process ends. For Rust tests that drive compiled PHP.

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__ && ($argv[1] ?? '') === 'eval') {
    $users = [];
    foreach (array_slice($argv, 5) as $pair) {
        [$name, $role] = explode('=', $pair, 2);
        $users[$name] = $role;
    }
    $site = wpSite('eval', ['wpContent' => $argv[2], 'users' => $users]);
    $wp = $site;
    $app = $site->app();
    $arg = isset($argv[4]) && $argv[4] !== '' ? json_decode($argv[4], true, 512, JSON_THROW_ON_ERROR) : null;
    eval($argv[3]);
    exit(0);
}

// ================================================================ serve: a site for another process
//
//   php tests/php/wp.php serve <wp-content dir> [name=role ...]
//
// Installs a site from a `typedpress build` artifact, starts its web server, prints one JSON
// line ({url, dir, users: {name: {id, appPassword}}}) and serves until killed (tests/sync.rs).
// TP_WP_IDENTITY=1 activates typedpress-identity too; TP_WP_CLI=1 adds {wpCli: {phar, path}} (tests/cli.rs).

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__ && ($argv[1] ?? '') === 'serve') {
    $users = [];
    foreach (array_slice($argv, 3) as $pair) {
        [$name, $role] = explode('=', $pair, 2);
        $users[$name] = $role;
    }
    $site = WpSite::create('serve', ['wpContent' => $argv[2], 'users' => $users, 'server' => true, 'identity' => getenv('TP_WP_IDENTITY') === '1']);
    $out = ['url' => $site->url(), 'dir' => $site->dir, 'users' => $site->credentials()];
    // TP_WP_CLI=1: also the pinned WP-CLI phar and a --path it can boot this site from.
    if (getenv('TP_WP_CLI') === '1') {
        $out['wpCli'] = ['phar' => wpCliPhar(), 'path' => wpCliRoot($site->dir)];
    }
    echo json_encode($out), "\n";
    fclose(STDOUT);
    pcntl_signal(SIGTERM, static function () use ($site): void {
        $site->destroy();
        exit(0);
    });
    while (true) {
        pcntl_signal_dispatch();
        if (!$site->serving()) {
            $site->destroy();
            exit(1);
        }
        usleep(100_000);
    }
}
