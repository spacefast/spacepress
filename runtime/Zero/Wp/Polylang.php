<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\Locale\GroupSync;
use Zero\Schema;

/**
 * The Polylang adapter for localized post-backed collections (§7.3). Polylang owns each post's
 * language (`language` taxonomy) and its translation group (`post_translations` taxonomy); Zero
 * writes them through Polylang's public API (`pll_set_post_language`, `pll_save_post_translations`)
 * and reads them in SQL as term subqueries, so `locale`, `translations` and the locale rule compile
 * like any other column. Polylang languages are created from `locales.all` on activation.
 */
final class Polylang
{
    /** @var list<array{string, string, int|string}> [collection, locale, source id] of API creates joining a group */
    private static array $pending = [];
    private static bool $busy = false;

    public static function boot(): void
    {
        add_filter('pll_get_post_types', static function (mixed $types, mixed $hide): array {
            $types = (array) $types;
            foreach (self::postTypes() as $type) {
                if ($hide) {
                    unset($types[$type]); // Zero decides; keep it out of Polylang's settings screen
                } else {
                    $types[$type] = $type;
                }
            }

            return $types;
        }, 10, 2);
        // Zero syncs its own columns in the pipeline; Polylang's live meta sync would pre-empt it.
        add_filter('pll_copy_post_metas', static fn (mixed $metas, mixed $sync): array => $sync && self::zeroWriting() ? [] : (array) $metas, 100, 2);
        // A group linked outside Zero's API (wp-admin "+", pll_save_post_translations): adopt synced columns.
        add_action('set_object_terms', static function (int $objectId, mixed $terms, mixed $ttIds, string $taxonomy): void {
            if ($taxonomy === 'post_translations' && !self::$busy && !self::zeroWriting()) {
                self::adopt($objectId);
            }
        }, 10, 4);
        add_action('activated_plugin', static function (): void {
            self::ensureLanguages();
        });
        add_action('admin_init', static function (): void {
            $schema = Runtime::plugin()?->schema;
            if ($schema?->locales() !== null && get_option('zero_polylang_languages') !== implode(',', $schema->locales()['all'])) {
                self::ensureLanguages();
            }
        });
    }

    /** Polylang language slugs are lowercase; Zero locales may carry a region in caps (pt-BR). */
    public static function slug(string $locale): string
    {
        return strtolower($locale);
    }

    /**
     * Source refs on wp_posts ($prefix: the WP table prefix): `locale` (the language term slug mapped back to the configured
     * locale), `translationGroup` (the post_translations term), `translations` (computed by Sql).
     */
    public static function ref(string $col, string $prefix, array $locales): ColumnRef
    {
        $term = static fn (string $taxonomy, string $field): string => "(SELECT {a}_pll_t.$field FROM `{$prefix}term_relationships` {a}_pll_r"
            . " JOIN `{$prefix}term_taxonomy` {a}_pll_t ON {a}_pll_t.term_taxonomy_id = {a}_pll_r.term_taxonomy_id"
            . ($field === 'slug' ? " JOIN `{$prefix}terms` {a}_pll_n ON {a}_pll_n.term_id = {a}_pll_t.term_id" : '')
            . " WHERE {a}_pll_r.object_id = {a}.ID AND {a}_pll_t.taxonomy = '$taxonomy' LIMIT 1)";
        if ($col === 'locale') {
            $slug = str_replace('{a}_pll_t.slug', '{a}_pll_n.slug', $term('language', 'slug'));
            $case = 'CASE ' . $slug;
            foreach ($locales as $l) {
                $case .= " WHEN '" . addslashes(self::slug($l)) . "' THEN '" . addslashes($l) . "'";
            }

            return new ColumnRef($case . ' END', '', '', 'scalar');
        }
        if ($col === 'translationGroup') {
            return new ColumnRef($term('post_translations', 'term_taxonomy_id'), '', '', 'scalar');
        }

        return new ColumnRef('NULL', '', '', 'json');
    }

