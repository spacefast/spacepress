<?php
declare(strict_types=1);

namespace FirstPlugin;

/**
 * The deploy receiver `first push` talks to, under /wp-json/first-deploy/v1. Callers sign in the way
 * core accepts for REST (an application password from `first login`).
 *
 *   GET  /site                              what this site is and runs
 *   GET  /builds/<build>/baseline           the live build's schema snapshot and migrations
 *   POST /requirements                      install the pinned plugins the site lacks
 *   POST /plugin                            replace this plugin with the one the command line carries
 *   POST /deployments                       register a build; says which trees to upload
 *   POST /deployments/<id>/trees/<kind>     one part of a tree's ZIP
 *   GET  /deployments/<id>/plan             what making it live would install (mounted to inspect)
 *   POST /deployments/<id>/activate         install it and make it live
 *   POST /live                              make an earlier, initialized build live again
 */
final class Receiver
{
    private const PART = 1048576;

    public static function register(): void
    {
        // Core accepts an application password only on a request it already knows is REST. A plugin that
        // asks for the current user earlier would otherwise leave the deploy routes signed out.
        add_filter('application_password_is_api_request', static function (bool $api): bool {
            $route = is_string($_GET['rest_route'] ?? null) ? $_GET['rest_route'] : (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);

            return $api || str_contains($route, '/' . Site::REST . '/');
        });
        add_action('rest_api_init', static function (): void {
            $read = static fn (): bool|\WP_Error => self::allowed(false);
            $write = static fn (): bool|\WP_Error => self::allowed(true);
            $route = static function (string $path, string $method, callable $handler, callable $permission): void {
                register_rest_route(Site::REST, $path, ['methods' => $method, 'permission_callback' => $permission,
                    'callback' => static function (\WP_REST_Request $request) use ($handler) {
                        try {
                            return rest_ensure_response($handler($request));
                        } catch (Refusal $refusal) {
                            return new \WP_Error($refusal->problem, $refusal->getMessage(), ['status' => $refusal->status] + $refusal->detail);
                        } catch (\Throwable $error) {
                            return new \WP_Error('first_failed', $error->getMessage(), ['status' => 500]);
                        }
                    }]);
            };
            $build = '(?P<build>[0-9a-f]{64})';
            $id = '(?P<id>[0-9a-f]{32})';
            $route('/site', 'GET', [self::class, 'site'], $read);
            $route("/builds/$build/baseline", 'GET', [self::class, 'baseline'], $read);
            $route('/requirements', 'POST', [self::class, 'requirements'], $write);
            $route('/plugin', 'POST', [self::class, 'plugin'], $write);
            $route('/deployments', 'POST', [self::class, 'create'], $write);
            $route("/deployments/$id/trees/(?P<kind>runtime|app)", 'POST', [self::class, 'part'], $write);
            $route("/deployments/$id/plan", 'GET', [self::class, 'plan'], $write);
            $route("/deployments/$id/activate", 'POST', [self::class, 'activate'], $write);
            $route('/live', 'POST', [self::class, 'live'], $write);
        });
    }

    private static function allowed(bool $writes): bool|\WP_Error
    {
        if (!Site::mayDeploy()) {
            return new \WP_Error('first_forbidden', is_user_logged_in()
                ? 'Deploying a First app needs an administrator' . (is_multisite() ? ' of the network' : '') . '.'
                : 'Sign in with an application password (first login).', ['status' => rest_authorization_required_code()]);
        }
        // A credential First scoped for an agent (`wp first identity agent add`) is narrower than its
        // user on purpose. Deploying installs code, which would be a way out of any scope.
        $uuid = function_exists('rest_get_authenticated_app_password') ? rest_get_authenticated_app_password() : null;
        if (is_string($uuid)) {
            $password = \WP_Application_Passwords::get_user_application_password(get_current_user_id(), $uuid);
            if (is_array($password) && array_key_exists('first_scope', $password)) {
                return new \WP_Error('first_forbidden', 'This application password is scoped for an agent and cannot deploy. Sign in with first login.', ['status' => 403]);
            }
        }
        if ($writes && Site::closed() !== null) {
            return new \WP_Error('first_closed', Site::closed(), ['status' => 403]);
        }

        return true;
    }

