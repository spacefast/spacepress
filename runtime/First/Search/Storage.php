<?php

declare(strict_types=1);

namespace First\Search;

use function First\db;

/**
 * SQL on `first__search`, on the active store's connection (the request's transaction), with the
 * two ways a term matches: MySQL and MariaDB use the FULLTEXT index in boolean mode; the SQLite
 * translator, which accepts the index but not `MATCH ... AGAINST`, matches word prefixes with `LIKE`.
 */
final class Storage
{
    private static ?bool $ready = null;

    /** @param list<int|float|string|null> $params @return list<array<string, mixed>> */
    public static function run(string $sql, array $params = []): array
    {
        $store = db()->store();
        if (!$store instanceof \First\Wp\CompositeStore) {
            throw new \LogicException('First search needs the WordPress store');
        }

        return $store->db->run(str_replace(['{search}', '"'], [self::table(), '`'], $sql), $params);
    }

    /** The table, quoted and prefixed. */
    public static function table(): string
    {
        $store = db()->store();
        $prefix = $store instanceof \First\Wp\CompositeStore ? $store->db->prefix() : 'wp_';

        return '`' . $prefix . Index::TABLE . '`';
    }

    /** Whether the table exists yet: a write before the plugin's first upgrade check indexes nothing. */
    public static function ready(): bool
    {
        if (self::$ready === true) {
            return true;
        }
        $store = db()->store();
        if (!$store instanceof \First\Wp\CompositeStore) {
            return false;
        }
        try {
            $store->db->run('SELECT 1 FROM ' . self::table() . ' LIMIT 1');

            return self::$ready = true;
        } catch (\Throwable) {
            return false;
        }
    }

    /** Whether the connection is the SQLite translator, which has no `MATCH ... AGAINST`. */
    public static function translated(): bool
    {
        return db()->store()->dialect()->translated;
    }

    /**
     * One condition per term, on `s.body`, with its parameters. A term matches a word that starts
     * with it, so `wor` finds `world`.
     *
     * @param list<string> $terms
     * @return list<array{string, list<string>}>
     */
    public static function match(array $terms): array
    {
        $out = [];
        foreach ($terms as $term) {
            if (self::translated()) {
                // FIRST_WORD_PREFIX (Wp\Connection): a word of the text starts with the term, with
                // Unicode case folding as the MySQL collations do.
                $out[] = ['FIRST_WORD_PREFIX(s.`body`, ?) = 1', [$term]];
            } else {
                $out[] = ['MATCH (s.`body`) AGAINST (? IN BOOLEAN MODE)', ['+' . $term . '*']];
            }
        }

        return $out;
    }
}
