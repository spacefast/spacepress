<?php

declare(strict_types=1);

namespace SpacePress\Identity;

/**
 * Identity's own storage as a pre-release build kept it, moved to the current names when this plugin
 * runs without the SpacePress runtime (a site that uses identity alone). With the runtime, the
 * runtime's move (SpacePress\Wp\BrandUpgrade) takes identity's share as part of the whole site's,
 * and this does nothing.
 *
 * Forward only, nothing deleted: the tables are renamed (accounts, sessions, passkeys, keys keep
 * every row), the options renamed, the maintenance and inventory events kept with their schedule.
 * The whole set is checked first: when any new name is taken, nothing changes.
 */
final class Legacy
{
    private const SHORT = 'tp_identity_';
    private const OPTIONS = ['schema_version', 'signing_keys', 'webhooks', 'dummy_password_hash', 'password_profiles', 'password_inventory'];
    private const EVENTS = ['maintenance', 'password_inventory'];
    private const SCHEDULE = 'tp_identity_minute';
    /** Schema::migrateLocked()'s tables. */
    private const TABLES = ['accounts', 'emails', 'providers', 'sessions', 'challenges', 'applications', 'codes', 'tokens', 'events', 'limits', 'organizations', 'members', 'passkeys', 'mfa', 'recovery_codes', 'deliveries'];

    /** Whether identity's schema version is stored under the earlier name: one indexed read. */
    public static function stored(): bool
    {
        global $wpdb;

        return $wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$wpdb->options} WHERE option_name = %s", self::SHORT . 'schema_version')) !== null;
    }

    /** Whether there is identity storage under the earlier name the runtime hasn't moved. */
    public static function pending(): bool
    {
        return (int) get_option('sp_brand_upgrade', 0) < 1 && self::stored();
    }

    /** Moves identity's storage when the runtime isn't here to move the whole site. */
    public static function move(\wpdb $wp): void
    {
        if (class_exists(\SpacePress\Wp\BrandUpgrade::class) || !self::pending()) {
            return;
        }
        $lock = 'spacepress:' . substr(hash('sha256', DB_NAME . ':' . $wp->prefix . ':sp_brand_upgrade'), 0, 40);
        if ((int) $wp->get_var($wp->prepare('SELECT GET_LOCK(%s, 10)', $lock)) !== 1 && !($wp->dbh instanceof \PDO)) {
            return;
        }
        try {
            wp_cache_delete('sp_brand_upgrade', 'options');
            if (!self::pending()) {
                return;
            }
            $tables = [];
            foreach (self::TABLES as $name) {
                $from = $wp->prefix . self::SHORT . $name;
                $to = $wp->prefix . 'sp_identity_' . $name;
                if (self::table($wp, $from)) {
                    if (self::table($wp, $to)) {
                        throw new Failure('storage_unavailable', "Identity storage exists under both $from and $to; keep the one this site uses and move the other aside, then reload. Nothing was changed.", 503);
                    }
                    $tables[$from] = $to;
                }
            }
            foreach (self::OPTIONS as $name) {
                if ($wp->get_var($wp->prepare("SELECT 1 FROM {$wp->options} WHERE option_name = %s", 'sp_identity_' . $name)) !== null
                    && $wp->get_var($wp->prepare("SELECT 1 FROM {$wp->options} WHERE option_name = %s", self::SHORT . $name)) !== null) {
                    // A fresh boot's provisioning wrote it moments ago; the site's stored value wins.
                    $wp->delete($wp->options, ['option_name' => 'sp_identity_' . $name]);
                }
            }
            if ($tables !== []) {
                if ($wp->dbh instanceof \PDO) {
                    $pdo = method_exists($wp->dbh, 'get_sqlite_pdo') ? $wp->dbh->get_sqlite_pdo() : $wp->dbh;
                    $pdo->beginTransaction();
                    try {
                        foreach ($tables as $from => $to) {
                            $pdo->exec('ALTER TABLE "' . $from . '" RENAME TO "' . $to . '"');
                            foreach (['tables', 'columns', 'statistics', 'table_constraints', 'key_column_usage'] as $meta) {
                                $pdo->prepare('UPDATE "_wp_sqlite_mysql_information_schema_' . $meta . '" SET TABLE_NAME = ? WHERE TABLE_NAME = ?')->execute([$to, $from]);
                            }
                            foreach ($pdo->query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = " . $pdo->quote($to) . ' AND sql IS NOT NULL')->fetchAll(\PDO::FETCH_ASSOC) as $index) {
                                if (str_starts_with((string) $index['name'], $from . '__')) {
                                    $pdo->exec('DROP INDEX "' . $index['name'] . '"');
                                    $pdo->exec((string) preg_replace('/^(CREATE (?:UNIQUE )?INDEX )(?:`(?:[^`]|``)+`|"(?:[^"]|"")+")/', '$1"' . $to . substr((string) $index['name'], strlen($from)) . '"', (string) $index['sql'], 1));
                                }
                            }
                        }
                        $pdo->commit();
                    } catch (\Throwable $e) {
                        $pdo->rollBack();
                        throw $e;
                    }
                } else {
                    $wp->query('RENAME TABLE ' . implode(', ', array_map(static fn ($from, $to) => "`$from` TO `$to`", array_keys($tables), $tables)));
                }
            }
            foreach (self::OPTIONS as $name) {
                $wp->update($wp->options, ['option_name' => 'sp_identity_' . $name], ['option_name' => self::SHORT . $name]);
            }
            $cron = _get_cron_array();
            if (is_array($cron)) {
                foreach ($cron as $time => $hooks) {
                    foreach (self::EVENTS as $event) {
                        foreach ((array) ($hooks[self::SHORT . $event] ?? []) as $key => $job) {
                            $job['schedule'] = ($job['schedule'] ?? null) === self::SCHEDULE ? 'sp_identity_minute' : ($job['schedule'] ?? false);
                            $cron[$time]['sp_identity_' . $event][$key] = $job;
                        }
                        unset($cron[$time][self::SHORT . $event]);
                    }
                }
                _set_cron_array($cron);
            }
            wp_cache_flush();
        } finally {
            $wp->dbh instanceof \PDO || $wp->query($wp->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        }
    }

    private static function table(\wpdb $wp, string $name): bool
    {
        return $wp->dbh instanceof \PDO
            ? $wp->get_var($wp->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = %s", $name)) !== null
            : $wp->get_var($wp->prepare('SHOW TABLES LIKE %s', $wp->esc_like($name))) === $name;
    }
}
