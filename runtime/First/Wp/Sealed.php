<?php

declare(strict_types=1);

namespace First\Wp;

use First\Schema;

/**
 * Sealed mode (`defineConfig({ sealed: true })`, docs/sealed.md): the only code that runs as a plugin
 * is First's own plugins, the platform plugins First pins, the plugins the config declares (exact
 * versions, checksums in the committed lock) and plugin packages (compiled into the app plugin).
 *
 * What this class can do is limited by where it runs. WordPress loads drop-ins, then mu-plugins, then
 * network-active and active plugins, each before First's app plugin, and nothing an ordinary plugin
 * does stops another plugin WordPress has already loaded in the same request. So on a plain WordPress
 * host sealed mode is:
 *
 * - a refusal to activate anything not on the list: wp-admin (one, bulk, network), core's REST
 *   plugins route and WP-CLI, all of which go through `activate_plugin()` and its requirement check;
 * - a report of what is loaded and not on the list (active and network-active plugins, mu-plugins,
 *   drop-ins, theme PHP), in `GET /__first/api/v1` under `runtime.wp.sealed` and in `first doctor`.
 *
 * Nothing is deactivated or deleted. A host that mounts First through the build store reads the same
 * list from the build manifest and can enforce it before any plugin loads.
 */
final class Sealed
{
    /** First's own plugins, whatever the build: the runtime, identity, admin, the app and its pages. */
    private const FIRST = ['first-runtime', 'first-identity', 'first-admin'];

    /** @var ?array<string, true> plugin directory slugs that may run */
    private static ?array $allowed = null;

    public static function apply(Schema $schema): void
    {
        $declared = $schema->sealed();
        if ($declared === null) {
            return;
        }
        self::$allowed = self::allowed($schema, $declared);
        // Every activation path (wp-admin's single, bulk and network screens, core's REST plugins
        // route, WP-CLI) calls activate_plugin(), which asks this filter before it loads the plugin.
        add_filter('validate_plugin_requirements', [self::class, 'requirements'], PHP_INT_MAX, 2);
        // The screens and the REST route also ask the capability first: answer there too, so the
        // Activate link is gone and REST refuses with its own 403 before the plugin is read.
        add_filter('map_meta_cap', static function (array $caps, string $cap, int $user, array $args): array {
            return in_array($cap, ['activate_plugin'], true) && is_string($args[0] ?? null) && !self::allows((string) $args[0]) ? ['do_not_allow'] : $caps;
        }, PHP_INT_MAX, 4);
        add_filter('plugin_action_links', [self::class, 'actionLinks'], PHP_INT_MAX, 2);
        add_filter('network_admin_plugin_action_links', [self::class, 'actionLinks'], PHP_INT_MAX, 2);
        add_action('admin_notices', [self::class, 'notice']);
        add_action('network_admin_notices', [self::class, 'notice']);
    }

    /**
     * The plugin slugs that may run: First's own and the app's, the platform pins and the plugins the
     * config declares (schema.php), every one as a directory slug.
     *
     * @param list<string> $declared
     * @return array<string, true>
     */
    private static function allowed(Schema $schema, array $declared): array
    {
        $allowed = array_fill_keys([...self::FIRST, 'first-app-' . $schema->name(), 'first-pages-' . $schema->name(), ...array_keys(Platform::PLUGINS), ...$declared], true);
        unset($allowed['']);

        return $allowed;
    }

    /** A plugin file (`slug/slug.php`, `hello.php`) is allowed when its directory slug is. */
    public static function allows(string $plugin): bool
    {
        if (self::$allowed === null) {
            return true;
        }
        $plugin = plugin_basename($plugin);
        $slug = str_contains($plugin, '/') ? strstr($plugin, '/', true) : basename($plugin, '.php');

        return isset(self::$allowed[$slug]);
    }

    public static function requirements(mixed $valid, mixed $plugin): mixed
    {
        // WP-CLI is refused too: the list is the config, and sealed mode has no operator exception.
        if ($valid !== true || !is_string($plugin) || self::allows($plugin)) {
            return $valid;
        }

        return new \WP_Error('first_sealed', self::message($plugin), ['status' => 403]);
    }

