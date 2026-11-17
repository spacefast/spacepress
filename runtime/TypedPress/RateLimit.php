<?php

declare(strict_types=1);

namespace TypedPress;

use function TypedPress\db;

/**
 * `rateLimit: "10/min"` on a query or mutation: at most `count` calls per `window` seconds, counted per
 * signed-in user, or per address when signed out. A call over the limit answers 429 `rate_limited`, and
 * the message says how many seconds are left in the window.
 *
 * Windows are fixed and counted with transients, the store core keeps for short-lived values (the options
 * table, or the persistent object cache when the site has one). The count is taken inside the call's
 * transaction; a call that fails rolls it back, so the count is written again after the rollback: a
 * failed call still counts. Forwarded-for headers are not an identity source: REMOTE_ADDR is what the
 * server saw.
 */
final class RateLimit
{
    /** @param array{count: int, window: int} $limit */
    public static function check(string $action, array $limit, ?array $user): void
    {
        if (!function_exists('get_transient')) {
            return; // no WordPress (the standalone runtime and its tests): nothing to count in
        }
        $window = max(1, (int) $limit['window']);
        $now = time();
        $bucket = intdiv($now, $window);
        $who = $user !== null ? 'u' . $user['id'] : 'a' . ($_SERVER['REMOTE_ADDR'] ?? 'local');
        $key = 'tp_rate_' . substr(hash('sha256', $action . "\0" . $who . "\0" . $window . "\0" . $bucket), 0, 32);
        $used = (int) get_transient($key);
        if ($used >= (int) $limit['count']) {
            $retry = ($bucket + 1) * $window - $now;
            throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in ' . $retry . ' second' . ($retry === 1 ? '' : 's') . '.');
        }
        set_transient($key, $used + 1, $window + 1);
        // Without a persistent object cache the transient is an option row, written in the call's
        // transaction. After a rollback, the option cache still holds the count the database lost:
        // forget it, then write the count again.
        $store = db()->store();
        if ($store instanceof \TypedPress\Wp\CompositeStore) {
            $store->db->onRollback(static function () use ($key, $used, $window): void {
                foreach (["_transient_$key", "_transient_timeout_$key", 'alloptions', 'notoptions'] as $cached) {
                    wp_cache_delete($cached, 'options');
                }
                set_transient($key, $used + 1, $window + 1);
            });
        }
    }
}
