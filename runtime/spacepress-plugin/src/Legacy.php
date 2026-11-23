<?php
declare(strict_types=1);

namespace SpacePressPlugin;

/**
 * What a site deployed with the pre-release deploy plugin keeps, moved to this plugin's names before
 * the plugin reads or writes any of it, and the earlier credential restrictions honoured until the
 * runtime has moved the rest of the site (SpacePress\Wp\BrandUpgrade).
 *
 * The deploy plugin's own state (the store key and the store directory named by it, the live build,
 * the history, pending deployments) is this plugin's alone, so it moves here, on `plugins_loaded`
 * priority 0, under a MySQL named lock: once, in place, nothing deleted. The history is never pruned
 * and keeps every entry as written. The store directory is renamed, not copied: the builds in it are
 * named by the hash of their bytes and stay valid.
 */
final class Legacy
{
    private const LEGACY = 'typedpress';
    /** Option names the earlier deploy plugin wrote => this plugin's. */
    private const OPTIONS = ['tp_store_key' => Site::KEY, 'tp_live_build' => Site::LIVE, 'tp_deployments' => Site::HISTORY, 'tp_pending_deployments' => Site::PENDING];
    /** The key an application password's scope had on its entry. */
    public const SCOPE = 'tp_scope';
    /** Where identity kept accounts before the move. */
    private const ACCOUNTS = 'tp_identity_accounts';
    private const DONE = 'sp_deploy_upgrade';

    public static function register(): void
    {
        add_action('plugins_loaded', [self::class, 'move'], 0);
    }

    /** Moves the deploy plugin's state once; a site with none records that and changes nothing. */
    public static function move(): void
    {
        if ((int) get_option(self::DONE, 0) === 1) {
            return;
        }
        global $wpdb;
        $lock = 'spacepress-deploy:' . substr(hash('sha256', DB_NAME . ':' . $wpdb->prefix), 0, 40);
        if ((int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 10)', $lock)) !== 1 && !($wpdb->dbh instanceof \PDO)) {
            return; // another request is moving it; this one serves without the app, as before an upload
        }
        try {
            wp_cache_delete(self::DONE, 'options');
            if ((int) get_option(self::DONE, 0) === 1) {
                return;
            }
            $key = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'tp_store_key'));
            if (is_string($key) && preg_match('/\A[0-9a-f]{32}\z/D', $key) === 1 && !(defined('SP_STORE_DIR') && is_string(SP_STORE_DIR) && SP_STORE_DIR !== '')) {
                $from = WP_CONTENT_DIR . '/' . self::LEGACY . '-store-' . $key;
                $to = WP_CONTENT_DIR . '/spacepress-store-' . $key;
                if (is_dir($from) && !is_link($from)) {
                    if (file_exists($to) && !self::empty($to)) {
                        throw new \RuntimeException("Both $from and $to exist; keep the one this site deploys from and move the other aside, then reload.");
                    }
                    if (is_dir($to)) {
                        rmdir($to);
                    }
                    if (!rename($from, $to)) {
                        throw new \RuntimeException("Cannot move $from to $to");
                    }
                }
            }
            foreach (self::OPTIONS as $old => $new) {
                $value = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $old));
                if ($value === null) {
                    continue;
                }
                // The earlier value is the site's; one written under the new name since can only be a
                // fresh key or empty state from a request that ran before this move.
                $wpdb->delete($wpdb->options, ['option_name' => $new]);
                $wpdb->update($wpdb->options, ['option_name' => $new], ['option_name' => $old]);
                wp_cache_delete($old, 'options');
                wp_cache_delete($new, 'options');
            }
            wp_cache_delete('alloptions', 'options');
            update_option(self::DONE, 1, true);
        } catch (\Throwable $error) {
            error_log('[spacepress] ' . $error->getMessage());
        } finally {
            $wpdb->dbh instanceof \PDO || $wpdb->query($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    /**
     * Whether the site has finished moving its stored names. Until then an application password may
     * still carry its scope under the earlier key, and an account's status may sit in the earlier
     * identity table.
     */
    public static function settled(): bool
    {
        $done = get_option('sp_brand_upgrade', 0);

        return $done !== 'started' && (int) $done >= 1;
    }

    /** The application password's scope under the earlier key, before the site's move; null without one. */
    public static function scoped(array $password): bool
    {
        return !self::settled() && array_key_exists(self::SCOPE, $password);
    }

    /** The earlier identity table, while the site hasn't moved it. */
    public static function accounts(): ?string
    {
        global $wpdb;
        $table = $wpdb->prefix . self::ACCOUNTS;

        return !self::settled() && $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table ? $table : null;
    }

    private static function empty(string $dir): bool
    {
        return is_dir($dir) && !is_link($dir) && array_diff(scandir($dir) ?: [], ['.', '..']) === [];
    }
}
