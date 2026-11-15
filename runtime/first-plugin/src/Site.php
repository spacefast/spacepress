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

    /**
     * The build store: `FIRST_STORE_DIR`, else `wp-content/first-store-<key>`. It holds PHP, schema
     * snapshots, migrations and seed content, and many servers ignore `.htaccess`, so its name carries
     * a random key and no URL ever names it. What a browser needs is copied to {@see assets()}.
     */
    public static function root(): string
    {
        if (defined('FIRST_STORE_DIR') && is_string(FIRST_STORE_DIR) && FIRST_STORE_DIR !== '') {
            return rtrim(FIRST_STORE_DIR, '/');
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

    /**
     * The build the next one is compiled against: the one deployed last. Making an earlier build live
     * again switches code only, so the database stays at the schema of the last deployment.
     */
    public static function baseline(): ?string
    {
        foreach (array_reverse(self::history()) as $entry) {
            if (($entry['kind'] ?? null) === 'deploy' && self::validId($entry['build'] ?? null) && is_file(self::root() . '/build/' . $entry['build'] . '.json')) {
                return $entry['build'];
            }
        }

        return self::live();
    }

    /** Make a build the live one and record who did it. */
    public static function makeLive(string $build, array $manifest, string $kind): void
    {
        update_option(self::LIVE, $build, true);
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
    }

    /**
     * Deploying installs PHP, so it is for the people who can already do that: administrators, and on a
     * network only its super admins. A First app turns off `install_plugins` for everyone once it is
     * live, so the check is on these capabilities instead.
     */
    public static function mayDeploy(): bool
    {
        return current_user_can(self::capability());
    }

    public static function capability(): string
    {
        return is_multisite() ? 'manage_network_plugins' : 'activate_plugins';
    }

    /** Why this site takes no deployments at all, or null. A host that manages its own code says so. */
    public static function closed(): ?string
    {
        if (defined('DISALLOW_FILE_MODS') && DISALLOW_FILE_MODS) {
            return 'This site does not allow file changes (DISALLOW_FILE_MODS), so it cannot take a deployment. Deploy the build with the site\'s own code instead.';
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
