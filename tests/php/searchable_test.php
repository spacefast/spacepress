<?php

declare(strict_types=1);

/*
 * `.searchable()` (Search\Index::fields) on the blog fixture, in-process on WordPress on SQLite: the
 * marked fields are indexed and matched, an unmarked text field is not once any field is marked,
 * `.searchable(false)` leaves out even the title, and each reader still matches only the fields and
 * rows they may read, on a kind's list, the API, core's list route and core's /wp/v2/search.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// `recipes`: name (the title) searched by default, `bio` marked, `email` marked but only editors
// read it, `notes` an unmarked text field, and a read rule that hides some rows from all but editors.
$recipes = $schema['collections']['authors'];
$recipes['key'] = 'recipes';
$recipes['label'] = 'Recipes';
$recipes['relations'] = [];
$recipes['url'] = '/recipes/:id';
$recipes['wp'] = ['postType' => 'sp_recipes', 'groupKey' => 'group_sp_recipes', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_recipes_'];
$recipes['access']['read'] = ['fn' => 'recipes__access__read'];
$recipes['columns']['bio']['searchable'] = true;
$recipes['columns']['email']['searchable'] = true;
$recipes['columns']['email']['unique'] = false;
$recipes['columns']['email']['access'] = ['read' => ['role' => 'editor']];
$recipes['columns']['notes'] = ['type' => 'text'];
$schema['collections']['recipes'] = $recipes;
// `codes`: a title marked `.searchable(false)`, so only the marked `bio` is searched.
$codes = $schema['collections']['authors'];
$codes['key'] = 'codes';
$codes['label'] = 'Codes';
$codes['relations'] = [];
$codes['url'] = '/codes/:id';
$codes['wp'] = ['postType' => 'sp_codes', 'groupKey' => 'group_sp_codes', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_codes_'];
$codes['columns']['name']['searchable'] = false;
$codes['columns']['bio']['searchable'] = true;
$codes['columns']['email']['unique'] = false;
$schema['collections']['codes'] = $codes;
// `ledger`: every text field `.searchable(false)`: the kind isn't searched at all.
$ledger = $schema['collections']['authors'];
$ledger['key'] = 'ledger';
$ledger['label'] = 'Ledger';
$ledger['relations'] = [];
$ledger['url'] = '/ledger/:id';
$ledger['wp'] = ['postType' => 'sp_ledger', 'groupKey' => 'group_sp_ledger', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_ledger_'];
$ledger['columns']['name']['searchable'] = false;
$ledger['columns']['bio']['searchable'] = false;
$ledger['columns']['email']['unique'] = false;
$schema['collections']['ledger'] = $ledger;

$wp = wpSite('searchable', [
    'schema' => $schema,
    'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

        function recipes__access__read(\SpacePress\JsObject $ctx)
        {
            $user = \SpacePress\Js::prop($ctx, 'user');

            return $user !== null && in_array(\SpacePress\Js::prop($user, 'role'), ['editor', 'admin'], true) ? true : ['notes' => ['ne' => 'staff only']];
        }
        PHP,
    'users' => ['ed' => 'editor', 'sub' => 'subscriber'],
]);
$db = \SpacePress\db();
$prefix = $wp->connection()->prefix();
$index = static fn (string $kind): array => array_map(static fn (array $r): string => $r['field'] . ':' . $r['body'],
    $wp->sql("SELECT `field`, `body` FROM `{$prefix}sp__search` WHERE `kind` = ? ORDER BY `item`, `field`", [new \SpacePress\Wp\Bytes($kind)]));
$fields = static fn (string $kind): array => \SpacePress\Search\Index::fields($db->schema()->collection($kind));

// ---------------------------------------------------------------- which fields

eq('marked fields and the title are searchable; an unmarked text field is not once one is marked', $fields('recipes'), ['name', 'email', 'bio']);
eq('`.searchable(false)` leaves out the title', $fields('codes'), ['bio']);
eq('a kind whose every text field is `.searchable(false)` has none', $fields('ledger'), []);
eq('a kind with no marks keeps every text field', $fields('authors'), ['name', 'bio']);
check('the site-wide search leaves out a kind with no searchable field', !in_array('ledger', \SpacePress\Search\Index::kinds(), true) && in_array('recipes', \SpacePress\Search\Index::kinds(), true), \SpacePress\Search\Index::kinds());

// ---------------------------------------------------------------- the index

wp_set_current_user(1);
$soup = $db->insert('recipes', ['name' => 'Tomato soup', 'email' => 'chef@saffron.test', 'bio' => 'Slow roasted', 'notes' => 'Basil garnish', 'status' => 'published'], true)[0];
$staff = $db->insert('recipes', ['name' => 'Staff curry', 'email' => 'staff@example.test', 'bio' => 'Roasted cumin', 'notes' => 'staff only', 'status' => 'published'], true)[0];
$code = $db->insert('codes', ['name' => 'Walnut code', 'email' => 'c@example.test', 'bio' => 'Hazelnut description', 'status' => 'published'], true)[0];
$entry = $db->insert('ledger', ['name' => 'Pecan entry', 'email' => 'l@example.test', 'bio' => 'Pecan body', 'status' => 'published'], true)[0];
wp_set_current_user(0);

$soupEntries = array_values(array_filter($index('recipes'), static fn (string $e): bool => in_array($e, ['name:Tomato soup', 'email:chef@saffron.test', 'bio:Slow roasted', 'notes:Basil garnish'], true)));
eq('the marked fields and the title are indexed, the unmarked one is not', $soupEntries, ['bio:Slow roasted', 'email:chef@saffron.test', 'name:Tomato soup']);
eq('a `.searchable(false)` title is not indexed', $index('codes'), ['bio:Hazelnut description']);
eq('a kind with no searchable field has no entries', $index('ledger'), []);

// ---------------------------------------------------------------- `search` on a kind, as the reader

$ids = static fn (array $rows): array => array_map(static fn (array $r): int => (int) $r['id'], $rows);
$as = static fn (?string $who): \SpacePress\Viewer => new \SpacePress\Viewer($who === null ? null : $wp->user($who));
$list = static function (string $kind, string $q, ?string $who) use ($ids, $as, $db): array {
    $found = $ids(\SpacePress\Seam::asVisitor($as($who), static fn (): array => $db->findMany($kind, ['where' => [], 'columns' => ['id' => true], 'search' => $q], $as($who))));
    sort($found);

    return $found;
};

eq('a word of a marked field finds the row', $list('recipes', 'slow', null), [$soup['id']]);
eq('a word of the title finds it', $list('recipes', 'tomato', null), [$soup['id']]);
eq('a word only in the unmarked field finds nothing, for anyone', [$list('recipes', 'basil', null), $list('recipes', 'basil', 'ed')], [[], []]);
eq('a word only in a marked field the reader may not read finds nothing', [$list('recipes', 'saffron', null), $list('recipes', 'saffron', 'sub')], [[], []]);
eq('the editor, who reads it, finds the row by it', $list('recipes', 'saffron', 'ed'), [$soup['id']]);
eq('a row the read rule hides is not found', $list('recipes', 'roasted', null), [$soup['id']]);
eq('the editor finds both', $list('recipes', 'roasted', 'ed'), [$soup['id'], $staff['id']]);
eq('nor counted', [$db->count('recipes', null, $as(null), ['search' => 'roasted']), $db->count('recipes', null, $as('ed'), ['search' => 'roasted'])], [1, 2]);
eq('a word of a `.searchable(false)` title finds nothing', $list('codes', 'walnut', 'ed'), []);
eq('the marked field still finds the row', $list('codes', 'hazelnut', null), [$code['id']]);
eq('a kind with no searchable field matches nothing', $list('ledger', 'pecan', 'ed'), []);

// The API list and core's list route are the same read.
[$status, $rows] = $wp->call('GET', '/recipes', query: ['search' => 'roasted', 'limit' => '10']);
eq('the API list finds what a visitor may read', [$status, $ids($rows ?? [])], [200, [$soup['id']]]);
[$status, $rows] = $wp->call('GET', '/recipes', query: ['search' => 'basil', 'limit' => '10']);
eq('and not by the unmarked field', [$status, $ids($rows ?? [])], [200, []]);
$core = static function (string $postType, array $params, ?string $who) use ($wp): array {
    $wp->actAs($who);
    try {
        $request = new \WP_REST_Request('GET', "/wp/v2/$postType");
        $request->set_query_params($params + ['per_page' => 50]);
        $response = rest_do_request($request);
    } finally {
        wp_set_current_user(0);
    }
    $out = array_map(static fn (array $r): int => (int) $r['id'], rest_get_server()->response_to_data($response, false));
    sort($out);

    return [$response->get_status(), $out];
};
eq('core\'s list route searches the marked fields', $core('sp_recipes', ['search' => 'slow'], null), [200, [$soup['id']]]);
eq('and not the unmarked one', $core('sp_recipes', ['search' => 'basil'], 'ed'), [200, []]);
eq('nor a hidden marked field for a visitor', $core('sp_recipes', ['search' => 'saffron'], null), [200, []]);

// ---------------------------------------------------------------- core's /wp/v2/search and the site-wide endpoint

$coreSearch = static function (string $q, ?string $who) use ($wp): array {
    $wp->actAs($who);
    try {
        $request = new \WP_REST_Request('GET', '/wp/v2/search');
        $request->set_query_params(['search' => $q]);
        $response = rest_do_request($request);
    } finally {
        wp_set_current_user(0);
    }
    $out = array_map(static fn (array $r): string => $r['subtype'] . ':' . $r['id'], rest_get_server()->response_to_data($response, false));
    sort($out);

    return [$response->get_status(), $out];
};
eq('/wp/v2/search finds a row by a marked field', $coreSearch('slow', null), [200, ["sp_recipes:{$soup['id']}"]]);
eq('not by an unmarked one', $coreSearch('basil', 'ed'), [200, []]);
eq('not by a marked field the reader may not read', $coreSearch('saffron', null), [200, []]);
eq('nor a row the read rule hides', $coreSearch('roasted', null), [200, ["sp_recipes:{$soup['id']}"]]);
eq('an editor finds both', $coreSearch('roasted', 'ed'), [200, ["sp_recipes:{$soup['id']}", "sp_recipes:{$staff['id']}"]]);
eq('a `.searchable(false)` title is not matched', $coreSearch('walnut', 'ed'), [200, []]);
eq('a kind with no searchable field is not searched', $coreSearch('pecan', 'ed'), [200, []]);
[$status, $found] = $wp->call('GET', '/search', query: ['q' => 'roasted']);
eq('the site-wide endpoint matches the same rows', [$status, array_map(static fn (array $r): array => [$r['kind'], $ids($r['rows'])], $found['results'] ?? [])],
    [200, [['recipes', [$soup['id']]]]]);

finish('searchable_test');
