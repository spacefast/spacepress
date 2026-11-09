<?php
declare(strict_types=1);
namespace Zero\Wp;

/**
 * The opinionated WordPress (spec.md §6): what Zero turns off and configures on a site that runs a Zero
 * app. Only the active app's Plugin calls apply(), so WordPress without a Zero app, or with the runtime
 * plugin alone, keeps each of these as WordPress ships it. Nothing here writes wp-config, mu-plugins or
 * files: every switch is a hook that exists while the app is active. Settings Zero configures answer
 * through `pre_option_*`/`option_*` filters, so deactivating the app leaves the owner's stored values.
 *
 * Each switch is one named method; the hardening lane (tests/wp/hardening) proves each against real
 * WordPress, and that each is gone again without the app.
 */
final class Hardening
{
    /** Zero's minimal block theme (runtime/Zero/theme/zero-default), used when no installed theme is active. */
    public const THEME = 'zero-default';
    /** Pretty permalinks: the structure Zero's URL patterns assume. */
    public const PERMALINKS = '/%postname%/';
    /** The host variable naming the Space's IANA timezone, such as `Europe/Berlin`. */
    public const TIMEZONE = 'ZERO_SITE_TIMEZONE';
    /** Fingerprint of the rewrite rules Zero built for PERMALINKS (see permalinks()). */
    private const RULES = 'zero_rewrite_rules';

    /** In the order spec.md §6 lists them. */
    public const SWITCHES = ['xmlrpc', 'pings', 'emoji', 'fileEditors', 'pluginAndThemeInstalls', 'autoUpdates', 'customizer', 'comments', 'permalinks', 'timezone', 'blockTheme'];

    private static bool $applied = false;

    public static function apply(\Zero\Schema $schema): void
    {
        if (self::$applied) {
            return;
        }
        self::$applied = true;
        foreach (self::SWITCHES as $switch) {
            self::$switch($schema);
        }
    }

    // ================================================================ always disabled

    /**
     * XML-RPC answers nothing, `system.*` and `?rsd` included; no EditURI link or X-Pingback header. One
     * narrow exception: WordPress.com reaches a site's Jetpack connection over XML-RPC (`?for=jetpack`, on
     * xmlrpc.php or Jetpack's own `?jetpack=comms` endpoint), and spam checks use the Akismet that connection
     * sets up. While Jetpack's connection is loaded, such a request gets Jetpack's `jetpack.*` methods and
     * nothing else; Jetpack decides which of them a request may call and checks its signature or secret.
     */
    private static function xmlrpc(): void
    {
        add_filter('xmlrpc_enabled', '__return_false');
        add_filter('xmlrpc_methods', static fn (array $methods): array => self::jetpackXmlrpc()
            ? array_filter($methods, static fn (string $name): bool => str_starts_with($name, 'jetpack.'), ARRAY_FILTER_USE_KEY)
            : [], PHP_INT_MAX);
        // At init: Jetpack defines XMLRPC_REQUEST for its alternate endpoint later than the app applies this.
        add_action('init', static function (): void {
            if (!defined('XMLRPC_REQUEST') || !XMLRPC_REQUEST || self::jetpackXmlrpc()) {
                return;
            }
            status_header(403);
            header('Content-Type: text/xml; charset=UTF-8');
            echo '<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>403</int></value></member>'
                . '<member><name>faultString</name><value><string>XML-RPC is turned off on this site.</string></value></member></struct></value></fault></methodResponse>';
            exit;
        }, 0);
        remove_action('wp_head', 'rsd_link');
        add_filter('wp_headers', static function (array $headers): array {
            unset($headers['X-Pingback']);
            return $headers;
        }, PHP_INT_MAX);
        add_filter('bloginfo_url', static fn (string $url, string $show): string => $show === 'pingback_url' ? '' : $url, PHP_INT_MAX, 2);
    }

    /**
     * A request for Jetpack's connection, while that connection has configured itself for this request.
     * Jetpack fires this action after its connection Manager installed its own XML-RPC handlers; the class
     * existing isn't enough, since other plugins bundle Jetpack's packages.
     */
    private static function jetpackXmlrpc(): bool
    {
        return ($_GET['for'] ?? null) === 'jetpack' && did_action('jetpack_feature_connection_enabled') > 0;
    }

