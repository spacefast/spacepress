<?php
declare(strict_types=1);

namespace FirstPlugin;

/** What this site is to First: where its builds are kept, which one is live, and who may deploy. */
final class Site
{
    /** The deploy protocol `first push` speaks; a CLI that doesn't know it asks for a newer plugin. */
    public const PROTOCOL = 1;
    public const REST = 'first-deploy/v1';
    /** Option: the build ID every request mounts. */
    public const LIVE = 'first_live_build';
    /** Option: every deployment and rollback, oldest first. Never pruned. */
    public const HISTORY = 'first_deployments';
    /** Option: deployments that are uploading or waiting to be made live, by ID. */
    public const PENDING = 'first_pending_deployments';

    /** Option: the random part of the store directory's name. */
    public const KEY = 'first_store_key';
    /** The capability the receiver and the First screen ask for; see {@see deployer()}. */
    public const CAPABILITY = 'first_deploy';
    /** The `app_id` `first login` names on WordPress's Authorize Application screen (src/commands/login.rs). */
    public const CLI = '0d1f6c5e-3b55-4f0e-9c2a-6a1e5f1b7a10';

    public static function register(): void
    {
        add_filter('map_meta_cap', static fn (array $caps, string $cap, int $user): array => $cap === self::CAPABILITY
            ? [self::deployer($user) ? 'exist' : 'do_not_allow']
            : $caps, 10, 3);
    }

    /**
     * The build store: `FIRST_STORE_DIR`, else `wp-content/first-store-<key>`. It holds PHP, schema
     * snapshots, migrations and seed content, and many servers ignore `.htaccess`, so its name carries
     * a random key and no URL ever names it. What a browser needs is copied to {@see assets()}.
     */
    public static function root(): string
    {
        if (defined('FIRST_STORE_DIR') && is_string(FIRST_STORE_DIR) && FIRST_STORE_DIR !== '') {
            // One constant serves a whole network: each site keeps its builds, and the record of which
            // of them it has initialized, in a directory of its own.
            return rtrim(FIRST_STORE_DIR, '/') . (is_multisite() ? '/site-' . get_current_blog_id() : '');
        }
        $key = get_option(self::KEY);
        if (!is_string($key) || preg_match('/\A[0-9a-f]{32}\z/D', $key) !== 1) {
            // add_option keeps the first writer's key when two requests create it at once.
            add_option(self::KEY, bin2hex(random_bytes(16)), '', true);
            wp_cache_delete(self::KEY, 'options');
            wp_cache_delete('alloptions', 'options');
            $key = (string) get_option(self::KEY);
        }

        return WP_CONTENT_DIR . '/first-store-' . $key;
    }

    /**
     * What to tell the site's owner about where the store is, or null. The store holds PHP, schema
     * snapshots, migrations and seed content. Under the web root, what keeps it from being served is
     * its `.htaccess`, which Apache and LiteSpeed read and nginx does not; a random directory name
     * no URL carries is the only thing left on the others. A site that can keeps it outside the web
     * root with `FIRST_STORE_DIR`.
     */
    public static function exposure(): ?string
    {
        $store = self::real(self::root());
        $web = self::real(ABSPATH);
        // Core's own answer to "where does the document root end": wp-content can be moved out of it.
        $content = self::real(WP_CONTENT_DIR);
        $inside = static fn (string $base): bool => $base !== '' && ($store === $base || str_starts_with($store, $base . '/'));
        if (!$inside($web) && !$inside($content)) {
            return null;
        }
        $server = (string) ($_SERVER['SERVER_SOFTWARE'] ?? '');
        if (preg_match('/apache|litespeed/i', $server) === 1) {
            return null;
        }

        return 'First keeps this site\'s builds (PHP, database migrations, seed content) in ' . self::root()
            . ', which is inside the folder the web server serves. '
            . ($server === '' ? 'This server' : 'This server (' . preg_replace('/[^A-Za-z0-9 ._\/-]/', '', substr($server, 0, 40)) . ')')
            . ' may not read the .htaccess file that blocks it, so only the folder\'s random name keeps those files private.'
            . ' Set FIRST_STORE_DIR in wp-config.php to a folder outside the web root, or have the server deny that folder.';
    }

    /** A path with its links resolved when it exists, as written otherwise, without a trailing slash. */
    private static function real(string $path): string
    {
        $real = realpath($path);

        return rtrim(str_replace('\\', '/', $real === false ? $path : $real), '/');
    }

    /**
     * The public copy of each stored tree's scripts, styles, images and fonts, at the same paths. A
     * tree is named by the hash of its contents, so the sites of a network share this directory: two
     * sites that hold the same tree hold the same files. The store itself is per site (its key is a
     * site option), as is which build is live.
     */
    public static function assets(): string
    {
        return WP_CONTENT_DIR . '/first-assets';
    }

