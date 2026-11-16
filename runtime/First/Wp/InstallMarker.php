<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * One autoloaded option saying that a plugin-installed site already holds everything this build and
 * this runtime install on requests: the stored-name upgrade, the shared system tables, the app's
 * migrations, Action Scheduler's groups and recurring actions, route and content Pages, Polylang's
 * languages, the search index shape, the runtime-schema capability. While it matches, a request runs
 * none of those checks ({@see Runtime::installs()}), as a managed build never does on a request.
 *
 * Its value is a digest of the build (the loaded `schema.php`), the runtime tables version, the
 * runtime's own hash, the app, the UTC day and the active plugins (the site's and, on multisite, the
 * network's), so a new build, a runtime update, another app, a plugin change or a new day finds no
 * marker and checks again. On multisite each site has its own marker and its own answer.
 *
 * It is recorded at the end of `wp_loaded`, only after every check has been read again and passed;
 * a failed, refused or held install leaves it unrecorded, so the next request retries as before.
 * Anything that changes what it covers drops it: an option those checks keep ({@see watches()}), the
 * active plugins, activating, deactivating or migrating the app, and a change to one of the app's
 * route Pages. What it deliberately no longer re-checks on each request is in docs/runtime-contract.md.
 */
final class InstallMarker
{
    public const OPTION = 'first_installed';

    /** Options the install checks read or write: a change to any of them means checking again. */
    private const WATCHED = [
        'first_runtime_tables', ZeroNames::DONE, Jobs\ActionSchedulerQueue::PREPARED, 'first_search_shape', 'first_kind_urls',
        'first_polylang_languages', 'first_schema_apply_granted', 'first_upload_namespace', 'active_plugins', 'active_sitewide_plugins',
    ];

    /** @var array<int, bool> blog id => whether the marker matched, read once per site per request */
    private static array $current = [];

    public static function register(): void
    {
        add_action('added_option', static fn (string $option) => self::watches($option) && self::forget(), 10, 1);
        add_action('updated_option', static fn (string $option) => self::watches($option) && self::forget(), 10, 1);
        add_action('deleted_option', static fn (string $option) => self::watches($option) && self::forget(), 10, 1);
        // A recurring action of First's cancelled (Tools > Scheduled Actions): the next request schedules it again.
        add_action('action_scheduler_canceled_action', static fn () => self::forget(), 10, 0);
        add_action('wp_loaded', [self::class, 'record'], PHP_INT_MAX);
    }

    /** Whether this request may skip the install checks: the marker matches this build. */
    public static function current(): bool
    {
        // Per site: on multisite, after switch_to_blog() another site's options decide.
        $blog = get_current_blog_id();
        if (isset(self::$current[$blog])) {
            return self::$current[$blog];
        }
        $plugin = Plugin::instance();
        if ($plugin === null || Runtime::managed()) {
            return false;
        }

        return self::$current[$blog] = get_option(self::OPTION) === self::key($plugin);
    }

    /** Drop the marker: the next check runs every install step again. Returns true, for use in expressions. */
    public static function forget(): bool
    {
        self::$current[get_current_blog_id()] = false;
        if (get_option(self::OPTION) !== false) {
            delete_option(self::OPTION);
        }

        return true;
    }

    /** wp_loaded, last: record the marker once every install check passes when read again now. */
    public static function record(): void
    {
        $plugin = Plugin::instance();
        if ($plugin === null || Runtime::managed() || Runtime::plugin() !== $plugin || self::current() || !self::verified($plugin)) {
            return;
        }
        update_option(self::OPTION, self::key($plugin), true);
        self::$current[get_current_blog_id()] = true;
    }

    private static function watches(string $option): bool
    {
        return in_array($option, self::WATCHED, true) || preg_match('/\Afirst_[a-z0-9_-]+_(schema|refused|route_pages|content)\z/', $option) === 1;
    }

    private static function key(Plugin $plugin): string
    {
        // The active plugins are part of it: a plugin the install depends on (activated, deactivated,
        // or network-activated, which on multisite changes sitemeta and fires no option hook of this
        // site) means checking again. Both lists are already loaded on every request.
        $network = is_multisite() ? array_keys((array) get_site_option('active_sitewide_plugins', [])) : [];
        sort($network);

        return substr(hash('sha256', implode("\0", [
            $plugin->schema->name(), $plugin->buildHash(), Runtime::tablesVersion(), Runtime::VERSION,
            defined('FIRST_RUNTIME_HASH') ? (string) FIRST_RUNTIME_HASH : '', gmdate('Y-m-d'),
            implode(',', (array) get_option('active_plugins', [])), implode(',', $network),
        ])), 0, 32);
    }

    /** Every install step's own check, read past the option caches. */
    private static function verified(Plugin $plugin): bool
    {
        if ($plugin->unavailable() !== null) {
            return false;
        }
        foreach (['first_runtime_tables', ZeroNames::DONE] as $option) {
            wp_cache_delete($option, 'options');
        }
        if (ZeroNames::pending() || get_option('first_runtime_tables') !== Runtime::tablesVersion() || !$plugin->installed()) {
            return false;
        }
        if (function_exists('as_has_scheduled_action') && class_exists(\ActionScheduler::class, false) && \ActionScheduler::is_initialized()
            && !(Jobs\ActionSchedulerQueue::installed() && Guests::installed() && Uploads::installed())) {
            return false;
        }
        // A localized app's languages are provisioned on a request where Polylang is set up (REST,
        // cron, CLI, admin); a front-end request on a site with no language yet has no PLL(), so it
        // can't provision, and must not record the marker that would skip provisioning after it.
        $locales = $plugin->schema->locales();
        if ($locales !== null && !Polylang::installed($locales)) {
            return false;
        }

        return KindUrls::recorded() && ContentPages::plan() === [] && RoutePages::plan() === []
            && !\First\Search\Index::shapeChanged() && \First\RuntimeSchema\Surfaces::granted();
    }
}
