<?php

declare(strict_types=1);

namespace First\Content;

use First\Db;
use First\JsArray;
use First\JsObject;
use First\JsUndefined;
use First\Seam;
use First\Wp\KindUrls;
use WP_HTML_Tag_Processor as Tags;

/**
 * `"first/content"` at run time (docs/decisions/2026-11-13-docs-kind.md): the navigation tree,
 * previous and next, and the headings of a hierarchical kind's items.
 *
 * The tree holds the published items the visitor may read (their read rule and field masks
 * apply, as for every query), even when the visitor could also read drafts: a page's navigation
 * is the published site, the same for an editor as for the cached anonymous page. Siblings sort
 * by `order`, then title. An item whose parent the visitor may not read is left out with it.
 */
final class Nav
{
    /** Items read per tree: a docs section larger than this is a sign the kind wants paging. */
    private const LIMIT = 2000;

    /** @var array<string, list<array{id: int, title: string, parent: ?int, href: string}>> per kind, per request */
    private static array $items = [];
    /** @var array<string, true> rendered content headings() read, by hash: `the_content` gives it the same ids */
    private static array $anchored = [];

    /** The id of the current item: a row, an id, or nothing. */
    public static function id(mixed $row): ?int
    {
        if ($row === null || $row === JsUndefined::Value) {
            return null;
        }
        $row = Seam::container($row);
        return is_array($row) && is_int($row['id'] ?? null) ? $row['id'] : null;
    }

    /** @return list<array{id: int, title: string, parent: ?int, href: string}> sorted siblings first by order then title */
    private static function items(string $kind): array
    {
        $viewer = Seam::viewer();
        $key = $kind . ':' . ($viewer?->user['id'] ?? 0);
        if (isset(self::$items[$key])) {
            return self::$items[$key];
        }
        $spec = Db::instance()->schema()->collection($kind);
        $where = ($spec['drafts'] ?? false) ? ['status' => 'published'] : [];
        $rows = Db::instance()->findMany($kind, [
            'where' => $where,
            'orderBy' => ['order' => 'asc'],
            'limit' => self::LIMIT,
            'columns' => [$spec['primaryKey'] => true, $spec['title'] => true, 'parent' => true, 'order' => true],
        ], $viewer);
        $urls = KindUrls::instance();
        $out = [];
        foreach ($rows as $row) {
            $id = (int) $row[$spec['primaryKey']];
            $post = get_post($id);
            $path = $post instanceof \WP_Post && $urls !== null ? $urls->path($kind, $post) : null;
            if ($path === null) {
                continue;
            }
            $out[] = ['id' => $id, 'title' => (string) $row[$spec['title']], 'parent' => $row['parent'] === null ? null : (int) $row['parent'], 'order' => (int) $row['order'], 'href' => $path];
        }
        // Order, then title, so siblings with the same order keep a stable, readable order.
        usort($out, static fn (array $a, array $b): int => [$a['order'], $a['title'], $a['id']] <=> [$b['order'], $b['title'], $b['id']]);

        return self::$items[$key] = $out;
    }

    /** @return array<int, list<array>> parent id (0 for the top) => children, sorted */
    private static function byParent(array $items): array
    {
        $ids = array_flip(array_column($items, 'id'));
        $out = [];
        foreach ($items as $item) {
            $parent = $item['parent'] ?? 0;
            if ($parent !== 0 && !isset($ids[$parent])) {
                continue; // under an item the visitor can't see: not reachable, so not listed
            }
            $out[$parent][] = $item;
        }
        return $out;
    }

    /** `nav(kind, current?)`: the tree, `$depth` levels deep, marking the current item and its ancestors. */
    public static function tree(string $kind, mixed $current, int $depth): JsArray
    {
        $current = is_int($current) ? $current : (is_float($current) ? (int) $current : null);
        $children = self::byParent(self::items($kind));
        $build = static function (int $parent, int $depth) use (&$build, $children, $current): array {
            $out = [];
            foreach ($children[$parent] ?? [] as $item) {
                $below = $depth > 1 ? $build($item['id'], $depth - 1) : [];
                $open = $item['id'] === $current || array_filter($below, static fn (JsObject $c): bool => $c->p['current'] || $c->p['open']) !== [];
                $node = ['id' => $item['id'], 'title' => $item['title'], 'href' => $item['href'], 'current' => $item['id'] === $current, 'open' => $open];
                if ($depth > 1) {
                    $node['children'] = new JsArray($below);
                }
                $out[] = new JsObject($node);
            }
            return $out;
        };

        return new JsArray($build(0, $depth));
    }

