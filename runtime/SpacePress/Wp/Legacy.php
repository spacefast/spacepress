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
    /** The migration ledger as a pre-release runtime named it. */
    private const LEDGER = 'tp__migrations';

    /**
     * The ids a pre-release runtime recorded for `$app` (or for its earlier name, for an app renamed
     * with the brand), while the move hasn't carried them to the current ledger; empty once it has.
     *
     * @return list<string>
     */
    public static function applied(Connection $db, string $app): array
    {
        if (BrandUpgrade::done()) {
            return [];
        }
        $ledger = $db->prefix() . self::LEDGER;
        $found = $db->sqlite()
            ? $db->run("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [$ledger])
            : $db->run('SELECT 1 AS x FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$ledger]);
        if ($found === []) {
            return [];
        }

        return array_map('strval', array_column($db->run("SELECT `id` FROM `$ledger` WHERE `app` IN (?, ?)", [$app, BrandUpgrade::historyApp($app)]), 'id'));
    }
}