    /** After WpPostStore::insert: set the language and join the group a `translationOf` create asked for. */
    public static function assign(string $collection, int $id, string $locale): void
    {
        self::busy(static fn () => pll_set_post_language($id, self::slug($locale)));
        foreach (array_reverse(self::$pending, true) as $i => [$c, $l, $source]) {
            if ($c === $collection && $l === $locale) {
                array_splice(self::$pending, $i, 1);
                $group = pll_get_post_translations((int) $source);
                $group[self::slug((string) pll_get_post_language((int) $source))] = (int) $source;
                $group[self::slug($locale)] = $id;
                self::busy(static fn () => pll_save_post_translations($group));
                break;
            }
        }
    }

    /** GroupSync: the next insert of $collection in $locale joins $source's group. */
    public static function pend(string $collection, string $locale, int|string $source): void
    {
        self::$pending[] = [$collection, $locale, $source];
        Runtime::plugin()?->connection()->onRollback(static function (): void {
            self::$pending = [];
        });
    }

    /** Create every configured locale missing from Polylang; the default locale becomes Polylang's default. */
    public static function ensureLanguages(): void
    {
        $schema = Runtime::plugin()?->schema;
        $locales = $schema?->locales();
        if ($locales === null || !function_exists('PLL') || !function_exists('pll_languages_list')) {
            return;
        }
        $have = array_map('strval', (array) pll_languages_list(['fields' => 'slug']));
        $ordered = array_values(array_unique([$locales['default'], ...$locales['all']]));
        foreach ($ordered as $i => $locale) {
            if (in_array(self::slug($locale), $have, true)) {
                continue;
            }
            [$lang, $region] = array_pad(explode('-', $locale, 2), 2, null);
            $wpLocale = $region !== null ? $lang . '_' . strtoupper($region) : ($lang === 'en' ? 'en_US' : $lang . '_' . strtoupper($lang));
            $added = PLL()->model->add_language(['locale' => $wpLocale, 'slug' => self::slug($locale), 'name' => $locale, 'term_group' => $i]);
            if ($added instanceof \WP_Error) {
                throw new \RuntimeException("Polylang could not add $locale: " . $added->get_error_message());
            }
        }
        update_option('zero_polylang_languages', implode(',', $locales['all']), false);
    }

    /** @return list<string> post types of localized post-backed collections */
    private static function postTypes(): array
    {
        $schema = Runtime::plugin()?->schema;
        if ($schema?->locales() === null) {
            return [];
        }
        $out = [];
        foreach ($schema->collections() as $spec) {
            if (($spec['localized'] ?? false) && ($spec['editor'] ?? true) && isset($spec['wp']['postType'])) {
                $out[] = $spec['wp']['postType'];
            }
        }

        return $out;
    }

    /** Every member of $postId's group adopts the group's synced values (links arrive one post at a time). */
    private static function adopt(int $postId): void
    {
        $plugin = Runtime::plugin();
        $type = get_post_type($postId);
        if ($plugin === null || !in_array($type, self::postTypes(), true)) {
            return;
        }
        foreach ($plugin->schema->collections() as $name => $spec) {
            if (($spec['wp']['postType'] ?? null) !== $type) {
                continue;
            }
            $db = $plugin->db();
            $db->transaction(static function () use ($db, $name, $spec, $postId): void {
                $row = $db->editorRow((string) $name, $postId);
                foreach ($row === null ? [] : \Zero\Locale\Module::members($row, $spec['primaryKey']) as $id) {
                    $member = $db->editorRow((string) $name, $id);
                    if ($member !== null) {
                        GroupSync::adopt((string) $name, $member);
                    }
                }
            });

            return;
        }
    }

    private static function zeroWriting(): bool
    {
        return Runtime::plugin()?->connection()->busy() ?? false;
    }

    private static function busy(callable $fn): mixed
    {
        [$was, self::$busy] = [self::$busy, true];
        try {
            return $fn();
        } finally {
            self::$busy = $was;
        }
    }
}