    public static function message(string $plugin): string
    {
        return "Refused: this site is sealed (sealed: true in first.config.ts), and $plugin isn't one of the plugins it runs. Declare it under `plugins` in first.config.ts and deploy, or turn sealed mode off.";
    }

    /**
     * @param array<string, string> $links
     * @return array<string, string>
     */
    public static function actionLinks(mixed $links, mixed $plugin): mixed
    {
        if (!is_array($links) || !is_string($plugin) || self::allows($plugin)) {
            return $links;
        }
        unset($links['activate'], $links['network_activate']);
        $links['first_sealed'] = '<span title="' . esc_attr(self::message($plugin)) . '">Sealed: not in first.config.ts</span>';

        return $links;
    }

    /** wp-admin: what is loaded and not on the list, named, so the owner can act on it. */
    public static function notice(): void
    {
        $report = self::report();
        if ($report === null || !current_user_can('activate_plugins') || array_merge(...array_values(array_filter($report, 'is_array'))) === []) {
            return;
        }
        $lines = [];
        foreach (['plugins' => 'active plugins', 'networkPlugins' => 'network-active plugins', 'muPlugins' => 'must-use plugins', 'dropins' => 'drop-ins', 'theme' => 'theme PHP'] as $key => $label) {
            if (($report[$key] ?? []) !== []) {
                $lines[] = $label . ': ' . implode(', ', $report[$key]);
            }
        }
        echo '<div class="notice notice-warning"><p><strong>This site is sealed</strong> (sealed: true in first.config.ts), and code it doesn\'t list is loaded. First doesn\'t stop or remove it; deactivate or remove it, or declare it in first.config.ts.</p><p>'
            . esc_html(implode('; ', $lines)) . '</p></div>';
    }

    /**
     * What is loaded in this request and not on the list, or null when the site isn't sealed.
     *
     * @return ?array{plugins: list<string>, networkPlugins: list<string>, muPlugins: list<string>, dropins: list<string>, theme: list<string>, enforced: string}
     */
    public static function report(): ?array
    {
        if (self::$allowed === null) {
            return null;
        }
        $unlisted = static fn (array $plugins): array => array_values(array_filter(array_map('plugin_basename', $plugins), static fn (string $p): bool => !self::allows($p)));
        $network = is_multisite() ? array_keys((array) get_site_option('active_sitewide_plugins', [])) : [];

        return [
            'plugins' => $unlisted((array) get_option('active_plugins', [])),
            'networkPlugins' => $unlisted($network),
            // Every file WordPress loads from these: none is First's on a plain WordPress host.
            'muPlugins' => array_values(array_map('basename', wp_get_mu_plugins())),
            'dropins' => self::dropins(),
            'theme' => self::theme(),
            'enforced' => defined('FIRST_SEALED_ENFORCED') && FIRST_SEALED_ENFORCED ? 'host' : 'report',
        ];
    }

    /** Drop-ins present in wp-content (core loads each in its own case: cache, database, errors). */
    private static function dropins(): array
    {
        if (!function_exists('_get_dropins')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $found = [];
        foreach (array_keys(_get_dropins()) as $file) {
            if (is_file(WP_CONTENT_DIR . '/' . $file)) {
                $found[] = $file;
            }
        }

        return $found;
    }

    /**
     * The active theme's PHP: `functions.php` (WordPress includes it on every request) and, for a
     * block theme, its PHP pattern files (included to render each pattern), as `<theme>/functions.php`
     * and `<theme>/patterns/*.php (<count>)`. First's own block theme ships neither and isn't listed.
     *
     * @return list<string>
     */
    private static function theme(): array
    {
        $found = [];
        foreach (array_unique([get_stylesheet_directory(), get_template_directory()]) as $dir) {
            if (str_starts_with(wp_normalize_path($dir), wp_normalize_path(dirname(__DIR__) . '/theme/'))) {
                continue;
            }
            if (is_file($dir . '/functions.php')) {
                $found[] = basename($dir) . '/functions.php';
            }
            $patterns = count(glob($dir . '/patterns/*.php') ?: []);
            if ($patterns > 0) {
                $found[] = basename($dir) . "/patterns/*.php ($patterns)";
            }
        }

        return $found;
    }
}