    /** The URL of {@see assets()}: where a build's plugins' asset URLs point. */
    public static function url(): string
    {
        return content_url('first-assets');
    }

    /**
     * This request's route below the deploy namespace (`/deployments/<id>/plan`), or null when it is not
     * a request WordPress serves from the REST API: the path under the site's REST prefix, or
     * `?rest_route=` on the front controller. A deploy route named in the query string of any other
     * script (admin-ajax.php, First's own API) is not one.
     */
    public static function route(): ?string
    {
        $path = (string) (wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        if ($base !== '' && str_starts_with($path, $base . '/')) {
            $path = substr($path, strlen($base));
        }
        if (str_starts_with($path, '/index.php/')) {
            $path = substr($path, strlen('/index.php'));
        }
        $prefix = '/' . rest_get_url_prefix();
        // WordPress takes `rest_route` from the body, then the query, then the path (WP::parse_request).
        // A request that names a route in more than one of them is not taken as a deploy request.
        if (isset($_POST['rest_route'])) {
            return null;
        }
        if (str_starts_with($path, $prefix . '/')) {
            if (isset($_GET['rest_route'])) {
                return null;
            }
            $route = substr($path, strlen($prefix));
        } elseif (($path === '/' || $path === '/index.php') && is_string($_GET['rest_route'] ?? null)) {
            $route = $_GET['rest_route'];
        } else {
            return null;
        }
        $namespace = '/' . self::REST;
        // Core's REST server drops a trailing slash before it matches a route.
        $route = rtrim($route, '/');

        return $route === $namespace || str_starts_with($route, $namespace . '/') ? substr($route, strlen($namespace)) : null;
    }

    /**
     * Whether this request asks WordPress's REST server to treat it as another method than its own
     * (`_method`, `X-HTTP-Method-Override`).
     */
    public static function overridden(): bool
    {
        return isset($_GET['_method']) || isset($_POST['_method']) || isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
    }

    public static function validId(mixed $id): bool
    {
        return is_string($id) && preg_match('/\A[0-9a-f]{64}\z/D', $id) === 1;
    }

    public static function live(): ?string
    {
        $build = get_option(self::LIVE);

        return self::validId($build) ? $build : null;
    }

    /**
     * A stored build's manifest, or null when the store has none under that ID. The ID is the hash of
     * the manifest's bytes, so one that was changed on disk is refused.
     */
    public static function manifest(string $build): ?array
    {
        if (!self::validId($build)) {
            return null;
        }
        $bytes = @file_get_contents(self::root() . '/build/' . $build . '.json');
        if (!is_string($bytes)) {
            return null;
        }
        if (!hash_equals($build, hash('sha256', $bytes))) {
            throw new \RuntimeException("First build $build does not match its ID");
        }

        return self::parseManifest($bytes);
    }

    /** The fields the plugin reads from a build manifest, checked; anything else in it is the loader's. */
    public static function parseManifest(string $bytes): array
    {
        $manifest = json_decode($bytes, true, 16);
        if (!is_array($manifest) || ($manifest['format'] ?? null) !== 'first.build.v1'
            || !is_string($manifest['name'] ?? null) || preg_match('/\A[a-z0-9-]+\z/D', $manifest['name']) !== 1
            || !self::validId($manifest['runtime'] ?? null) || !self::validId($manifest['app'] ?? null)) {
            throw new \RuntimeException('This is not a First build manifest');
        }

        return $manifest;
    }

    /** Whether the build's runtime and app trees are in the store. */
    public static function complete(array $manifest): bool
    {
        $root = self::root();

        return is_file($root . '/runtime/' . $manifest['runtime'] . '/first-loader.php')
            && is_dir($root . '/app/' . $manifest['app'] . '/plugins/first-app-' . $manifest['name']);
    }

    /** Whether the build has been initialized on this site, so it can be made live without installing. */
    public static function ready(string $build): bool
    {
        return self::validId($build) && is_file(self::root() . '/ready/' . $build . '.json');
    }

    /** @return list<array{build: string, name: string, compiler: string, at: string, user: int, kind: string}> */
    public static function history(): array
    {
        $history = get_option(self::HISTORY, []);

        return is_array($history) ? array_values(array_filter($history, 'is_array')) : [];
    }

    /** @return array<string, array{build: string, token: string, expires: int, user: int}> open deployments by ID */
    public static function pending(): array
    {
        $pending = get_option(self::PENDING, []);

        return is_array($pending) ? array_filter($pending, 'is_array') : [];
    }

    /**
     * The build the next one is compiled against: the one deployed last, whether or not its files are
     * still in the store, because the database is at its schema. Making an earlier build live again
     * switches code only.
     */
    public static function baseline(): ?string
    {
        foreach (array_reverse(self::history()) as $entry) {
            if (($entry['kind'] ?? null) === 'deploy' && self::validId($entry['build'] ?? null)) {
                return $entry['build'];
            }
        }

        return self::live();
    }

    /**
     * Run $fn as the only writer of this site's deployments: creating one, making a build live and
     * making an earlier one live again each read what is stored and write it back. The lock is the
     * store's own (`<store>/.lock`, the one the compiler and the loader take). What another request
     * wrote while this one waited is read from the database again.
     */
    public static function locked(callable $fn): mixed
    {
        $root = self::root();
        Trees::prepare($root);
        $handle = fopen($root . '/.lock', 'c');
        if ($handle === false || !flock($handle, LOCK_EX)) {
            throw new \RuntimeException('Cannot lock the First build store');
        }
        try {
            foreach ([self::LIVE, self::HISTORY, self::PENDING, 'alloptions', 'notoptions'] as $cached) {
                wp_cache_delete($cached, 'options');
            }

            return $fn();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * Make a build the live one and record who did it. Call it inside {@see locked()}. The history is
     * written first: a request that dies between the two writes leaves the old code live with the
     * right baseline, never new code beside a baseline the database has moved past.
     */
    public static function makeLive(string $build, array $manifest, string $kind): void
    {
        $history = self::history();
        $history[] = [
            'build' => $build,
            'name' => (string) $manifest['name'],
            'compiler' => (string) ($manifest['compiler'] ?? ''),
            'at' => gmdate('c'),
            'user' => get_current_user_id(),
            'kind' => $kind,
        ];
        update_option(self::HISTORY, $history, false);
        update_option(self::LIVE, $build, true);
    }

    /**
     * Deploying installs PHP, so it is for the people whose role lets them install plugins:
     * administrators, and on a network only its super admins. Being allowed to activate plugins that
     * are already installed is not enough.
     */
    public static function mayDeploy(): bool
    {
        return current_user_can(self::CAPABILITY);
    }

    /**
     * Whether the user is granted `install_plugins`: by their role, as changed by any `user_has_cap`
     * filter (a plugin that takes the capability away, or grants it, is honored). It does not go
     * through `map_meta_cap`: a live First app refuses `install_plugins` to everyone there (its
     * hardening), and deploying is how such a site still gets new code.
     */
    public static function deployer(int $user): bool
    {
        $account = get_userdata($user);
        if (!$account instanceof \WP_User) {
            return false;
        }
        if (is_multisite()) {
            return is_super_admin($user);
        }
        // What WP_User::has_cap does after the meta mapping, for this one primitive capability.
        $granted = apply_filters('user_has_cap', $account->allcaps, ['install_plugins'], ['install_plugins', $user], $account);

        return is_array($granted) && !empty($granted['install_plugins']);
    }

    private static ?bool $fileMods = null;

    /**
     * Whether the site itself lets code be installed: WordPress's file-modification policy, which is
     * the `DISALLOW_FILE_MODS` constant and any `file_mod_allowed` filter, asked the way core asks for
     * `install_plugins`. {@see Mount} reads it before a build mounts and it is kept for the request,
     * because a live First app adds a filter of its own that refuses file changes in wp-admin (its
     * hardening), and deploying is how such a site gets new code. A filter another plugin adds after
     * plugins have loaded is not seen.
     */
    public static function fileMods(): bool
    {
        return self::$fileMods ??= wp_is_file_mod_allowed('capability_update_core');
    }

    /** Why this site takes no deployments at all, or null. A host that manages its own code says so. */
    public static function closed(): ?string
    {
        if (!self::fileMods()) {
            return 'This site does not allow file changes (DISALLOW_FILE_MODS, or a file_mod_allowed filter), so it cannot take a deployment. Deploy the build with the site\'s own code instead.';
        }
        $reason = apply_filters('first_deploy_closed', null);

        return is_string($reason) && $reason !== '' ? $reason : null;
    }

    /**
     * First installed here as separate plugins (what `first build` writes) runs its own app. The two
     * can't both run: one First app per site.
     */
    public static function conflict(): ?string
    {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        foreach (array_keys(get_plugins()) as $file) {
            if ((str_starts_with($file, 'first-runtime/') || str_starts_with($file, 'first-app-')) && is_plugin_active($file)) {
                return 'This site already runs First from separately installed plugins (' . dirname($file) . '). Deactivate the First Runtime and First app plugins before deploying here.';
            }
        }

        return null;
    }

    /** Core accepts application passwords over HTTPS, or on a site whose environment type is `local`. */
    public static function passwords(): bool
    {
        return function_exists('wp_is_application_passwords_available') && wp_is_application_passwords_available();
    }
}
