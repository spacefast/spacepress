<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * When lazy scheduled promotion ({@see \First\Db::promoteDue()}) next needs to scan a table-backed kind
 * with drafts: one autoloaded option per app, `first_<app>_due_at`, an ISO timestamp. Until it comes,
 * a request runs no promotion query at all (the option is already in memory).
 *
 * - A row First schedules lowers it to the row's `publishedAt` when the write commits ({@see scheduled()}),
 *   so that row is still published by the first request at or after its time.
 * - Each scan sets it to the earliest scheduled row it left, or LOOK seconds from now when that is later
 *   ({@see scanned()}), so a row scheduled another way (SQL, an import) is published at most LOOK
 *   seconds late.
 *
 * Both writes are compare-and-set in SQL, so concurrent requests never raise a time another request
 * lowered. Post-backed kinds are WordPress posts: core's cron publishes them, and they cost no scan.
 */
final class DueRows
{
    /** The longest a row scheduled outside First waits past its time, in seconds. */
    public const LOOK = 60;

    public static function option(string $app): string
    {
        return 'first_' . $app . '_due_at';
    }

    /** Whether promotion should scan now: the recorded time has come, or none is recorded. */
    public static function due(string $app, string $nowIso): bool
    {
        $at = get_option(self::option($app));

        return !is_string($at) || $at <= $nowIso;
    }

    /**
     * A scan at $nowIso found $earliest (the first row still scheduled, or null): look again then, or
     * after LOOK seconds, whichever is sooner. A recorded time still in the future was lowered by a
     * write that committed after the scan began, so the earlier of the two is kept.
     */
    public static function scanned(Connection $db, string $app, string $nowIso, ?string $earliest): void
    {
        $look = \First\Js::iso(\First\Js::date($nowIso) + self::LOOK * 1000);
        $next = $earliest !== null && $earliest < $look ? $earliest : $look;
        $options = $db->wpdb()->options;
        $name = self::option($app);
        $db->run("INSERT INTO `$options` (`option_name`, `option_value`, `autoload`) VALUES (?, ?, 'on') ON DUPLICATE KEY UPDATE `option_value` = "
            . "CASE WHEN `option_value` <= ? OR `option_value` = '' OR `option_value` > VALUES(`option_value`) THEN VALUES(`option_value`) ELSE `option_value` END",
            [$name, $next, $nowIso]);
        self::forget($name);
    }

    /** A row First scheduled for $atIso: look no later than then. */
    public static function scheduled(Connection $db, string $app, string $atIso): void
    {
        $options = $db->wpdb()->options;
        $name = self::option($app);
        $db->run("INSERT INTO `$options` (`option_name`, `option_value`, `autoload`) VALUES (?, ?, 'on') ON DUPLICATE KEY UPDATE `option_value` = "
            . "CASE WHEN `option_value` = '' OR `option_value` > VALUES(`option_value`) THEN VALUES(`option_value`) ELSE `option_value` END", [$name, $atIso]);
        self::forget($name);
    }

    private static function forget(string $name): void
    {
        wp_cache_delete($name, 'options');
        wp_cache_delete('alloptions', 'options');
        wp_cache_delete('notoptions', 'options');
    }
}
