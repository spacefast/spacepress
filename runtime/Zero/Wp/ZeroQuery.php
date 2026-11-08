<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\App;
use Zero\Js;
use Zero\Viewer;

/**
 * Zero's query arguments on a core list route (spec §3a): `where`, `orderBy` and `with`, in the same
 * forms as the facade's query string. They run through Zero's read pipeline as the viewer, so the
 * read rule, draft visibility and field masks decide exactly as they do for `posts.list()`: a filter
 * or sort on a field hidden from the viewer is the same 403, a relation holds only rows the viewer
 * may read. Core keeps its own pagination, `_fields`, `_embed` and the response shape.
 */
final class ZeroQuery
{
    /**
     * The ids `where`/`orderBy` select, in order, or null when the request has neither.
     *
     * @return ?list<int>
     */
    public static function keys(string $collection, \WP_REST_Request $request, Viewer $viewer): ?array
    {
        $given = self::given($request, ['where', 'orderBy']);
        $db = Plugin::instance()?->db() ?? throw new \LogicException('No Zero app');
        $search = self::search($collection, $request, $viewer);
        if ($given === [] && $search === null) {
            return null;
        }
        $opts = App::listOptions($given);
        unset($opts['limit']);
        if ($search !== null) {
            $opts['where'] = isset($opts['where']) ? ['AND' => [$opts['where'], $search]] : $search;
            // Zero's search replaces core's (title, content and excerpt only). `orderby=relevance`
            // needs core's own term, so it becomes core's date order over the rows Zero matched.
            $request->set_param('search', null);
            if ($request['orderby'] === 'relevance') {
                $request->set_param('orderby', 'date');
            }
        }
        $pk = $db->schema()->collection($collection)['primaryKey'];
        $rows = $db->findMany($collection, $opts + ['columns' => [$pk => true]] + self::allLocales($collection), $viewer);

        return array_map(static fn (array $r): int => (int) $r[$pk], $rows);
    }

    /**
     * `with`: each item of a core response gets its relations under `with`, as Zero rows. A refusal
     * (an unknown relation, a link through a hidden field) answers instead of the items.
     */
    public static function attach(string $collection, \WP_REST_Request $request, Viewer $viewer, mixed $response): mixed
    {
        $given = self::given($request, ['with']);
        if ($given === [] || !$response instanceof \WP_REST_Response || !is_array($data = $response->get_data())) {
            return $response;
        }
        $single = !array_is_list($data);
        $items = $single ? [$data] : $data;
        $ids = array_values(array_filter(array_map(static fn ($i) => is_array($i) ? (int) ($i['id'] ?? 0) : 0, $items)));
        $db = Plugin::instance()?->db() ?? throw new \LogicException('No Zero app');
        $pk = $db->schema()->collection($collection)['primaryKey'];
        try {
            $with = App::listOptions($given)['with'];
            // A media field in `with` is a column (populated in place); relations ride along anyway.
            $columns = [$pk => true] + array_fill_keys(array_keys(array_intersect_key($with, $db->schema()->collection($collection)['columns'])), true);
            $rows = $db->findMany($collection, ['where' => [$pk => ['in' => $ids]], 'with' => $with, 'columns' => $columns] + self::allLocales($collection), $viewer);
        } catch (\Zero\HttpError $e) {
            return CoreAccess::error($e);
        }
        $byId = [];
        foreach ($rows as $row) {
            $byId[(int) $row[$pk]] = array_intersect_key($row, $with);
        }
        foreach ($items as &$item) {
            if (is_array($item) && isset($byId[(int) ($item['id'] ?? 0)])) {
                $item['with'] = Js::jsonTree($byId[(int) $item['id']]);
            }
        }
        unset($item);
        $response->set_data($single ? $items[0] : $items);

        return $response;
    }

    /**
     * `search`: the term in any searchable field (spec §2.6: the title, the content and every text or
     * richText field), as a case-insensitive substring. `search_columns` narrows it to core's columns.
     * Fields that may be hidden from the viewer are left out.
     */
    private static function search(string $collection, \WP_REST_Request $request, Viewer $viewer): ?array
    {
        $term = $request['search'];
        if (!is_string($term) || $term === '') {
            return null;
        }
        $spec = Plugin::instance()?->schema->collection($collection) ?? throw new \LogicException('No Zero app');
        $core = ['post_title' => $spec['title'] ?? null, 'post_content' => $spec['content'] ?? null, 'post_excerpt' => $spec['content'] ?? null];
        $columns = (array) ($request['search_columns'] ?? []);
        $fields = $columns !== []
            ? array_values(array_filter(array_map(static fn ($c) => $core[$c] ?? null, $columns)))
            : array_keys(array_filter($spec['columns'], static fn (array $def, $col) => $col === ($spec['title'] ?? null) || $col === ($spec['content'] ?? null)
                || (in_array($def['type'], ['text', 'richText'], true) && !($def['system'] ?? false)), ARRAY_FILTER_USE_BOTH));
        // A field that may be hidden from the viewer is not searched, so a search can't probe it.
        // (Core's own `search` over a hidden content column stays a 403: CoreAccess::queryDenial.)
        $fields = array_values(array_filter(array_unique(array_map('strval', $fields)),
            static fn (string $col): bool => !\Zero\FieldAccess::mayHide($spec['columns'][$col], $viewer)));
        $pattern = '%' . addcslashes($term, '%_\\') . '%';

        return $fields === [] ? null : ['OR' => array_map(static fn (string $col) => [$col => ['ilike' => $pattern]], $fields)];
    }

    /** @return array<string, mixed> the named query params the request supplied */
    private static function given(\WP_REST_Request $request, array $names): array
    {
        $query = $request->get_query_params();

        return array_intersect_key($query, array_flip($names));
    }

    /** A core list holds every language (Polylang's `lang` narrows it), not only the default locale. */
    private static function allLocales(string $collection): array
    {
        return \Zero\Locale\Module::localized($collection) ? ['locale' => '*'] : [];
    }
}
