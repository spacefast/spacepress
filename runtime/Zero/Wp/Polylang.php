<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\ColumnRef;
use Zero\HttpError;
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
        // Zero syncs its own columns in the pipeline (hooks and revisions per row). Polylang's live
        // meta sync would update siblings first, behind the pipeline's back, so it never touches
        // Zero's fields; its one-time copy into a new translation (wp-admin "+") stays.
        add_filter('pll_copy_post_metas', static function (mixed $metas, mixed $sync, mixed $from = 0): array {
            $metas = (array) $metas;
            if (!$sync || !in_array(get_post_type((int) $from), self::postTypes(), true)) {
                return $metas;
            }

            return array_values(array_filter($metas, static fn ($key) => !str_starts_with((string) $key, 'zero_') && !str_starts_with((string) $key, '_zero_')));
        }, 100, 3);
        // A group linked outside Zero's API (wp-admin "+", pll_save_post_translations): adopt synced columns.
        // Before Polylang changes a group term (each change runs these core hooks before writing),
        // remember the group's membership as it was, so a refused link can put it back exactly.
        $remember = static function (int $ttId): void {
            if (!self::$busy && !self::zeroWriting() && !isset(self::$priorGroups[$ttId])) {
                self::$priorGroups[$ttId] = self::membersOf($ttId);
            }
        };
        add_action('edit_term_taxonomy', static function (mixed $ttId, mixed $taxonomy) use ($remember): void {
            if ($taxonomy === 'post_translations') {
                $remember((int) $ttId);
            }
        }, 10, 2);
        add_action('pre_delete_term', static function (mixed $term, mixed $taxonomy) use ($remember): void {
            if ($taxonomy === 'post_translations' && ($t = get_term((int) $term, 'post_translations')) instanceof \WP_Term) {
                $remember((int) $t->term_taxonomy_id);
            }
        }, 10, 2);
        add_action('delete_term_relationships', static function (mixed $objectId, mixed $ttIds, mixed $taxonomy) use ($remember): void {
            if ($taxonomy === 'post_translations') {
                foreach ((array) $ttIds as $ttId) {
                    $remember((int) $ttId);
                }
            }
        }, 10, 3);
        add_action('set_object_terms', static function (int $objectId, mixed $terms, mixed $ttIds, string $taxonomy, mixed $append = false, mixed $oldTtIds = []): void {
            if ($taxonomy === 'post_translations' && !self::$busy && !self::zeroWriting() && ($ttIds = (array) $ttIds) !== []) {
                self::adopt($objectId, (int) reset($ttIds));
            }
        }, 10, 6);
        add_action('activated_plugin', static function (): void {
            self::ensureLanguages();
        });
        add_action('admin_init', static function (): void {
            $schema = Runtime::plugin()?->schema;
            if ($schema?->locales() !== null && get_option('zero_polylang_languages') !== self::state($schema->locales())) {
                self::ensureLanguages();
            }
        });
    }

    /** locale => post id of $postId's group (self included), in configured locale spelling. */
    public static function group(int $postId, array $locales): array
    {
        $bySlug = [];
        foreach ($locales as $l) {
            $bySlug[self::slug($l)] = $l;
        }
        $out = [];
        $members = (array) pll_get_post_translations($postId);
        if ($members === [] && ($own = pll_get_post_language($postId))) {
            $members = [$own => $postId];
        }
        foreach ($members as $slug => $id) {
            $out[$bySlug[$slug] ?? $slug] = (int) $id;
        }

        return $out;
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

    /**
     * After WpPostStore::insert: set the new post's language and, for a `translationOf` create, join
     * $group (locale => id, from the source row). Membership changes are serialized per group by
     * locking its posts, and the group is re-read under the lock, so a locale is added at most once
     * (409 at /locale). On rollback the members' and group terms' caches are dropped.
     *
     * @param array<string, int> $group
     */
    public static function assign(Connection $db, int $id, string $locale, array $group): void
    {
        self::busy(static fn () => pll_set_post_language($id, self::slug($locale)));
        if ($group === []) {
            return;
        }
        $current = self::locked($db, array_map('intval', array_values($group)));
        if (isset($current[self::slug($locale)])) {
            throw new HttpError(409, 'unique_violation', "This translation group already has a $locale row", '/locale');
        }
        $current[self::slug($locale)] = $id;
        $terms = [];
        foreach ($current as $member) {
            $db->touchPost($member);
            clean_object_term_cache($member, (string) get_post_type($member));
            foreach (wp_get_object_terms($member, 'post_translations', ['fields' => 'ids']) as $term) {
                $terms[(int) $term] = true;
            }
        }
        // The full, freshly locked group: Polylang merges it into the group term and links every member.
        self::busy(static fn () => pll_save_post_translations($current));
        foreach (wp_get_object_terms($id, 'post_translations', ['fields' => 'ids']) as $term) {
            $terms[(int) $term] = true;
        }
        $db->onRollback(static function () use ($terms): void {
            foreach (array_keys($terms) as $term) {
                clean_term_cache($term, 'post_translations');
            }
        });
    }

    /**
     * language slug => post id of the group $ids belong to, read with locking reads of the core
     * taxonomy tables (latest committed state, then held), so concurrent joins serialize per group.
     *
     * @param list<int> $ids
     * @return array<string, int>
     */
    public static function locked(Connection $db, array $ids): array
    {
        $p = $db->prefix();
        $in = static fn (array $v) => implode(', ', array_fill(0, count($v), '?'));
        $db->run("SELECT ID FROM `{$p}posts` WHERE ID IN ({$in($ids)}) ORDER BY ID FOR UPDATE", $ids);
        $groups = array_column($db->run("SELECT DISTINCT tr.term_taxonomy_id AS g FROM `{$p}term_relationships` tr JOIN `{$p}term_taxonomy` tt ON tt.term_taxonomy_id = tr.term_taxonomy_id"
            . " WHERE tr.object_id IN ({$in($ids)}) AND tt.taxonomy = 'post_translations' FOR UPDATE", $ids), 'g');
        if ($groups !== []) {
            $members = array_map('intval', array_column($db->run("SELECT object_id AS id FROM `{$p}term_relationships` WHERE term_taxonomy_id IN ({$in($groups)}) FOR UPDATE", $groups), 'id'));
            $ids = array_values(array_unique([...$ids, ...$members]));
        }
        // Live members only, as every read sees them: a trashed translation keeps Polylang's group
        // relationship but is no longer a row (a join in its locale drops it from the group).
        $ids = array_map('intval', array_column($db->run("SELECT ID FROM `{$p}posts` WHERE ID IN ({$in($ids)}) AND post_status NOT IN ('trash', 'auto-draft', 'inherit') FOR UPDATE", $ids), 'ID'));
        if ($ids === []) {
            return [];
        }
        $out = [];
        foreach ($db->run("SELECT tr.object_id AS id, t.slug FROM `{$p}term_relationships` tr JOIN `{$p}term_taxonomy` tt ON tt.term_taxonomy_id = tr.term_taxonomy_id"
            . " JOIN `{$p}terms` t ON t.term_id = tt.term_id WHERE tr.object_id IN ({$in($ids)}) AND tt.taxonomy = 'language' ORDER BY tr.object_id FOR UPDATE", $ids) as $r) {
            $out[(string) $r['slug']] ??= (int) $r['id'];
        }

        return $out;
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
        // Polylang's default follows locales.default, also on sites whose languages already existed.
        $default = PLL()->model->get_language(self::slug($locales['default']));
        if ($default instanceof \PLL_Language && pll_default_language() !== $default->slug) {
            PLL()->model->update_default_lang($default->slug);
        }
        // Posts of localized post types that predate localization (no language) become default-locale rows.
        $types = self::postTypes();
        if ($types !== [] && $default instanceof \PLL_Language) {
            foreach (get_posts(['post_type' => $types, 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'lang' => '', 'suppress_filters' => true]) as $id) {
                if (!pll_get_post_language((int) $id)) {
                    pll_set_post_language((int) $id, $default->slug);
                }
            }
        }
        update_option('zero_polylang_languages', self::state($locales), false);
    }

    /** Provisioning marker: the default plus every locale, so changing either re-provisions. */
    private static function state(array $locales): string
    {
        return $locales['default'] . ':' . implode(',', $locales['all']);
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

    /** @var array<string, true> intended groups (term + members) adopted successfully in this request */
    private static array $adopted = [];
    /** @var array<int, array<string, int>> group term → its membership before Polylang changed it in this request */
    private static array $priorGroups = [];

    /** language slug => post id of a post_translations term's current members (from term relationships). */
    private static function membersOf(int $ttId): array
    {
        $out = [];
        foreach (get_objects_in_term(get_term_by('term_taxonomy_id', $ttId, 'post_translations')?->term_id ?? 0, 'post_translations') ?: [] as $id) {
            if (($lang = pll_get_post_language((int) $id)) !== false && $lang !== null) {
                $out[(string) $lang] = (int) $id;
            }
        }

        return $out;
    }

    /**
     * A group linked outside Zero's API. Polylang writes the group's full membership into the group
     * term, then links its posts one at a time; on the first link, every intended member adopts the
     * group's synced values in one transaction, checked as a whole. If that fails, every group this
     * link touched is put back as it was before Polylang changed it (remembered by the term hooks
     * in boot()), and the error propagates, so Polylang links no further posts.
     */
    private static function adopt(int $postId, int $groupTt): void
    {
        $plugin = Runtime::plugin();
        $type = get_post_type($postId);
        $term = get_term_by('term_taxonomy_id', $groupTt, 'post_translations');
        if ($plugin === null || !in_array($type, self::postTypes(), true) || !$term instanceof \WP_Term) {
            return;
        }
        $intended = array_map('intval', array_values(array_filter((array) maybe_unserialize($term->description), 'is_numeric')));
        $key = $groupTt . ':' . implode(',', $intended);
        if (isset(self::$adopted[$key]) || count($intended) < 2) {
            return;
        }
        foreach ($plugin->schema->collections() as $name => $spec) {
            if (($spec['wp']['postType'] ?? null) !== $type) {
                continue;
            }
            $db = $plugin->db();
            $pk = $spec['primaryKey'];
            try {
                $db->transaction(static function () use ($db, $name, $pk, $intended): void {
                    $rows = $db->findMany((string) $name, ['where' => [$pk => ['in' => $intended]], 'locale' => '*']);
                    if (count($rows) < 2) {
                        return;
                    }
                    usort($rows, static fn ($x, $y) => $x[$pk] <=> $y[$pk]);
                    GroupSync::adoptAll((string) $name, $rows);
                });
            } catch (\Throwable $e) {
                self::restore($intended);
                throw $e;
            }
            self::$adopted[$key] = true;
            self::$priorGroups = []; // committed: nothing to put back any more

            return;
        }
    }

    /**
     * Put every group this request's link touched back as it was: each post leaves its current
     * group, then each remembered group is saved again with its prior members.
     *
     * @param list<int> $intended
     */
    private static function restore(array $intended): void
    {
        $prior = self::$priorGroups;
        self::$priorGroups = [];
        $posts = $intended;
        foreach ($prior as $members) {
            array_push($posts, ...array_values($members));
        }
        self::busy(static function () use ($posts, $prior): void {
            foreach (array_unique($posts) as $post) {
                PLL()->model->post->delete_translation($post);
                clean_object_term_cache($post, (string) get_post_type($post));
            }
            foreach ($prior as $ttId => $members) {
                if (count($members) >= 2) {
                    pll_save_post_translations($members);
                }
                clean_term_cache($ttId, 'post_translations');
            }
        });
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