    public static function site(): array
    {
        $live = Site::live();
        $manifest = $live === null ? null : Site::manifest($live);
        $history = Site::history();
        $limit = wp_convert_hr_to_bytes((string) ini_get('post_max_size'));

        return [
            'protocol' => Site::PROTOCOL,
            'plugin' => FIRST_PLUGIN_VERSION,
            'pluginHash' => FIRST_PLUGIN_HASH,
            'home' => untrailingslashit(home_url()),
            'name' => get_bloginfo('name'),
            'multisite' => is_multisite(),
            'wordpress' => (string) get_bloginfo('version'),
            'php' => PHP_VERSION,
            'requirements' => Requirements::checks(),
            'ready' => Requirements::ready(),
            'server' => Requirements::server(),
            'installed' => (object) Requirements::installed(),
            'closed' => Site::closed() ?? Site::conflict(),
            'setup' => admin_url('admin.php?page=' . Setup::PAGE),
            // A part is sent as a POST body, which PHP drops whole when it is over post_max_size.
            'part' => $limit > 0 ? (int) min(self::PART, intdiv($limit, 2)) : self::PART,
            'live' => $manifest === null ? null : [
                'build' => $live,
                'name' => $manifest['name'],
                'compiler' => (string) ($manifest['compiler'] ?? ''),
                'runtime' => $manifest['runtime'],
                'app' => $manifest['app'],
                'at' => $history === [] ? null : end($history)['at'],
            ],
            'baseline' => Site::baseline(),
            'mounted' => Mount::mounted(),
            'mountError' => Mount::error(),
        ];
    }

    /** What the next compile diffs against: the build's schema snapshot and its migration ledger. */
    public static function baseline(\WP_REST_Request $request): array
    {
        $manifest = Site::manifest($request['build']);
        $app = $manifest === null ? null : Site::root() . '/app/' . $manifest['app'];
        if ($app === null || !is_file($app . '/snapshot.json')) {
            throw new Refusal('first_unknown_build', 'This site has no such build.', 404);
        }
        $migrations = [];
        foreach (scandir($app . '/migrations') ?: [] as $name) {
            if (is_file($app . '/migrations/' . $name)) {
                $migrations[$name] = (string) file_get_contents($app . '/migrations/' . $name);
            }
        }

        return ['build' => $request['build'], 'name' => $manifest['name'], 'snapshot' => (string) file_get_contents($app . '/snapshot.json'), 'migrations' => (object) $migrations];
    }

    /** Install the plugins a build needs: `pins` maps each slug to the version and SHA-256 to install. */
    public static function requirements(\WP_REST_Request $request): array
    {
        $pins = $request->get_json_params()['pins'] ?? null;
        if (!is_array($pins) || $pins === []) {
            throw new Refusal('first_invalid', 'Send the plugins to install as `pins`.', 400);
        }
        try {
            $installed = Requirements::install($pins);
        } catch (\RuntimeException $error) {
            throw new Refusal('first_requirements', $error->getMessage(), 502);
        }

        return ['installed' => $installed, 'plugins' => (object) Requirements::installed()];
    }

