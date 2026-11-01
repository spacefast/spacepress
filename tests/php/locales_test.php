<?php

declare(strict_types=1);

/*
 * Localization (§7.3) on custom tables, on WordPress in-process (tests/php/wp.php): one row per locale
 * in a translation group (the `translationGroup` column, as the compiler emits for `editor: false`
 * collections); synced columns follow the group; reads pick a locale and fall back to the default per
 * group. Post-backed collections keep their group in Polylang, proven in tests/wp/locales.test.ts.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
$open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']];
$api = ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true];
$schema = ['name' => 'pages', 'locales' => ['default' => 'en', 'all' => ['en', 'de', 'fr'], 'fallback' => true], 'collections' => [
    'pages' => ['primaryKey' => 'id', 'localized' => true, 'drafts' => true, 'revisions' => true, 'slug' => 'slug', 'access' => $open, 'api' => $api,
        'hooks' => ['beforeUpdate' => 'pages__beforeUpdate', 'afterUpdate' => 'pages__afterUpdate'],
        'relations' => ['notes' => ['kind' => 'many', 'collection' => 'notes', 'from' => 'id', 'to' => 'pageId'], 'chapters' => ['kind' => 'many', 'collection' => 'chapters', 'from' => 'id', 'to' => 'pageId'], 'parent' => ['kind' => 'one', 'collection' => 'pages', 'from' => 'parentId', 'to' => 'id', 'optional' => true]],
        'columns' => [
            'id' => $id,
            'title' => ['type' => 'text', 'notNull' => true, 'localized' => true],
            'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
            'price' => ['type' => 'integer'],
            'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['a', 'b'], 'notNull' => true, 'default' => ['value' => []]],
            'seo' => ['type' => 'group', 'fields' => ['heading' => ['type' => 'text', 'localized' => true], 'noindex' => ['type' => 'boolean']]],
            'stampedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true]],
            'box' => ['type' => 'group', 'fields' => ['label' => ['type' => 'text'], 'secret' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]]]],
            'parentId' => ['type' => 'integer', 'references' => ['collection' => 'pages', 'column' => 'id', 'onDelete' => 'set null']],
            'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
            'publishedAt' => ['type' => 'timestamp', 'system' => true],
            'locale' => ['type' => 'text', 'enum' => ['en', 'de', 'fr'], 'notNull' => true, 'default' => ['value' => 'en'], 'system' => true],
            'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
            'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],
        ]],
    'codes' => ['primaryKey' => 'code', 'localized' => true, 'access' => $open, 'api' => $api, 'relations' => [],
        'columns' => [
            'code' => ['type' => 'text', 'primaryKey' => true, 'notNull' => true],
            'label' => ['type' => 'text', 'localized' => true],
            'rank' => ['type' => 'integer'],
            'locale' => ['type' => 'text', 'enum' => ['en', 'de', 'fr'], 'notNull' => true, 'default' => ['value' => 'en'], 'system' => true],
            'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
            'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],
        ]],
    'notes' => ['primaryKey' => 'id', 'access' => $open, 'api' => $api, 'relations' => [],
        'columns' => ['id' => $id, 'pageId' => ['type' => 'integer'], 'body' => ['type' => 'text', 'notNull' => true]]],
    'chapters' => ['primaryKey' => 'id', 'localized' => true, 'access' => $open, 'api' => $api, 'relations' => [],
        'columns' => [
            'id' => $id,
            'pageId' => ['type' => 'integer'],
            'heading' => ['type' => 'text', 'notNull' => true, 'localized' => true],
            'locale' => ['type' => 'text', 'enum' => ['en', 'de', 'fr'], 'notNull' => true, 'default' => ['value' => 'en'], 'system' => true],
            'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
            'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],
        ]],
]];

$functions = <<<'PHP'
    // Records every afterUpdate as "<locale>:<price>", so per-row hooks during group sync are observable.
    // Rewrites a synced value on one translation: group sync must refuse rather than split the group.
    function pages__beforeUpdate($patch, $existing) {
        if ($existing['title'] === 'Bump DE' && isset($patch['price'])) {
            $patch['price']++;
        }
        if ($existing['title'] === 'Tag DE' && isset($patch['price'])) {
            $patch['tags'] = ['b']; // a different synced column than the one propagated
        }
        if ($existing['title'] === 'Adopt DE' && isset($patch['price'])) {
            $patch['price']++; // rewrites the value it is adopting
        }
        if ($existing['title'] === 'Spawn on adopt' && isset($patch['price'])) {
            \Zero\db()->insert('pages', ['title' => 'Spawned FR', 'locale' => 'fr', 'translationOf' => $existing['id']]);
        }
        if ($existing['title'] === 'Order EN' && ($patch['stampedAt'] ?? null) === '2001-01-01T00:00:00.000Z') {
            $patch['price'] = 5; // a hook changes a synced value during a bulk update of another column
        }
        if ($existing['title'] === 'Move DE') {
            $patch['locale'] = 'fr';
        }
        if ($existing['title'] === 'Spawn DE' && isset($patch['price'])) {
            // creates a French translation while the group still holds its old values
            \Zero\db()->insert('pages', ['title' => 'Spawn FR', 'locale' => 'fr', 'translationOf' => $existing['id']]);
        }
        return $patch;
    }
    function pages__afterUpdate($row, $previous) {
        if ($row['price'] === 13 && $row['locale'] === 'de') {
            throw new \Zero\JsError('de refuses 13');
        }
        if ($row['title'] === 'Between' && $row['price'] === 41) {
            // between two rows of one group in a bulk update: touch the first again
            \Zero\db()->update('pages', ['title' => 'Order EN'], ['title' => 'Order']);
        }
        if ($row['title'] === 'Between' && $row['stampedAt'] === '2001-01-01T00:00:00.000Z') {
            // restore the first row's synced value: what was handed to the second must follow
            \Zero\db()->update('pages', ['price' => 41], ['title' => 'Order EN']);
        }
        if ($row['title'] === 'Mid' && $row['price'] === 51) {
            \Zero\db()->update('pages', ['price' => 57], ['title' => 'Late DE']); // a nested write to a row still to come
        }
        if ($row['title'] === 'Mid' && $row['price'] === 52) {
            \Zero\db()->insert('pages', ['title' => 'Late FR', 'locale' => 'fr', 'translationOf' => \Zero\db()->findFirst('pages', ['where' => ['title' => 'Late DE']])['id']]);
        }
        if ($row['title'] === 'Late DE' && $row['price'] === 53 && $previous['price'] !== 53) {
            // the sibling written early deletes the row that started the group write, then fails
            \Zero\db()->delete('pages', ['title' => 'Late']);
            if (\Zero\db()->findFirst('pages', ['where' => ['title' => 'Late']]) === null) {
                throw new \Zero\JsError('de refuses 53');
            }
        }
        if ($row['title'] === 'Kick' && $row['price'] === 31) {
            // a nested bulk update over two translations whose group the outer update also covers,
            // changing another synced column than the outer one
            \Zero\db()->update('pages', ['tags' => ['b']], ['title' => ['in' => ['Nest DE', 'Nest FR']]]);
        }
        if ($row['price'] === 21 && $row['locale'] === 'en' && ($other = \Zero\db()->findFirst('pages', ['where' => ['title' => 'Coffee']])) !== null) {
            \Zero\db()->update('pages', ['price' => 22], ['id' => $other['id']]); // another group, from inside a sync
        }
        $group = $row['translations'];
        ksort($group);
        \Zero\db()->insert('notes', ['pageId' => $row['id'], 'body' => 'afterUpdate ' . $row['locale'] . ':' . $row['price'] . ' ' . json_encode($group)]);
    }
    PHP;

$wp = wpSite('locales', ['schema' => $schema, 'functions' => $functions]);
$db = \Zero\db();
$anon = new \Zero\Viewer(null);
$editor = new \Zero\Viewer($wp->user('editor'));
// Reads are anonymous; writes are the editor's: a unique slug may only be written by a viewer who can
// read the whole collection (#72), and the public read rule gives everyone that for pages.
$rest = static function (string $method, string $path, array $query = [], mixed $body = null, array $headers = []) use ($wp): array {
    [$status, , $payload] = $wp->handle($method, $path, $body === null ? '' : json_encode($body), $method === 'GET' ? null : 'editor', $headers, $query);
    $json = json_decode($payload, true);

    return [$status, $json['data'] ?? $json];
};
$titles = static fn (array $rows): array => array_map(static fn ($r) => $r['locale'] . ':' . $r['title'], $rows);

// create: default and explicit locale; translationOf joins the group and copies synced columns
$tea = $db->insert('pages', ['title' => 'Tea', 'price' => 3, 'tags' => ['a']], true)[0];
eq('create defaults to locales.default in its own group', [$tea['locale'], $tea['translations']], ['en', ['en' => $tea['id']]]);
[$status, $tee] = $rest('POST', '/pages', [], ['title' => 'Tee', 'locale' => 'de', 'translationOf' => $tea['id'], 'status' => 'draft']);
eq('translationOf copies synced columns, keeps localized + per-row ones', [$status, $tee['locale'], $tee['price'], $tee['tags'], $tee['slug'], $tee['status']], [201, 'de', 3, ['a'], 'tee', 'draft']);
eq('translations list the whole group on every row (API rows hide translationGroup)', [
    $tee['translations'], $db->findFirst('pages', ['where' => ['id' => $tea['id']]])['translations'], array_key_exists('translationGroup', $tee),
], [['en' => $tea['id'], 'de' => $tee['id']], ['en' => $tea['id'], 'de' => $tee['id']], false]);
problem('a synced column that differs from the group → 422', fn () => $db->insert('pages', ['title' => 'Thé', 'locale' => 'fr', 'translationOf' => $tea['id'], 'price' => 9]), 422, 'invalid_input', '/price');
problem('one row per locale per group → 409', fn () => $db->insert('pages', ['title' => 'Tee 2', 'locale' => 'de', 'translationOf' => $tea['id']]), 409, 'unique_violation', '/locale');
problem('translationOf must name a row', fn () => $db->insert('pages', ['title' => 'x', 'locale' => 'fr', 'translationOf' => 999]), 422, 'invalid_input', '/translationOf');
problem('a malformed locale is invalid input', fn () => $db->insert('pages', ['title' => 'x', 'locale' => [], 'translationOf' => $tea['id']]), 422, 'invalid_input', '/locale');
problem('translations are derived', fn () => $db->insert('pages', ['title' => 'x', 'translations' => []]), 422, 'invalid_input', '/translations');
$the = $db->insert('pages', ['title' => 'Thé', 'locale' => 'fr', 'translationOf' => $tee['id'], 'price' => 3], true)[0];
problem('locale is immutable', fn () => $db->update('pages', ['locale' => 'de'], ['id' => $the['id']]), 422, 'invalid_input', '/locale');
problem('translationOf only on create', fn () => $db->update('pages', ['translationOf' => $tea['id']], ['id' => $the['id']]), 422, 'invalid_input', '/translationOf');

// update: a synced change reaches every row of the group in one transaction, hooks + revisions per row
$db->update('pages', ['price' => 4, 'title' => 'Thé vert'], ['id' => $the['id']]);
$group = $db->findMany('pages', ['locale' => '*', 'orderBy' => ['id' => 'asc']]);
eq('synced column propagates; localized one stays per row', array_map(static fn ($r) => [$r['locale'], $r['title'], $r['price']], $group), [['en', 'Tea', 4], ['de', 'Tee', 4], ['fr', 'Thé vert', 4]]);
eq('afterUpdate ran once per row, sibling rows already see the full group', array_column($db->findMany('notes', ['orderBy' => ['id' => 'asc']]), 'body'), [
    'afterUpdate fr:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
    'afterUpdate en:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
    'afterUpdate de:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
]);
eq('each synced row keeps its own revision', count($db->revisions('pages', $tee['id'])), 2);
// A bulk update covering several rows of one group: each row's hooks and revision once, not
// once for the update and again for the group sync it already received.
$before = array_column($db->findMany('notes'), 'id');
$db->update('pages', ['price' => 5], ['id' => ['in' => [$tea['id'], $tee['id']]]]);
$bodies = array_map(static fn ($n) => substr($n['body'], 0, 16), $db->findMany('notes', ['where' => ['id' => ['notIn' => $before]], 'orderBy' => ['id' => 'asc']]));
sort($bodies);
eq('a bulk update over one group runs each row\'s afterUpdate once', $bodies, ['afterUpdate de:5', 'afterUpdate en:5', 'afterUpdate fr:5']);
eq('… one revision each', [count($db->revisions('pages', $tea['id'])), count($db->revisions('pages', $tee['id'])), count($db->revisions('pages', $the['id']))], [3, 3, 3]);
$db->update('pages', ['price' => 4], ['id' => ['in' => [$tea['id'], $tee['id'], $the['id']]]]);
$db->delete('notes', ['id' => ['notIn' => $before]]);
// A nested bulk update over rows of the same group: both changes reach every row.
$kick = $db->insert('pages', ['title' => 'Kick', 'price' => 1], true)[0];
$nest = $db->insert('pages', ['title' => 'Nest', 'price' => 1], true)[0];
$nestDe = $db->insert('pages', ['title' => 'Nest DE', 'locale' => 'de', 'translationOf' => $nest['id']], true)[0];
$nestFr = $db->insert('pages', ['title' => 'Nest FR', 'locale' => 'fr', 'translationOf' => $nest['id']], true)[0];
$db->update('pages', ['price' => 31], ['id' => ['in' => [$kick['id'], $nest['id']]]]);
eq('… a nested bulk over the same group commits both changes to every row', array_map(static fn ($r) => [$r['price'], $r['tags']], $db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$nest['id'], $nestDe['id'], $nestFr['id']]]]])),
    [[31, ['b']], [31, ['b']], [31, ['b']]]);
$db->delete('pages', ['id' => ['in' => [$kick['id'], $nest['id'], $nestDe['id'], $nestFr['id']]]]);
$db->delete('notes', ['id' => ['notIn' => $before]]);
// Writes between two rows of one group in a bulk update: the group agrees, and the latest change wins.
$order = $db->insert('pages', ['title' => 'Order', 'price' => 1], true)[0];
$between = $db->insert('pages', ['title' => 'Between', 'price' => 1], true)[0];
$orderDe = $db->insert('pages', ['title' => 'Order DE', 'locale' => 'de', 'translationOf' => $order['id']], true)[0];
$three = ['id' => ['in' => [$order['id'], $between['id'], $orderDe['id']]]];
$db->update('pages', ['price' => 41], $three);
eq('… a nested write between the rows commits with the group agreeing', array_column($db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$order['id'], $orderDe['id']]]]]), 'price'), [41, 41]);
$db->update('pages', ['stampedAt' => '2001-01-01T00:00:00.000Z'], $three);
eq('… also when a later change restores the value the group had', array_column($db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$order['id'], $orderDe['id']]]]]), 'price'), [41, 41]);
$db->delete('pages', $three);
$db->delete('notes', ['id' => ['notIn' => $before]]);
// Hooks between two rows of a group in a bulk update: a nested write to the later row, a new
// translation of it, or deleting the earlier one all leave the group consistent.
$late = $db->insert('pages', ['title' => 'Late', 'price' => 1], true)[0];
$mid = $db->insert('pages', ['title' => 'Mid', 'price' => 1], true)[0];
$lateDe = $db->insert('pages', ['title' => 'Late DE', 'locale' => 'de', 'translationOf' => $late['id']], true)[0];
$lateRows = static fn () => array_map(static fn ($r) => $r['title'] . ':' . $r['price'], $db->findMany('pages', ['locale' => '*', 'where' => ['title' => ['like' => 'Late%']], 'orderBy' => ['id' => 'asc']]));
$three = ['id' => ['in' => [$late['id'], $mid['id'], $lateDe['id']]]];
$db->update('pages', ['price' => 51], $three);
// Late DE was already written by the bulk update (once, with the group's 51); Mid's hook wrote later.
eq('… a later nested write to a row the bulk update already reached wins, the group agreeing', $lateRows(), ['Late:57', 'Late DE:57']);
$db->update('pages', ['price' => 52], $three);
eq('… a translation created between them joins with the group\'s current values', $lateRows(), ['Late:52', 'Late DE:52', 'Late FR:52']);
$revisionsBefore = count($db->revisions('pages', $late['id']));
$notesBefore = count($db->findMany('notes'));
problem('… a sibling hook that deletes the first row and then fails rolls everything back', fn () => $db->update('pages', ['price' => 53], $three), 422, 'rejected');
eq('… nothing of it committed: rows, revisions, hook effects', [$lateRows(), count($db->revisions('pages', $late['id'])), count($db->findMany('notes'))],
    [['Late:52', 'Late DE:52', 'Late FR:52'], $revisionsBefore, $notesBefore]);
$db->delete('pages', ['title' => ['in' => ['Late', 'Mid', 'Late DE', 'Late FR']]]);
$db->delete('notes', ['id' => ['notIn' => $before]]);
// A row from before localization (no group yet): its old revisions show the group it has now.
$legacy = $db->insert('pages', ['title' => 'Legacy'], true)[0];
$wp->exec('UPDATE {prefix}zero_pages SET `translationGroup` = NULL WHERE `id` = ?', [$legacy['id']]);
$db->update('pages', ['title' => 'Legacy v2'], ['id' => $legacy['id']]);
$legacyRevision = array_reverse($db->revisions('pages', $legacy['id']))[0]['id'];
$legacyDe = $db->insert('pages', ['title' => 'Alt', 'locale' => 'de', 'translationOf' => $legacy['id']], true)[0];
eq('a revision taken before the row had a group shows its current group', $db->revision('pages', $legacy['id'], $legacyRevision)['translations'], ['en' => $legacy['id'], 'de' => $legacyDe['id']]);
$db->delete('pages', ['id' => ['in' => [$legacy['id'], $legacyDe['id']]]]);
$firstRevision = array_reverse($db->revisions('pages', $tea['id']))[0]['id'];
eq('a revision shows the group as it is now, not as it was', $db->revision('pages', $tea['id'], $firstRevision)['translations'], ['en' => $tea['id'], 'de' => $tee['id'], 'fr' => $the['id']]);
$notesBefore = count($db->findMany('notes'));
$revisionsBefore = count($db->revisions('pages', $tea['id']));
problem('a sibling hook failing mid-sync rolls back the whole group', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 13], ['id' => $tea['id']])), 422, 'rejected');
eq('… rows, hook effects and revisions written before the failure are gone', [
    array_column($db->findMany('pages', ['locale' => '*']), 'price'), count($db->findMany('notes')), count($db->revisions('pages', $tea['id'])),
], [[4, 4, 4], $notesBefore, $revisionsBefore]);

// A group holding a localized sub-field is translated whole: never copied or synced.
$seo = $db->insert('pages', ['title' => 'Seo', 'seo' => ['heading' => 'Hello', 'noindex' => true]], true)[0];
$seoDe = $db->insert('pages', ['title' => 'Seo DE', 'locale' => 'de', 'translationOf' => $seo['id'], 'seo' => ['heading' => 'Hallo', 'noindex' => true]], true)[0];
$db->update('pages', ['seo' => ['heading' => 'Hi', 'noindex' => false]], ['id' => $seo['id']]);
eq('a group with a localized sub-field stays per row', [$seoDe['seo']['heading'], $db->findFirst('pages', ['where' => ['id' => $seoDe['id']]])['seo']], ['Hallo', ['heading' => 'Hallo', 'noindex' => true]]);
$db->delete('pages', ['id' => ['in' => [$seo['id'], $seoDe['id']]]]);
// A sibling's hook that rewrites a synced value can't split the group: the whole write is refused.
$bump = $db->insert('pages', ['title' => 'Bump', 'price' => 1], true)[0];
$bumpDe = $db->insert('pages', ['title' => 'Bump DE', 'locale' => 'de', 'translationOf' => $bump['id']], true)[0];
problem('a hook that diverges a synced column → 409, nothing committed', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 2], ['id' => $bump['id']])), 409, 'conflict', '/price');
problem('… also when one bulk update covers both rows', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 2], ['id' => ['in' => [$bump['id'], $bumpDe['id']]]])), 409, 'conflict', '/price');
problem('… also when the patch is input that normalizes to the group\'s values', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 2.0, 'box' => ['label' => 'x']], ['id' => ['in' => [$bump['id'], $bumpDe['id']]]])), 409, 'conflict', '/price');
eq('… both rows keep the group value', array_column($db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$bump['id'], $bumpDe['id']]]]]), 'price'), [1, 1]);
$db->delete('pages', ['id' => ['in' => [$bump['id'], $bumpDe['id']]]]);
$tag = $db->insert('pages', ['title' => 'Tag', 'price' => 1, 'tags' => ['a']], true)[0];
$tagDe = $db->insert('pages', ['title' => 'Tag DE', 'locale' => 'de', 'translationOf' => $tag['id']], true)[0];
problem('… also when the hook changes another synced column', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 2], ['id' => $tag['id']])), 409, 'conflict', '/tags');
eq('… nothing committed', array_map(static fn ($r) => [$r['price'], $r['tags']], $db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$tag['id'], $tagDe['id']]]], 'orderBy' => ['id' => 'asc']])), [[1, ['a']], [1, ['a']]]);
$db->delete('pages', ['id' => ['in' => [$tag['id'], $tagDe['id']]]]);
$spawn = $db->insert('pages', ['title' => 'Spawn', 'price' => 1], true)[0];
$spawnDe = $db->insert('pages', ['title' => 'Spawn DE', 'locale' => 'de', 'translationOf' => $spawn['id']], true)[0];
problem('… also when a hook adds a translation with the old values', fn () => $db->transaction(fn () => $db->update('pages', ['price' => 2], ['id' => $spawn['id']])), 409, 'conflict', '/price');
eq('… nothing committed', count($db->findMany('pages', ['locale' => '*', 'where' => ['title' => ['like' => 'Spawn%']]])), 2);
$db->delete('pages', ['id' => ['in' => [$spawn['id'], $spawnDe['id']]]]);
$move = $db->insert('pages', ['title' => 'Move', 'price' => 1], true)[0];
$moveDe = $db->insert('pages', ['title' => 'Move DE', 'locale' => 'de', 'translationOf' => $move['id']], true)[0];
problem('a hook can\'t move a row to another locale either', fn () => $db->update('pages', ['title' => 'Move DE'], ['id' => $moveDe['id']]), 422, 'invalid_input', '/locale');
$db->delete('pages', ['id' => ['in' => [$move['id'], $moveDe['id']]]]);

// Per-row generated values (default now, onUpdate) aren't synced: a translation keeps its own.
$stamped = $db->insert('pages', ['title' => 'Stamped', 'stampedAt' => '2000-01-01T00:00:00Z'], true)[0];
$stampedDe = $db->insert('pages', ['title' => 'Stamped DE', 'locale' => 'de', 'translationOf' => $stamped['id']], true)[0];
check('a generated column is per row', $stampedDe['stampedAt'] !== $stamped['stampedAt'], [$stamped['stampedAt'], $stampedDe['stampedAt']]);
$db->delete('pages', ['id' => ['in' => [$stamped['id'], $stampedDe['id']]]]);

// Text primary keys that look like numbers stay text through groups, sync and reads.
$db->insert('codes', ['code' => '01', 'label' => 'One', 'rank' => 1]);
$db->insert('codes', ['code' => '001', 'label' => 'Eins', 'locale' => 'de', 'translationOf' => '01']);
$db->update('codes', ['rank' => 2], ['code' => '001']);
eq('numeric-looking text keys keep their type', array_map(static fn ($r) => [$r['code'], $r['rank'], $r['translations']], $db->findMany('codes', ['locale' => '*', 'orderBy' => ['code' => 'asc']])),
    [['001', 2, ['en' => '01', 'de' => '001']], ['01', 2, ['en' => '01', 'de' => '001']]]);

// A synced group with an admin-only sub-field: an editor can't confirm the hidden value by guessing.
$boxed = $db->insert('pages', ['title' => 'Boxed', 'box' => ['label' => 'L', 'secret' => 's3cret']], true)[0];
$boxGuess = static fn (string $secret) => fn () => $db->insert('pages', ['title' => 'Boxed DE', 'locale' => 'de', 'translationOf' => $boxed['id'], 'box' => ['label' => 'L', 'secret' => $secret]], true, $editor);
problem('a hidden sub-field is refused whatever it is (right guess)', $boxGuess('s3cret'), 422, 'invalid_input', '/box');
problem('… exactly like a wrong guess', $boxGuess('nope'), 422, 'invalid_input', '/box');
$db->delete('pages', ['id' => $boxed['id']]);

// Adoption (a row linked into a group outside the API) is held to the same group invariant.
$adopt = $db->insert('pages', ['title' => 'Adopt', 'price' => 7], true)[0];
problem('a hook rewriting an adopted synced value → 409, nothing committed', fn () => $db->transaction(function () use ($db, $adopt, $wp) {
    $de = $db->insert('pages', ['title' => 'Adopt DE', 'locale' => 'de', 'price' => 1], true)[0];
    $wp->exec('UPDATE {prefix}zero_pages SET `translationGroup` = ? WHERE `id` = ?', [$db->findFirst('pages', ['where' => ['id' => $adopt['id']]])['translationGroup'], $de['id']]); // linked outside the pipeline
    \Zero\Locale\GroupSync::adopt('pages', $db->findFirst('pages', ['where' => ['id' => $de['id']]]));
}), 409, 'conflict', '/price');
eq('… no Adopt DE row was committed', count($db->findMany('pages', ['locale' => '*', 'where' => ['title' => 'Adopt DE']])), 0);
problem('… and a hook that adds a translation during a group adoption is checked too', fn () => $db->transaction(function () use ($db, $adopt, $wp) {
    $de = $db->insert('pages', ['title' => 'Spawn on adopt', 'locale' => 'de', 'price' => 1], true)[0];
    $wp->exec('UPDATE {prefix}zero_pages SET `translationGroup` = ? WHERE `id` = ?', [$db->findFirst('pages', ['where' => ['id' => $adopt['id']]])['translationGroup'], $de['id']]);
    $rows = $db->findMany('pages', ['locale' => '*', 'where' => ['id' => ['in' => [$adopt['id'], $de['id']]]], 'orderBy' => ['id' => 'asc']]);
    \Zero\Locale\GroupSync::adoptAll('pages', $rows);
}), 409, 'conflict', '/price');
eq('… nothing of it committed', count($db->findMany('pages', ['locale' => '*', 'where' => ['title' => ['in' => ['Spawn on adopt', 'Spawned FR']]]])), 0);
$db->delete('pages', ['id' => $adopt['id']]);

// An idempotent translation create replays its receipt even after the group's values moved on.
$idem = $db->insert('pages', ['title' => 'Idem', 'price' => 3], true)[0];
$request = ['title' => 'Idem FR', 'locale' => 'fr', 'translationOf' => $idem['id'], 'price' => 3];
$first = $rest('POST', '/pages', [], $request, ['idempotency-key' => 'idem-fr']);
$db->update('pages', ['price' => 4], ['id' => $idem['id']]);
$again = $rest('POST', '/pages', [], $request, ['idempotency-key' => 'idem-fr']);
eq('… the replay returns the original 201', [$first[0], $again[0], $again[1]['id'] ?? null], [201, 201, $first[1]['id']]);
$db->delete('pages', ['id' => ['in' => [$idem['id'], $first[1]['id']]]]);

// reads: locale with fallback per group, `*`, filters combine, non-localized collections refuse
$coffee = $db->insert('pages', ['title' => 'Coffee', 'price' => 5], true)[0];
$kaffee = $db->insert('pages', ['title' => 'Kaffee', 'locale' => 'de', 'translationOf' => $coffee['id']], true)[0];
$db->update('pages', ['price' => 21], ['id' => $the['id']]);
eq('a sync that writes another group still propagates that group', array_column($db->findMany('pages', ['locale' => '*', 'orderBy' => ['id' => 'asc']]), 'price'), [21, 21, 21, 22, 22]);
$db->delete('pages', ['id' => $kaffee['id']]);
$db->update('pages', ['price' => 4], ['id' => $the['id']]);
$db->update('pages', ['price' => 5], ['id' => $coffee['id']]);
eq('locale=de: the de row, else the group\'s default-locale row', $titles($db->findMany('pages', ['locale' => 'de', 'orderBy' => ['id' => 'asc']])), ['de:Tee', 'en:Coffee']);
eq('locale=fr with a filter', $titles($db->findMany('pages', ['locale' => 'fr', 'where' => ['price' => ['gte' => 4]], 'orderBy' => ['id' => 'asc']])), ['fr:Thé vert', 'en:Coffee']);
eq('a filter that excludes the translation does not resurrect its fallback', $titles($db->findMany('pages', ['locale' => 'fr', 'where' => ['title' => ['like' => 'Tea%']]])), []);
eq('locale=* returns every row', count($db->findMany('pages', ['locale' => '*'])), 4);
eq('API list defaults to locales.default', $titles($rest('GET', '/pages', ['orderBy' => 'id'])[1]), ['en:Tea', 'en:Coffee']);
eq('REST ?locale=fr', $titles($rest('GET', '/pages', ['locale' => 'fr', 'orderBy' => 'id'])[1]), ['fr:Thé vert', 'en:Coffee']);
eq('a hidden translation (draft) does not hide its group: anonymous de falls back', [
    $titles($db->findMany('pages', ['locale' => 'de', 'orderBy' => ['id' => 'asc']], $anon)),
    $titles($db->findMany('pages', ['locale' => 'de', 'orderBy' => ['id' => 'asc']], $editor)),
], [['en:Tea', 'en:Coffee'], ['de:Tee', 'en:Coffee']]);
eq('GET /pages/{id} names a row; ?locale= picks its group\'s row', [
    $rest('GET', '/pages/' . $tea['id'])[1]['title'],
    $rest('GET', '/pages/' . $tea['id'], ['locale' => 'fr'])[1]['title'],
    $rest('GET', '/pages/' . $coffee['id'], ['locale' => 'fr'])[1]['title'],
], ['Tea', 'Thé vert', 'Coffee']);
$isBad = static fn (array $r, string $ptr) => check("bad locale → 400 $ptr", $r[0] === 400 && $r[1]['code'] === 'invalid_query' && $r[1]['pointer'] === $ptr, $r);
$isBad($rest('GET', '/pages', ['locale' => 'es']), '/locale');
$isBad($rest('GET', '/notes', ['locale' => 'en']), '/locale');
problem('translations cannot be filtered', fn () => $db->findMany('pages', ['where' => ['translations' => null]]), 400, 'invalid_query', '/where/translations');

// with: a localized `many` resolves to each parent row's locale, `one` resolves the stored id
$db->insert('notes', ['pageId' => $coffee['id'], 'body' => 'child']);
$fallback = $db->findMany('pages', ['locale' => 'de', 'with' => ['notes' => true], 'where' => ['id' => $coffee['id']]]);
eq('`many` children that aren\'t localized are attached as stored', [$fallback[0]['locale'], in_array('child', array_column($fallback[0]['notes'], 'body'), true)], ['en', true]);
// Chapters name the en page (pageId is synced, so the de translation names it too); Serve has no de row.
$steep = $db->insert('chapters', ['pageId' => $tea['id'], 'heading' => 'Steep'], true)[0];
$db->insert('chapters', ['heading' => 'Ziehen', 'locale' => 'de', 'translationOf' => $steep['id']]);
$db->insert('chapters', ['pageId' => $tea['id'], 'heading' => 'Serve']);
$headings = static fn (array $rows): array => array_map(static fn ($r) => [$r['locale'] . ':' . $r['title'], $titles(array_map(static fn ($c) => ['title' => $c['heading']] + $c, $r['chapters']))], $rows);
$mine = ['id' => ['in' => [$tea['id'], $tee['id'], $the['id']]]];
eq('each parent row gets its group\'s children in its own locale, falling back per group', $headings($db->findMany('pages', ['locale' => '*', 'where' => $mine, 'orderBy' => ['id' => 'asc'], 'with' => ['chapters' => true]])), [
    ['en:Tea', ['en:Steep', 'en:Serve']], ['de:Tee', ['de:Ziehen', 'en:Serve']], ['fr:Thé vert', ['en:Steep', 'en:Serve']],
]);
eq('… limit applies per parent', $headings($db->findMany('pages', ['locale' => '*', 'where' => $mine, 'orderBy' => ['id' => 'asc'], 'with' => ['chapters' => ['limit' => 1, 'offset' => 1]]])), [
    ['en:Tea', ['en:Serve']], ['de:Tee', ['en:Serve']], ['fr:Thé vert', ['en:Serve']],
]);
eq('… over REST, a viewer who can\'t see the de draft gets its fallback parent and en children', $headings($rest('GET', '/pages', ['locale' => 'de', 'with' => 'chapters', 'where' => json_encode(['id' => $tea['id']])])[1]), [
    ['en:Tea', ['en:Steep', 'en:Serve']],
]);
eq('… a nested locale still wins, for every row of the group', $headings($db->findMany('pages', ['locale' => '*', 'where' => $mine, 'orderBy' => ['id' => 'asc'], 'with' => ['chapters' => ['locale' => 'en', 'limit' => 1]]])), [
    ['en:Tea', ['en:Steep']], ['de:Tee', ['en:Steep']], ['fr:Thé vert', ['en:Steep']],
]);
problem('… a nested limit is still validated', fn () => $db->findMany('pages', ['where' => ['id' => $tea['id']], 'with' => ['chapters' => ['limit' => -1]]]), 400, 'invalid_query', '/with/chapters/limit');
problem('… so is a nested option when no parent has a key to follow', fn () => $db->findMany('pages', ['where' => ['id' => $tea['id']], 'with' => ['parent' => ['limit' => -1]]]), 400, 'invalid_query', '/with/parent/limit');
$db->update('pages', ['parentId' => $tea['id']], ['id' => $coffee['id']]);
$fr = $db->findMany('pages', ['locale' => 'fr', 'with' => ['parent' => true], 'orderBy' => ['id' => 'asc']]);
eq('`one` relation resolves the referenced row as stored', array_map(static fn ($r) => $r['parent']['title'] ?? null, $fr), [null, 'Tea']);

// delete: only that row; the group shrinks
$db->delete('pages', ['id' => $tee['id']]);
eq('delete shrinks the group', [$db->findFirst('pages', ['where' => ['id' => $tea['id']]])['translations'], $titles($db->findMany('pages', ['locale' => 'de', 'orderBy' => ['id' => 'asc']]))],
    [['en' => $tea['id'], 'fr' => $the['id']], ['en:Tea', 'en:Coffee']]);

// hooks see rows as stored (locale, translations, translationGroup)
$stored = $db->findFirst('pages', ['where' => ['id' => $the['id']]]);
check('trusted rows carry the group id', is_string($stored['translationGroup']) && strlen($stored['translationGroup']) === 36, $stored);

// translationOf copies synced values from storage, not from the caller's field-filtered view.
$hidePrice = true;
\Zero\Extensions::onRead(static function (array $rows, string $c, ?\Zero\Viewer $v) use (&$hidePrice): array {
    return $c === 'pages' && $v !== null && $hidePrice ? array_map(static fn ($r) => array_diff_key($r, ['price' => 1]), $rows) : $rows;
}, constraintSafe: true);
$de = $db->insert('pages', ['title' => 'Tee wieder', 'locale' => 'de', 'translationOf' => $tea['id']], true, $editor)[0];
$hidePrice = false;
$hidePrice = true;
$guess = static fn (int $price) => fn () => $db->insert('pages', ['title' => 'Thé encore', 'locale' => 'fr', 'translationOf' => $tea['id'], 'price' => $price], true, $editor);
problem('a hidden synced value is refused whatever it is (right guess)', $guess(4), 422, 'invalid_input', '/price');
problem('… exactly like a wrong guess', $guess(5), 422, 'invalid_input', '/price');
$hidePrice = false;
eq('a hidden synced column is copied at create (no repair update, one revision)', [$db->findFirst('pages', ['where' => ['id' => $de['id']]])['price'], count($db->revisions('pages', $de['id']))], [4, 1]);

finish('locales_test');