    /** No pingbacks or trackbacks, in or out. */
    private static function pings(): void
    {
        add_filter('pings_open', '__return_false', PHP_INT_MAX);
        add_filter('pre_option_default_ping_status', static fn (): string => 'closed');
        add_filter('pre_option_default_pingback_flag', static fn (): string => '0');
        // A publish still queues `do_pings`; nothing it would send leaves the site.
        remove_action('do_pings', 'do_all_pings', 10);
    }

    /** No emoji detection script or styles on the front end, wp-admin or embeds, and no emoji images in feeds or mail. */
    private static function emoji(): void
    {
        remove_action('wp_head', 'print_emoji_detection_script', 7);
        remove_action('embed_head', 'print_emoji_detection_script');
        remove_action('wp_enqueue_scripts', 'wp_enqueue_emoji_styles');
        remove_action('enqueue_embed_scripts', 'wp_enqueue_emoji_styles');
        remove_action('wp_print_styles', 'print_emoji_styles');
        // wp-admin adds its own hooks (admin-filters.php) after plugins load.
        add_action('admin_init', static function (): void {
            remove_action('admin_print_scripts', 'print_emoji_detection_script');
            remove_action('admin_enqueue_scripts', 'wp_enqueue_emoji_styles');
            remove_action('admin_print_styles', 'print_emoji_styles');
        }, 0);
        remove_filter('the_content_feed', 'wp_staticize_emoji');
        remove_filter('comment_text_rss', 'wp_staticize_emoji');
        remove_filter('wp_mail', 'wp_staticize_emoji_for_email');
    }

    /** The plugin and theme file editors are gone for everyone, administrators included. */
    private static function fileEditors(): void
    {
        self::refuse(['edit_files', 'edit_plugins', 'edit_themes']);
    }

    /**
     * Nobody installs, uploads, updates or deletes plugins, themes or core from wp-admin or REST: Zero's
     * release pins the plugins. Activating installed plugins and installing translations stay.
     */
    private static function pluginAndThemeInstalls(): void
    {
        self::refuse(['install_plugins', 'upload_plugins', 'update_plugins', 'delete_plugins', 'install_themes', 'upload_themes', 'update_themes', 'delete_themes', 'update_core']);
        add_filter('file_mod_allowed', static fn (bool $allowed, string $context): bool => $allowed && in_array($context, ['download_language_pack', 'can_install_language_pack'], true), PHP_INT_MAX, 2);
    }

    /** No automatic core, plugin or theme updates: Zero's release decides what runs. */
    private static function autoUpdates(): void
    {
        add_filter('automatic_updater_disabled', '__return_true', PHP_INT_MAX);
        foreach (['auto_update_core', 'auto_update_plugin', 'auto_update_theme', 'plugins_auto_update_enabled', 'themes_auto_update_enabled'] as $filter) {
            add_filter($filter, '__return_false', PHP_INT_MAX);
        }
    }

    /** No Customizer: refusing `customize` removes customize.php, its menu entry and the admin-bar link. */
    private static function customizer(): void
    {
        self::refuse(['customize']);
    }

    /**
     * Comments are closed on every post type except the app's collections declared with `comments: true`
     * (spec.md §2.3). Core's comment form, wp-comments-post.php and REST all ask comments_open(). Core posts
     * and pages stay closed until the built-in kinds take `comments` (build-plan.md §3).
     */
    private static function comments(\Zero\Schema $schema): void
    {
        $open = [];
        foreach ($schema->collections() as $collection) {
            if (($collection['comments'] ?? false) === true && isset($collection['wp']['postType'])) {
                $open[$collection['wp']['postType']] = true;
            }
        }
        add_filter('comments_open', static function (bool $isOpen, mixed $post) use ($open): bool {
            $post = get_post($post);
            return $isOpen && $post instanceof \WP_Post && isset($open[$post->post_type]);
        }, PHP_INT_MAX, 2);
        add_filter('get_default_comment_status', static function (string $status, string $type, string $commentType) use ($open): string {
            return $commentType === 'comment' && isset($open[$type]) ? $status : 'closed';
        }, PHP_INT_MAX, 3);
    }