    /**
     * Replace this plugin with the uploaded one (`first.zip`, as `first plugin` writes it). A live First
     * app turns off plugin uploads in wp-admin, so the command line that deploys also keeps the plugin
     * current. Whoever may deploy may already install PHP here.
     */
    public static function plugin(\WP_REST_Request $request): array
    {
        $body = $request->get_body();
        if ($body === '' || strlen($body) > 8 * 1048576 || !hash_equals((string) $request->get_param('sha256'), hash('sha256', $body))) {
            throw new Refusal('first_invalid', 'The plugin did not arrive whole; send it again.', 400);
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/misc.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        $package = wp_tempnam('first.zip');
        try {
            file_put_contents($package, $body);
            $archive = new \ZipArchive();
            $slug = dirname(plugin_basename(FIRST_PLUGIN_FILE));
            if ($archive->open($package, \ZipArchive::RDONLY) !== true || $archive->locateName('first/first.php') === false || $slug !== 'first') {
                throw new Refusal('first_invalid', 'This is not the First plugin, or the plugin is not installed as wp-content/plugins/first.', 422);
            }
            for ($i = 0; $i < $archive->numFiles; $i++) {
                if (!str_starts_with((string) $archive->getNameIndex($i), 'first/') || str_contains((string) $archive->getNameIndex($i), '..')) {
                    throw new Refusal('first_invalid', 'The plugin archive holds a file outside first/.', 422);
                }
            }
            $archive->close();
            $upgrader = new \Plugin_Upgrader(new \Automatic_Upgrader_Skin());
            $result = $upgrader->install($package, ['overwrite_package' => true]);
            if ($result !== true) {
                throw new Refusal('first_plugin', 'Could not replace the First plugin: ' . (is_wp_error($result) ? $result->get_error_message() : implode(' ', $upgrader->skin->get_upgrade_messages())), 500);
            }
        } finally {
            @unlink($package);
        }

        return ['updated' => true];
    }

    /** Register a build by its manifest. Answers with a deployment ID, its token, and the trees to send. */
    public static function create(\WP_REST_Request $request): array
    {
        $bytes = $request->get_json_params()['manifest'] ?? null;
        if (!is_string($bytes) || strlen($bytes) > 65536) {
            throw new Refusal('first_invalid', 'Send the build manifest as `manifest`.', 400);
        }
        try {
            $manifest = Site::parseManifest($bytes);
        } catch (\RuntimeException $error) {
            throw new Refusal('first_invalid', $error->getMessage(), 400);
        }
        if (Site::conflict() !== null) {
            throw new Refusal('first_conflict', Site::conflict(), 409);
        }
        $live = Site::live();
        $running = $live === null ? null : Site::manifest($live);
        if ($running !== null && $running['name'] !== $manifest['name']) {
            throw new Refusal('first_other_app', "This site runs the app \"{$running['name']}\". A site runs one First app; this build is \"{$manifest['name']}\".", 409);
        }
        self::current($manifest);
        $build = hash('sha256', $bytes);
        $root = Site::root();
        Trees::prepare($root);
        if (!is_file("$root/build/$build.json")) {
            Trees::write($root, "build/$build.json", $bytes);
        }
        $pending = array_filter((array) get_option(Site::PENDING, []), static fn ($record): bool => is_array($record) && (int) ($record['expires'] ?? 0) > time());
        $id = bin2hex(random_bytes(16));
        $token = bin2hex(random_bytes(32));
        $pending[$id] = ['build' => $build, 'token' => hash('sha256', $token), 'expires' => time() + HOUR_IN_SECONDS, 'user' => get_current_user_id()];
        update_option(Site::PENDING, $pending, false);

        return [
            'deployment' => $id,
            'token' => $token,
            'build' => $build,
            'need' => [
                'runtime' => !is_dir("$root/runtime/{$manifest['runtime']}"),
                'app' => !is_dir("$root/app/{$manifest['app']}"),
            ],
        ];
    }

    /**
     * A build carries the migrations from the build it was compiled against. It installs only on top
     * of that build: when another deployment went live in between, its migrations would be numbered
     * and planned against a schema the database no longer has.
     */
    private static function current(array $manifest): void
    {
        $baseline = Site::baseline();
        if (($manifest['baseline'] ?? null) !== $baseline) {
            throw new Refusal('first_stale', $baseline === null
                ? 'This build was compiled against another build, and this site has none. Run first push again.'
                : 'Another deployment went live after this build was compiled. Run first push again.', 409, ['baseline' => $baseline]);
        }
    }

    /** @return array{build: string, manifest: array} */
    private static function deployment(string $id): array
    {
        $record = ((array) get_option(Site::PENDING, []))[$id] ?? null;
        if (!is_array($record) || (int) ($record['expires'] ?? 0) <= time()) {
            throw new Refusal('first_unknown_deployment', 'This deployment is not open: it was finished, or it expired. Run first push again.', 404);
        }
        $manifest = Site::manifest((string) $record['build']);
        if ($manifest === null) {
            throw new Refusal('first_unknown_deployment', 'This deployment\'s build is no longer in the store. Run first push again.', 404);
        }

        return ['build' => (string) $record['build'], 'manifest' => $manifest];
    }

    /**
     * One part of a tree's ZIP: `index` of `total`, and the whole ZIP's `sha256`. The last part joins
     * them, checks the checksum, and publishes the tree if its contents are what the build names.
     */
    public static function part(\WP_REST_Request $request): array
    {
        $deployment = self::deployment($request['id']);
        $kind = (string) $request['kind'];
        $index = (int) $request->get_param('index');
        $total = (int) $request->get_param('total');
        $sha = (string) $request->get_param('sha256');
        if ($total < 1 || $total > 4096 || $index < 0 || $index >= $total || !Site::validId($sha)) {
            throw new Refusal('first_invalid', 'A part needs index, total and the ZIP\'s sha256.', 400);
        }
        $body = $request->get_body();
        if ($body === '') {
            throw new Refusal('first_invalid', 'The part arrived empty; it may be larger than this server accepts (post_max_size).', 413);
        }
        $root = Site::root();
        $parts = "$root/.tmp/deploy-{$request['id']}-$kind";
        wp_mkdir_p($parts);
        if (file_put_contents("$parts/$index", $body) === false) {
            throw new \RuntimeException('Cannot store the uploaded part');
        }
        if ($index < $total - 1) {
            return ['received' => $index, 'complete' => false];
        }
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }
        $zip = "$parts/tree.zip";
        try {
            $out = fopen($zip, 'wb');
            for ($i = 0; $i < $total; $i++) {
                $in = @fopen("$parts/$i", 'rb');
                if ($out === false || $in === false) {
                    throw new Refusal('first_invalid', "Part $i of the $kind tree is missing; send it again.", 409);
                }
                stream_copy_to_stream($in, $out);
                fclose($in);
            }
            fclose($out);
            if (!hash_equals($sha, (string) hash_file('sha256', $zip))) {
                throw new Refusal('first_invalid', "The $kind tree did not arrive whole; send it again.", 409);
            }
            try {
                Trees::publish($root, $kind, $deployment['manifest'][$kind], $zip);
                Trees::mirror($root, Site::assets(), $kind, $deployment['manifest'][$kind]);
            } catch (\RuntimeException $error) {
                throw new Refusal('first_invalid', $error->getMessage(), 422);
            }
        } finally {
            Trees::remove($parts);
        }

        return ['received' => $index, 'complete' => true];
    }