    /** `pager(kind, current)`: the items before and after the current one, reading the tree top to bottom. */
    public static function pager(string $kind, mixed $current): JsObject
    {
        $current = is_int($current) ? $current : (is_float($current) ? (int) $current : null);
        $children = self::byParent(self::items($kind));
        $flat = [];
        $walk = static function (int $parent) use (&$walk, &$flat, $children): void {
            foreach ($children[$parent] ?? [] as $item) {
                $flat[] = $item;
                $walk($item['id']);
            }
        };
        $walk(0);
        $at = null;
        foreach ($flat as $i => $item) {
            if ($item['id'] === $current) {
                $at = $i;
            }
        }
        $link = static fn (?array $item): ?JsObject => $item === null ? null : new JsObject(['id' => $item['id'], 'title' => $item['title'], 'href' => $item['href']]);

        return new JsObject([
            'prev' => $at === null ? null : $link($flat[$at - 1] ?? null),
            'next' => $at === null ? null : $link($flat[$at + 1] ?? null),
        ]);
    }

    /**
     * `headings(item)`: the item's `##` and `###` headings in order, with the anchor id the
     * rendered page gives each one (headingIds()), for a table of contents.
     */
    public static function headings(mixed $row, string $column): JsArray
    {
        $row = Seam::container($row);
        $blocks = is_array($row) && is_string($row[$column] ?? null) ? $row[$column] : '';
        $html = self::render($blocks);
        if ($html !== '') {
            self::listen();
            self::$anchored[md5($html)] = true;
        }
        $out = [];
        foreach (self::scan($html) as [$depth, $text, $id]) {
            if ($depth >= 2 && $depth <= 3) {
                $out[] = new JsObject(['depth' => $depth, 'text' => $text, 'id' => $id]);
            }
        }

        return new JsArray($out);
    }

    /** The block markup as `the_content` shows it, so headings in nested blocks count too. */
    private static function render(string $blocks): string
    {
        return $blocks === '' ? '' : do_blocks($blocks);
    }

    /**
     * `the_content`, once headings() ran in this request: the same content, rendered for the page
     * (`<Content value={item.content} />`), gets the ids headings() reported, so its links land.
     * do_blocks runs at priority 9; this runs right after it, on exactly that output.
     */
    private static function listen(): void
    {
        static $on = false;
        if ($on) {
            return;
        }
        $on = true;
        // Same priority as do_blocks, added later, so it runs on do_blocks' output.
        add_filter('the_content', static fn (string $html): string => isset(self::$anchored[md5($html)]) ? self::headingIds($html) : $html, 9);
    }

    /**
     * Every heading in rendered HTML: (level, text, id). A heading with its own id keeps it; any
     * other gets one from its text, made unique in the page with `-2`, `-3`, ….
     *
     * @return list<array{int, string, string}>
     */
    private static function scan(string $html): array
    {
        $out = [];
        $seen = [];
        $doc = \WP_HTML_Processor::create_fragment($html);
        if ($doc === null) {
            return [];
        }
        $level = 0;
        $text = '';
        $own = null;
        while ($doc->next_token()) {
            $tag = $doc->get_tag();
            if ($doc->get_token_type() === '#tag' && is_string($tag) && preg_match('/^H([1-6])$/', $tag, $m) === 1) {
                if ($doc->is_tag_closer()) {
                    if ($level > 0) {
                        $out[] = [$level, trim(preg_replace('/\s+/u', ' ', $text) ?? ''), $own];
                    }
                    $level = 0;
                    continue;
                }
                $level = (int) $m[1];
                $text = '';
                $own = $doc->get_attribute('id');
                $own = is_string($own) && $own !== '' ? $own : null;
                continue;
            }
            if ($level > 0 && $doc->get_token_type() === '#text') {
                $text .= $doc->get_modifiable_text();
            }
        }
        foreach ($out as $i => [$depth, $words, $id]) {
            $id ??= self::slug($words);
            $base = $id;
            for ($n = 2; isset($seen[$id]); $n++) {
                $id = "$base-$n";
            }
            $seen[$id] = true;
            $out[$i] = [$depth, $words, $id];
        }

        return $out;
    }

    private static function slug(string $text): string
    {
        $slug = trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '-', mb_strtolower($text)), '-');

        return $slug === '' ? 'section' : $slug;
    }

    /**
     * `the_content` filter for a hierarchical kind's items: every `h1`–`h6` without an id gets the
     * one headings() reports, so a table of contents links land.
     */
    public static function headingIds(string $html): string
    {
        if (!str_contains($html, '<h')) {
            return $html;
        }
        $ids = array_column(self::scan($html), 2);
        $tags = new Tags($html);
        $i = 0;
        while ($tags->next_tag()) {
            if (preg_match('/^H[1-6]$/', (string) $tags->get_tag()) !== 1) {
                continue;
            }
            if ($tags->get_attribute('id') === null && isset($ids[$i])) {
                $tags->set_attribute('id', $ids[$i]);
            }
            $i++;
        }

        return $tags->get_updated_html();
    }
}
