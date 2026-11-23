<?php

declare(strict_types=1);

namespace SpacePress\Wp;

/**
 * What an inspection reads, without changing anything, from a site a pre-release runtime installed,
 * before {@see BrandUpgrade} moves it: the move runs when a build is installed, after the plan that
 * decides whether to install it.
 */
final class Legacy
{
    /** The migration ledger as a pre-release runtime named it, and as the move names it. */
    private const LEDGERS = ['tp__migrations', 'sp__migrations'];

    /**
     * The ids a pre-release runtime recorded for `$app` (or for its earlier name, for an app renamed
     * with the brand), while the move hasn't finished; empty once it has. A move that stopped after
     * renaming the tables leaves the rows in the current ledger, still under the app's earlier name.
     *
     * @return list<string>
     */
    public static function applied(Connection $db, string $app): array
    {
        if (BrandUpgrade::done()) {
            return [];
        }
        $names = array_map(static fn (string $t): string => $db->prefix() . $t, self::LEDGERS);
        $found = $db->sqlite()
            ? $db->run("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)", $names)
            : $db->run('SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)', $names);
        $ids = [];
        foreach (array_intersect($names, array_column($found, 'n')) as $ledger) {
            $ids = [...$ids, ...array_column($db->run("SELECT `id` FROM `$ledger` WHERE `app` IN (?, ?)", [$app, BrandUpgrade::historyApp($app)]), 'id')];
        }

        return array_map('strval', $ids);
    }
}