    /** The mounted build must be this deployment's, mounted the way the route needs it. */
    private static function mounted(string $id, array $deployment, string $mode): void
    {
        $mounted = Mount::mounted();
        if ($mounted === null || $mounted['deployment'] !== $id || $mounted['build'] !== $deployment['build'] || $mounted['mode'] !== $mode) {
            throw new Refusal('first_not_mounted', Mount::error() ?? 'Send this deployment\'s token in X-First-Deployment' . ($mode === 'activate' ? ' with X-First-Mount: activate.' : '.'), 409);
        }
    }

    /** What making this build live would run on this site. Reads only; none of the app's code runs. */
    public static function plan(\WP_REST_Request $request): array
    {
        $deployment = self::deployment($request['id']);
        self::mounted($request['id'], $deployment, 'inspect');
        $plan = \First\Loader\Loader::inspect(Site::root(), $deployment['build']);

        return ['build' => $deployment['build'], 'steps' => $plan['steps'], 'refusals' => $plan['refusals'], 'live' => Site::live()];
    }

    /** Install the build (tables, migrations, pages, schedules, seed) and make it the live one. */
    public static function activate(\WP_REST_Request $request): array
    {
        $deployment = self::deployment($request['id']);
        self::mounted($request['id'], $deployment, 'activate');
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }
        $root = Site::root();
        $build = $deployment['build'];
        // A tree that was already in the store (an earlier deployment's) may predate its public copy.
        foreach (['runtime', 'app'] as $kind) {
            Trees::mirror($root, Site::assets(), $kind, $deployment['manifest'][$kind]);
        }
        try {
            // One deployment installs at a time; the store's lock is the one the loader's own writers
            // take. The baseline is read again inside it: two pushes compiled against the same build
            // can't both install.
            $receipt = \First\Loader\Store::locked($root, static function () use ($root, $build, $deployment): array {
                wp_cache_delete(Site::HISTORY, 'options');
                self::current($deployment['manifest']);
                $receipt = \First\Loader\Loader::initialize($root, $build);
                Site::makeLive($build, $deployment['manifest'], 'deploy');

                return $receipt;
            });
        } catch (Refusal $refusal) {
            throw $refusal;
        } catch (\Throwable $error) {
            throw new Refusal('first_not_installed', $error->getMessage(), 409, ['live' => Site::live()]);
        }
        $pending = (array) get_option(Site::PENDING, []);
        unset($pending[$request['id']]);
        update_option(Site::PENDING, $pending, false);

        return ['live' => $build, 'name' => $deployment['manifest']['name'], 'migrations' => $receipt['migrations'], 'seed' => $receipt['seed'], 'home' => untrailingslashit(home_url())];
    }

    /** Make an earlier build live again. It must have been initialized here; nothing is installed. */
    public static function live(\WP_REST_Request $request): array
    {
        $build = $request->get_json_params()['build'] ?? null;
        try {
            self::rollback(is_string($build) ? $build : '');
        } catch (\RuntimeException $error) {
            throw new Refusal('first_unknown_build', $error->getMessage(), 409);
        }

        return ['live' => $build];
    }

    public static function rollback(string $build): void
    {
        $manifest = Site::manifest($build);
        if ($manifest === null || !Site::complete($manifest) || !Site::ready($build)) {
            throw new \RuntimeException('Only a build that was live on this site before can be made live again.');
        }
        Site::makeLive($build, $manifest, 'rollback');
    }
}

/** A deploy request the site refuses, as a REST error with a status. */
final class Refusal extends \RuntimeException
{
    public function __construct(public readonly string $problem, string $message, public readonly int $status, public readonly array $detail = [])
    {
        parent::__construct($message);
    }
}