    // ================================================================ always configured

    /**
     * Pretty permalinks. Core caches rewrite rules in `rewrite_rules` for whatever structure was active
     * when they were built; Zero records a fingerprint of the rules it built, and treats any other cached
     * rules (built without the app, or for the owner's structure) as stale. Core and plugins that clear
     * `rewrite_rules` keep working, and deactivating the app clears Zero's rules (deactivate()).
     */
    private static function permalinks(): void
    {
        add_filter('pre_option_permalink_structure', static fn (): string => self::PERMALINKS);
        add_filter('option_rewrite_rules', static fn (mixed $rules): mixed => is_array($rules) && get_option(self::RULES) === self::fingerprint($rules) ? $rules : '');
        // Before the write: MySQL reports no affected row for unchanged bytes, and update_option then fires nothing after it.
        add_filter('pre_update_option_rewrite_rules', static function (mixed $rules): mixed {
            update_option(self::RULES, is_array($rules) ? self::fingerprint($rules) : '', true);
            return $rules;
        }, PHP_INT_MAX);
        add_action('add_option_rewrite_rules', static fn (string $_, mixed $rules) => update_option(self::RULES, is_array($rules) ? self::fingerprint($rules) : '', true), 10, 2);
    }

    /**
     * The app's deactivation hook. `rewrite_rules` is core's cache, rebuilt on the next request: rules built
     * for Zero's structure must not outlive the app. The rest of this request still runs with the app's
     * filters, so whatever it rebuilds is dropped again at shutdown.
     */
    public static function deactivate(): void
    {
        $drop = static function (): void {
            delete_option(self::RULES);
            delete_option('rewrite_rules');
        };
        $drop();
        add_action('shutdown', $drop, PHP_INT_MAX);
    }

    private static function fingerprint(array $rules): string
    {
        return self::PERMALINKS . ':' . md5(serialize($rules));
    }

    /** The Space's timezone, when the host sets ZERO_SITE_TIMEZONE; the owner's setting otherwise. */
    private static function timezone(): void
    {
        $zone = \Zero\Env::get(self::TIMEZONE);
        if ($zone === null || !in_array($zone, \DateTimeZone::listIdentifiers(), true)) {
            return;
        }
        // Core derives gmt_offset from timezone_string (wp_timezone_override_offset).
        add_filter('pre_option_timezone_string', static fn (): string => $zone);
    }

    /**
     * A block theme always renders. While the active theme is installed, it stays: choosing one is the
     * owner's. When none is (a fresh box, a deleted theme), WordPress renders with Zero's minimal block
     * theme, registered from the runtime's own directory. The stored theme options are never rewritten.
     */
    private static function blockTheme(): void
    {
        $root = dirname(__DIR__) . '/theme';
        register_theme_directory($root);
        $resolving = false;
        $missing = null;
        $fallback = static function () use (&$resolving, &$missing): bool {
            if ($missing === null) {
                $resolving = true;
                try {
                    $missing = !wp_get_theme((string) get_option('stylesheet'))->exists();
                } finally {
                    $resolving = false;
                }
            }
            return $missing;
        };
        // A theme switched in this request (WP-CLI, a REST call) is the active one from then on.
        add_action('update_option_stylesheet', static function () use (&$missing): void {
            $missing = null;
        });
        foreach (['template', 'stylesheet'] as $option) {
            add_filter("option_$option", static function (mixed $value) use (&$resolving, $fallback): mixed {
                return !$resolving && $fallback() ? self::THEME : $value;
            }, PHP_INT_MAX);
            add_filter("option_{$option}_root", static function (mixed $value) use (&$resolving, $fallback, $root): mixed {
                return !$resolving && $fallback() ? $root : $value;
            }, PHP_INT_MAX);
        }
    }

    /** @param list<string> $caps refused for every user, whatever their role grants */
    private static function refuse(array $caps): void
    {
        $caps = array_fill_keys($caps, true);
        add_filter('map_meta_cap', static fn (array $required, string $cap): array => isset($caps[$cap]) ? ['do_not_allow'] : $required, PHP_INT_MAX, 2);
    }
}
