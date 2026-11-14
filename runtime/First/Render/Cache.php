<?php

declare(strict_types=1);

namespace First\Render;

use First\Extensions;
use First\SystemTables;
use First\Wp\CompositeStore;

use function First\db;

/**
 * Cache policy and URL purges for `first/app/` pages (docs/spec/rendering.md §6.1, §6.2).
 *
 * Policy, per response, from what the render was:
 * - an anonymous visitor's 200 render of a page no layout guards is **cacheable**:
 *   `Cache-Control: public, s-maxage=<window>, max-age=0, must-revalidate`, so Batcache and the
 *   edge keep it for everyone (a twin is always rendered as an anonymous visitor too);
 * - anything else (a signed-in viewer, a guarded section, an error, a 404) is
 *   `private, no-store`, and calls `batcache_cancel()` where Batcache runs.
 *
 * Purges: each cacheable render records the rows it read in `first__app_reads` (kind, id or `*`
 * for a listing, URL path with its query). On a committed write to a kind, the URLs that read that
 * row, and every URL that listed the kind, are announced on the host's `first_purge_urls` action
 * with their `.md` twins (`Wp\Purges::paths`), the same channel WordPress content writes use.
 * A write that touches more than PURGE_LIMIT URLs announces `/*` instead: a whole-host purge.
 * Nothing is recorded or announced when no host listens (`has_action('first_purge_urls')`).
 */
final class Cache
{
    /** The edge window for a cacheable page, in seconds; `first_app_cache_window` changes it. */
    public const WINDOW = 300;
    /** Above this many URLs, one write purges the whole host. */
    public const PURGE_LIMIT = 200;
    /** Rows recorded per render; a page that reads more records its kinds as listings. */
    public const MAX_IDS = 500;

    /** @var array<string, true> paths this request's writes changed */
    private static array $pending = [];
    private static bool $armed = false;

    public static function register(): void
    {
        $text = 'COLLATE utf8mb4_bin';
        $tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
        // `item` is the row's id as text, or `*` for "this URL listed the kind".
        SystemTables::register('__first_app_reads', [
            "CREATE TABLE IF NOT EXISTS `{prefix}first__app_reads` (`kind` VARCHAR(191) $text NOT NULL, `item` VARCHAR(191) $text NOT NULL, `url` VARCHAR(512) $text NOT NULL, `seenAt` CHAR(24) NOT NULL, PRIMARY KEY (`kind`, `item`, `url`(191)), KEY `url` (`url`(191))) $tail",
        ]);
        Extensions::onWritten(self::written(...));
    }

    /** A host's page cache listens for purges, or prebuilt pages need to know what changed. */
    private static function listening(): bool
    {
        return function_exists('has_action') && (has_action('first_purge_urls') !== false || Prebuilt::active());
    }

    /**
     * The `Cache-Control` for a router response, and whether Batcache may keep it.
     *
     * @return array{string, bool}
     */
    public static function policy(int $status, bool $anonymous, bool $guarded): array
    {
        if ($status === 200 && $anonymous && !$guarded) {
            $window = max(0, (int) apply_filters('first_app_cache_window', self::WINDOW));
            return ["public, s-maxage=$window, max-age=0, must-revalidate", true];
        }
        return ['private, no-store, max-age=0', false];
    }

    /**
     * Records what a cacheable render of `$uri` read, replacing what that URL read before.
     *
     * @param array<string, array{ids: list<int|string>, listed: bool}> $reads
     */
    public static function record(string $uri, array $reads): void
    {
        // A prerender records what it read, so a write knows which prebuilt URLs it changed.
        if (!self::listening() && !Prebuilt::prerendering()) {
            return;
        }
        $url = self::path($uri);
        $rows = [];
        foreach ($reads as $kind => $read) {
            if ($read['listed'] || count($read['ids']) > self::MAX_IDS) {
                $rows[] = [$kind, '*'];
            }
            if (count($read['ids']) <= self::MAX_IDS) {
                foreach ($read['ids'] as $id) {
                    $rows[] = [$kind, (string) $id];
                }
            }
        }
        $now = gmdate('Y-m-d\TH:i:s.000\Z');
        self::run('DELETE FROM {reads} WHERE "url" = ?', [$url]);
        foreach ($rows as [$kind, $item]) {
            self::run('INSERT IGNORE INTO {reads} ("kind", "item", "url", "seenAt") VALUES (?, ?, ?, ?)', [$kind, $item, $url, $now]);
        }
    }

    /** Extensions::onWritten: inside the write's transaction; announces after commit. */
    public static function written(string $op, string $collection, array $row, ?array $previous): void
    {
        if (!self::listening()) {
            return;
        }
        $spec = db()->schema()->collections()[$collection] ?? null;
        if ($spec === null) {
            return;
        }
        $pk = $spec['primaryKey'] ?? 'id';
        $id = $row[$pk] ?? $previous[$pk] ?? null;
        $found = self::run(
            'SELECT DISTINCT "url" FROM {reads} WHERE "kind" = ? AND ("item" = ? OR "item" = ?)',
            [$collection, '*', (string) $id],
        );
        foreach ($found as $r) {
            self::$pending[(string) $r['url']] = true;
        }
        if (self::$armed || self::$pending === []) {
            return;
        }
        self::$armed = true;
        $store = db()->store();
        if ($store instanceof CompositeStore) {
            $store->db->onRollback(static function (): void {
                self::$pending = [];
                self::$armed = false;
            });
        }
        Extensions::afterCommit(self::flush(...));
    }

    public static function flush(): void
    {
        $urls = array_keys(self::$pending);
        self::$pending = [];
        self::$armed = false;
        if ($urls === [] || !self::listening()) {
            return;
        }
        $paths = count($urls) > self::PURGE_LIMIT ? ['/*'] : \First\Wp\Purges::paths(array_map('home_url', $urls));
        Prebuilt::stale($paths);
        if (has_action('first_purge_urls') !== false) {
            do_action('first_purge_urls', $paths);
        }
    }

    /** A request URI as stored: the path below the home path, with its query string. */
    private static function path(string $uri): string
    {
        $base = rtrim((string) (wp_parse_url(home_url('/'), PHP_URL_PATH) ?? '/'), '/');
        $path = (string) (wp_parse_url($uri, PHP_URL_PATH) ?? '/');
        $query = (string) (wp_parse_url($uri, PHP_URL_QUERY) ?? '');
        if ($base !== '' && str_starts_with($path, $base)) {
            $path = substr($path, strlen($base)) ?: '/';
        }
        return substr($path . ($query !== '' ? '?' . $query : ''), 0, 512);
    }

    /** @param list<int|float|string|null> $params @return list<array<string, mixed>> */
    private static function run(string $sql, array $params): array
    {
        $store = db()->store();
        if (!$store instanceof CompositeStore) {
            return [];
        }
        $sql = str_replace('{reads}', '"' . $store->db->prefix() . 'first__app_reads"', $sql);
        return $store->db->run(str_replace('"', '`', $sql), $params);
    }
}
