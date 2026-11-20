<?php

declare(strict_types=1);

/*
 * Content sync runtime (design §5.3) on WordPress, in-process through App::handle (tests/php/wp.php):
 * canonical JSON golden, uid minting, /sync reads/writes/trash, reference uids, body conversion
 * fixtures and the server-side merge. Notes are posts (Markdown sync needs a content designation),
 * people a custom table; sync over HTTP against WordPress is proven by tests/wp/sync.test.ts.
 */

use TypedPress\Sync\Canon;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$editor = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']];
$api = ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true];
$schema = [
    'name' => 'notes',
    'collections' => [
        'people' => [
            'primaryKey' => 'id', 'uid' => true, 'sync' => null, 'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'name' => ['type' => 'text', 'notNull' => true],
                // A unique key only editors read: a reference to it (0.3.0 captures only) must not disclose it.
                'badge' => ['type' => 'integer', 'unique' => true, 'access' => ['read' => ['role' => 'editor']]],
                'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
            ],
        ],
        // A synced table whose reference targets a non-id key (0.3.0 captures only).
        'badges' => [
            'primaryKey' => 'id', 'editor' => false, 'table' => 'tp_badges', 'uid' => true, 'sync' => null, 'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'badgeId' => ['type' => 'integer', 'references' => ['collection' => 'people', 'column' => 'badge']],
                'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
            ],
        ],
        'notes' => [
            'primaryKey' => 'id', 'editor' => true, 'uid' => true, 'sync' => ['dir' => 'content/notes', 'format' => 'md'], 'title' => 'title', 'content' => 'body', 'slug' => 'slug',
            'drafts' => true, 'revisions' => true, 'access' => ['create' => ['fn' => 'notes__create'], 'update' => ['fn' => 'notes__update'], 'delete' => ['fn' => 'notes__delete']] + $editor, 'api' => $api, 'relations' => [],
            'hooks' => ['beforeCreate' => 'notes__beforeCreate', 'beforeUpdate' => 'notes__beforeUpdate'],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
                'body' => ['type' => 'richText'],
                'meta' => ['type' => 'json'],
                'authorId' => ['type' => 'integer', 'references' => ['collection' => 'people', 'column' => 'id', 'onDelete' => 'set null']],
                'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true]],
                'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
                'publishedAt' => ['type' => 'timestamp', 'system' => true],
                'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
            ],
        ],
    ],
    'globals' => [], 'actions' => [],
];
$functions = <<<'PHP'
    <?php
    declare(strict_types=1);
    namespace TypedPressApp;
    // Authors and up create; while the test flag is set, only published rows (status comes from its default).
    function notes__create($ctx) {
        $rank = ['author' => 1, 'editor' => 2, 'admin' => 3][$ctx->p['user']->p['role'] ?? ''] ?? 0;
        if (empty($GLOBALS['firstCreateNeedsPublished'])) {
            return $rank >= 1;
        }
        // The generated `now` values must be the instant the rule itself reads.
        $now = \TypedPress\Js::iso(\TypedPress\Js::now());
        return $rank >= 1 && ($ctx->p['data']->p['status'] ?? null) === 'published'
            && ($ctx->p['data']->p['publishedAt'] ?? null) === $now && ($ctx->p['data']->p['updatedAt'] ?? null) === $now;
    }
    // Editors may update every note; authors only notes credited to a person with their name (a filter).
    function notes__update($ctx) {
        return match ($ctx->p['user']->p['role'] ?? null) {
            'editor', 'admin' => true,
            'author' => ['authorId' => ['in' => array_column(\TypedPress\db()->findMany('people', ['where' => ['name' => $ctx->p['user']->p['name']]]), 'id')]],
            default => false,
        };
    }
    function notes__delete($ctx) {
        if (!empty($GLOBALS['firstJsonDeleteFilter'])) {
            return new \TypedPress\JsObject(['meta' => new \TypedPress\JsObject(['eq' => new \TypedPress\JsObject()])]);
        }
        return in_array($ctx->p['user']->p['role'] ?? null, ['editor', 'admin'], true);
    }
    // Normalisation the client didn't send: titles are trimmed.
    function notes__beforeCreate($data) {
        if ($data->p['title'] === 'forbidden title') { throw new \TypedPress\JsError('this title is not allowed'); }
        return new \TypedPress\JsObject(['title' => trim($data->p['title'])] + $data->p);
    }
    // A hook that tries to rewrite identity: the runtime must refuse it after the hook.
    // A compiled hook returning `{}` replaces the patch with nothing to change.
    function notes__beforeUpdate($patch, $existing) { return match ($patch->p['title'] ?? null) { 'steal uid' => new \TypedPress\JsObject($patch->p + ['uid' => 'zr_99999999999999999999']), 'drop it' => new \TypedPress\JsObject(), default => $patch }; }
    PHP;

foreach (['seedAuthors' => 'seedArticles', 'seedArticles' => 'seedAuthors', 'aSeedItems' => 'seedAuthors'] as $name => $target) {
    $schema['collections'][$name] = [
        'primaryKey' => 'id', 'editor' => false, 'uid' => true, 'sync' => ['dir' => 'content/' . $name, 'format' => 'json'],
        'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
        'columns' => [
            'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
            'name' => ['type' => 'text', 'notNull' => true],
            'peer' => ['type' => 'integer', 'references' => ['collection' => $target, 'column' => 'id', 'onDelete' => 'set null']],
            'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
        ],
    ];
}
$schema['collections']['seedNodes'] = $schema['collections']['seedAuthors'];
$schema['collections']['seedNodes']['sync']['dir'] = 'content/seedNodes';
$schema['collections']['seedNodes']['columns']['parent'] = $schema['collections']['seedNodes']['columns']['peer'];
$schema['collections']['seedNodes']['columns']['parent']['references']['collection'] = 'seedNodes';
unset($schema['collections']['seedNodes']['columns']['peer']);
$wp = wpSite('sync', ['schema' => $schema, 'functions' => $functions, 'users' => ['ed' => 'editor', 'au' => 'author']]);
$app = $wp->app();
$db = \TypedPress\db();

/** @return array{int, mixed} [status, data or problem] */
function req(string $method, string $path, mixed $body = null, ?string $as = 'ed', array $query = []): array
{
    global $wp;
    [$status, $data] = $wp->call($method, $path, $body, $as, $query);

    return [$status, $data];
}

function isProblem(string $label, array $r, int $status, string $code, ?string $pointer = null): void
{
    [$s, $p] = $r;
    check("$label → $status $code" . ($pointer === null ? '' : " $pointer"), $s === $status && ($p['code'] ?? null) === $code && ($p['pointer'] ?? null) === $pointer, $p);
}

/** @return array<string, array> live and trashed records by uid, across every page */
function pull(string $collection, int $first = 100): array
{
    $out = [];
    $after = 0;
    do {
        [, $page] = req('GET', "/sync/$collection", query: ['after' => (string) $after, 'first' => (string) $first]);
        foreach ($page['records'] as $item) {
            $out[$item['uid'] ?? $item['record']['uid']] = $item;
        }
        $after = $page['next'];
    } while ($after !== null);

    return $out;
}

// ================================================================ canonical JSON (golden shared with src/sync/canon.rs)

foreach (glob(dirname(__DIR__) . '/fixtures/canon/*.json') as $file) {
    $base = substr($file, 0, -5);
    $canon = Canon::json(json_decode(file_get_contents($file), false, 512, JSON_THROW_ON_ERROR));
    eq('canonical JSON ' . basename($base), $canon, file_get_contents("$base.canon"));
    eq('digest ' . basename($base), Canon::digest(json_decode(file_get_contents($file), false)), trim(file_get_contents("$base.sha256")));
}

// ================================================================ uid

foreach (json_decode(file_get_contents(__DIR__ . '/../fixtures/sync-file-uid.json'), true, 512, JSON_THROW_ON_ERROR) as $case) {
    eq('file uid ' . $case['collection'] . '/' . $case['basename'], \TypedPress\Sync\Uid::forFile($case['collection'], $case['basename']), $case['uid']);
}

$ada = $db->insert('people', ['name' => 'Ada'], true)[0];
check('uid minted on insert', preg_match('/^zr_[0-9a-f]{20}$/D', $ada['uid']) === 1, $ada);
isProblem('uid is immutable', req('PATCH', "/people/{$ada['id']}", ['uid' => 'zr_00000000000000000000']), 422, 'invalid_input', '/uid');
$hooked = $db->insert('notes', ['title' => 'Hooked'], true)[0];
problem('a hook cannot change a uid either', fn () => $db->update('notes', ['title' => 'steal uid'], ['id' => $hooked['id']]), 422, 'invalid_input', '/uid');
$before = $db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['title'];
$db->update('notes', ['title' => 'drop it'], ['id' => $hooked['id']]);
eq('a beforeUpdate returning {} replaces the patch with nothing', $db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['title'], $before);
// What sync authorizes (Wire::decode's data) is plain outside json(): a select sent as `{}` is [].
eq('sync hands rules plain arrays outside json() values, and keeps {} inside them', \TypedPress\Js::jsonStringify(\TypedPress\Sync\Wire::decode('notes',
    \TypedPress\Js::decodeJson('{"uid":"zr_0f0f0f0f0f0f0f0f0f0f","fields":{"title":"T","meta":{"a":{}}},"body":null}'), true)), '{"title":"T","meta":{"a":{}},"body":null}');
eq('and the row keeps its uid and title', [$db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['uid'], $db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['title']], [$hooked['uid'], 'Hooked']);
$given = $db->insert('people', ['name' => 'Grace', 'uid' => 'zr_11111111111111111111'], true)[0];
eq('a writer may supply the uid', $given['uid'], 'zr_11111111111111111111');
isProblem('uid is unique', req('POST', '/people', ['name' => 'Copy', 'uid' => 'zr_11111111111111111111']), 409, 'unique_violation', '/uid');
isProblem('uid must look like zr_ + 20 hex', req('POST', '/people', ['name' => 'Bad', 'uid' => 'nope']), 422, 'invalid_input', '/uid');

// ================================================================ site id

[, $described] = req('GET', '/_schema');
check('site id is a uuid in /_schema', preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D', $described['site']['id'] ?? '') === 1, $described['site'] ?? null);
eq('site id is stable', req('GET', '/_schema')[1]['site']['id'], $described['site']['id']);

// ================================================================ push: create, unchanged, stale, normalized

$nativeUid = 'zr_bbbbbbbbbbbbbbbbbbbb';
$nativeRecord = ['uid' => $nativeUid, 'fields' => ['title' => 'Native block'], 'body' => '<!-- wp:woocommerce/checkout /-->'];
isProblem('unrepresentable native blocks are refused before a sync insert', req('POST', '/sync/notes', ['record' => $nativeRecord, 'expect' => 'absent']), 422, 'not_representable');
eq('the refused native block was never stored', $db->findFirst('notes', ['where' => ['uid' => $nativeUid]]), null);

$noteUid = 'zr_aaaaaaaaaaaaaaaaaaaa';
$record = ['uid' => $noteUid, 'fields' => ['title' => 'TypedPress', 'slug' => 'first', 'meta' => ['b' => 1, 'a' => [true]], 'authorId' => $ada['uid'], 'status' => 'draft', 'publishedAt' => null],
    'body' => "# Hello\n\nWorld.\n"];
[$s, $created] = req('POST', '/sync/notes', ['record' => $record, 'expect' => 'absent']);
eq('push creates with expect absent', [$s, $created['status'], $created['uid']], [201, 'applied', $noteUid]);
$row = $db->findFirst('notes', ['where' => ['uid' => $noteUid]]);
eq('body stored as blocks, reference stored as id', [$row['body'], $row['authorId']],
    ["<!-- wp:heading {\"level\":1} -->\n<h1 class=\"wp-block-heading\">Hello</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>World.</p>\n<!-- /wp:paragraph -->\n\n", $ada['id']]);

$pulled = pull('notes');
eq('pull returns the record as pushed, digest matching the push', [$pulled[$noteUid]['record'], $pulled[$noteUid]['digest']], [$record, $created['digest']]);
eq('digest is sha256 of the canonical record', $created['digest'], Canon::digest($record));
check('pull includes drafts', $pulled[$noteUid]['record']['fields']['status'] === 'draft');

eq('same record again is unchanged', req('POST', '/sync/notes', ['record' => $record, 'expect' => $created['digest']])[1]['status'], 'unchanged');
isProblem('expect absent on an existing uid is stale', req('POST', '/sync/notes', ['record' => $record, 'expect' => 'absent']), 409, 'sync_stale');
// `fields: {}` is an empty field set, not a type error.
[$s, $empty] = req('POST', '/sync/notes', ['record' => ['uid' => 'zr_0e0e0e0e0e0e0e0e0e0e', 'fields' => new stdClass(), 'body' => null], 'expect' => 'absent']);
check('a push with fields: {} is accepted as an object (then the required title is what is missing)', $s === 422 && ($empty['pointer'] ?? null) === '/title', $empty);
$stale = req('POST', '/sync/notes', ['record' => ['fields' => ['title' => 'Later']] + $record, 'expect' => 'sha256:' . str_repeat('0', 64)]);
isProblem('wrong expected digest is stale', $stale, 409, 'sync_stale');
eq('stale carries the current record and digest', [$stale[1]['current']['digest'], $stale[1]['current']['record']], [$created['digest'], $record]);
eq('stale wrote nothing', $db->findFirst('notes', ['where' => ['uid' => $noteUid]])['title'], 'TypedPress');

$spaced = ['uid' => 'zr_cccccccccccccccccccc', 'fields' => ['title' => '  Spaced  ', 'slug' => 'spaced'], 'body' => null];
[$s, $normalized] = req('POST', '/sync/notes', ['record' => $spaced, 'expect' => 'absent']);
eq('a hook that reshapes the write reports normalized with the stored record',
    [$s, $normalized['status'], $normalized['record']['fields']['title']], [201, 'normalized', 'Spaced']);
eq('normalized digest is the stored record', $normalized['digest'], Canon::digest($normalized['record']));


// `{}` and `[]` are different JSON, and a json() value keeps the difference through storage, so the
// write is applied as sent and the digest a client holds is one a pull reproduces.
$shapes = ['uid' => 'zr_ffffffffffffffffffff', 'fields' => ['title' => 'Shapes', 'slug' => 'shapes', 'meta' => ['nested' => new stdClass(), 'list' => []], 'authorId' => null, 'status' => 'draft', 'publishedAt' => null], 'body' => null];
[, $shaped] = req('POST', '/sync/notes', ['record' => $shapes, 'expect' => 'absent']);
[, , $raw] = $wp->handle('GET', '/sync/notes', '', 'ed', [], ['after' => '0', 'first' => '100']);
eq('{} and [] in a json() value are kept apart: applied as sent, pulled back apart',
    [$shaped['status'], str_contains($raw, '"meta":{"list":[],"nested":{}}') || str_contains($raw, '"meta":{"nested":{},"list":[]}')], ['applied', true]);
eq('an answer digest is the digest a pull returns', $shaped['digest'], pull('notes')['zr_ffffffffffffffffffff']['digest']);
// Re-push the pulled record as the wire carried it (decoding it to PHP arrays would turn {} into []).
$pulled = array_values(array_filter(json_decode($raw, false)->data->records, static fn ($r) => ($r->uid ?? $r->record->uid) === 'zr_ffffffffffffffffffff'))[0];
[, , $out] = $wp->handle('POST', '/sync/notes', json_encode(['record' => $pulled->record, 'expect' => $shaped['digest']]), 'ed');
eq('and pushing the pulled record is a no-op', json_decode($out, true)['data']['status'] ?? $out, 'unchanged');

// A read transform (lane B's field access) hides `meta` from the viewer: the answer to a write is what
// that viewer pulls, never the trusted row.
\TypedPress\Extensions::onRead(static fn (array $rows, string $c, ?\TypedPress\Viewer $v) => $c === 'notes' && $v !== null && ($v->user['name'] ?? null) === 'ed'
    ? array_map(static fn (array $r) => ($r['title'] ?? null) === 'Hidden' ? array_diff_key($r, ['meta' => true]) : $r, $rows) : $rows, constraintSafe: true);
$hidden = ['uid' => 'zr_eeeeeeeeeeeeeeeeeeee', 'fields' => ['title' => ' Hidden ', 'slug' => 'hidden', 'meta' => ['secret' => 1]], 'body' => null];
[, $answer] = req('POST', '/sync/notes', ['record' => $hidden, 'expect' => 'absent']);
check('a normalized answer carries only what the viewer reads', !array_key_exists('meta', $answer['record']['fields']), $answer['record']);
eq('and the digest a pull by that viewer returns', $answer['digest'], pull('notes')['zr_eeeeeeeeeeeeeeeeeeee']['digest']);

// ================================================================ references and validation

// A reference to a non-id key the viewer can't read refuses the same way whether its row exists or not.
$badged = $db->insert('people', ['name' => 'Badged', 'badge' => 4242], true)[0];
foreach ([$badged['uid'], 'zr_dddddddddddddddddddd'] as $uid) {
    problem('a sync reference through a hidden key discloses nothing', fn () => $db->current(static fn () => \TypedPress\Sync\Wire::decode('badges',
        ['uid' => 'zr_cccccccccccccccccccc', 'fields' => ['badgeId' => $uid], 'body' => null], viewer: new \TypedPress\Viewer(['id' => 9, 'name' => 'au', 'role' => 'author']))), 409, 'reference_violation', '/badgeId');
}
eq('a reader of the key resolves the reference to it', $db->current(static fn () => \TypedPress\Sync\Wire::decode('badges',
    ['uid' => 'zr_cccccccccccccccccccc', 'fields' => ['badgeId' => $badged['uid']], 'body' => null], viewer: new \TypedPress\Viewer(['id' => 8, 'name' => 'ed', 'role' => 'editor'])))['badgeId'], 4242);
$orphan = ['uid' => 'zr_bbbbbbbbbbbbbbbbbbbb', 'fields' => ['title' => 'Orphan', 'authorId' => 'zr_ffffffffffffffffffff'], 'body' => null];
isProblem('unknown reference uid', req('POST', '/sync/notes', ['record' => $orphan, 'expect' => 'absent']), 409, 'reference_violation', '/authorId');
isProblem('references are not resolved for a caller who may not write', req('POST', '/sync/notes', ['record' => $orphan, 'expect' => 'absent'], as: null), 401, 'unauthenticated');
isProblem('generated columns are not writable', req('POST', '/sync/notes', ['record' => ['fields' => ['updatedAt' => '2000-01-01T00:00:00Z']] + $orphan, 'expect' => 'absent']), 422, 'invalid_input', '/fields/updatedAt');
isProblem('validation runs through the pipeline', req('POST', '/sync/notes', ['record' => ['fields' => ['status' => 'bogus', 'title' => 'x']] + $orphan, 'expect' => 'absent']), 422, 'invalid_input', '/status');

$unsynced = $db->insert('people', ['name' => 'Legacy'], true)[0];
$wp->exec('UPDATE {prefix}tp_people SET `uid` = NULL WHERE `id` = ?', [$unsynced['id']]);
$db->update('notes', ['authorId' => $unsynced['id']], ['uid' => $noteUid]);
$legacyUid = pull('notes')[$noteUid]['record']['fields']['authorId'];
eq('a referenced row without a uid gets one on pull', $legacyUid, $db->findFirst('people', ['where' => ['id' => $unsynced['id']]])['uid']);

// ================================================================ access

isProblem('anonymous cannot pull', req('GET', '/sync/notes', as: null), 401, 'unauthenticated');
isProblem('a filtered update rule is not enough to pull', req('GET', '/sync/notes', as: 'au'), 403, 'forbidden');
isProblem('nor to convert', req('POST', '/sync/notes/convert', ['direction' => 'toBlocks', 'text' => 'x'], as: 'au'), 403, 'forbidden');
isProblem('collections without sync have no sync route', req('GET', '/sync/people'), 404, 'not_found');

// Writes are authorized row by row through the pipeline: an editor may create and authors update rows
// their filter matches, but a stale write discloses nothing to a caller who can't pull.
$au = $db->insert('people', ['name' => 'au'], true)[0];
// A create rule reading defaulted values sees them on sync as on an ordinary create, and reads the
// write's one instant: the clock moves a millisecond on every read (TP_NOW_STEP), so sync's preview
// and the rule evaluation must not read it separately.
$GLOBALS['firstCreateNeedsPublished'] = true;
putenv('TP_NOW=2026-01-01T00:00:00.000Z');
putenv('TP_NOW_STEP=1');
$plain = req('POST', '/notes', ['title' => 'Plain', 'slug' => 'plain-create'], as: 'ed');
[$s] = req('POST', '/sync/notes', ['record' => ['uid' => 'zr_12121212121212121212', 'fields' => ['title' => 'Synced', 'slug' => 'synced-create'], 'body' => null], 'expect' => 'absent'], as: 'ed');
eq('a create rule sees defaults on sync as on an ordinary create', [$plain[0], $s], [201, 201]);
putenv('TP_NOW_STEP');
putenv('TP_NOW');
unset($GLOBALS['firstCreateNeedsPublished']);
$own = ['uid' => 'zr_dddddddddddddddddddd', 'fields' => ['title' => 'Mine', 'slug' => 'mine', 'meta' => null, 'authorId' => $au['uid'], 'status' => 'draft', 'publishedAt' => null], 'body' => null];
[$s, $mine] = req('POST', '/sync/notes', ['record' => $own, 'expect' => 'absent'], as: 'ed');
eq('the create rule authorizes a new uid', [$s, $mine['status']], [201, 'applied']);
foreach (['mine', 'free-slug'] as $slug) {
    $probe = ['uid' => 'zr_13131313131313131313', 'fields' => ['title' => 'Probe', 'slug' => $slug], 'body' => null];
    isProblem('a writer who cannot read drafts cannot probe unique slugs', req('POST', '/sync/notes', ['record' => $probe, 'expect' => 'absent'], as: 'au'), 403, 'forbidden', '/slug');
}
$ownPatch = $own;
unset($ownPatch['fields']['slug']);
eq('a filtered update rule authorizes rows it matches', req('POST', '/sync/notes', ['record' => ['body' => "Edited.\n"] + $ownPatch, 'expect' => $mine['digest']], as: 'au')[1]['status'], 'normalized');
eq('the authorized body edit was saved', $db->findFirst('notes', ['where' => ['uid' => $own['uid']]])['body'], \TypedPress\Sync\Markdown::toBlocks("Edited.\n"));
$theirs = pull('notes')['zr_cccccccccccccccccccc'];
isProblem('and masks rows it does not, as item routes do', req('POST', '/sync/notes', ['record' => ['body' => 'Mine now'] + $theirs['record'], 'expect' => $theirs['digest']], as: 'au'), 404, 'not_found');
isProblem('authorization comes before staleness, so a probe learns nothing', req('POST', '/sync/notes', ['record' => $theirs['record'], 'expect' => 'absent'], as: 'au'), 404, 'not_found');
isProblem('nor does an anonymous no-op push', req('POST', '/sync/notes', ['record' => $theirs['record'], 'expect' => $theirs['digest']], as: null), 401, 'unauthenticated');
$leak = req('POST', '/sync/notes', ['record' => $own, 'expect' => 'absent'], as: 'au');
isProblem('a stale write on a row the caller may update', $leak, 409, 'sync_stale');
check('carries no current record for a caller who cannot pull', !array_key_exists('current', $leak[1]), $leak[1]);
isProblem('trash needs the delete rule', req('POST', '/sync/notes/trash', ['uid' => $own['uid'], 'expect' => $mine['digest']], as: 'au'), 403, 'forbidden');

$nulRow = $db->insert('notes', ['title' => 'NUL JSON', 'meta' => \TypedPress\Js::decodeJson('{"\\u0000":1}')], true)[0];
$nul = pull('notes')[$nulRow['uid']];
[$nulStatus, $nulResult] = req('POST', '/sync/notes', ['record' => $nul['record'], 'expect' => $nul['digest']]);
eq('a NUL-key JSON record keeps its sent digest when echoed', [$nulStatus, $nulResult['status'] ?? null], [200, 'unchanged']);

// Sync authorizes post-backed trash through the same schema-aware JSON filter as Db.
$object = $db->insert('notes', ['title' => 'Object filter', 'meta' => \TypedPress\Js::decodeJson('{}')], true)[0];
$list = $db->insert('notes', ['title' => 'List filter', 'meta' => \TypedPress\Js::decodeJson('[]')], true)[0];
$filterRows = pull('notes');
$GLOBALS['firstJsonDeleteFilter'] = true;
try {
    $objectTrash = req('POST', '/sync/notes/trash', ['uid' => $object['uid'], 'expect' => $filterRows[$object['uid']]['digest']]);
    $listTrash = req('POST', '/sync/notes/trash', ['uid' => $list['uid'], 'expect' => $filterRows[$list['uid']]['digest']]);
    eq('a compiled JSON object filter authorizes {} and masks [] on Sync trash', [$objectTrash[0], $objectTrash[1]['status'] ?? null, $listTrash[0]], [200, 'applied', 404]);
} finally {
    unset($GLOBALS['firstJsonDeleteFilter']);
    wp_delete_post($object['id'], true);
    wp_delete_post($list['id'], true);
}

// ================================================================ paging and trash

foreach (range(1, 4) as $i) {
    $db->insert('notes', ['title' => "Page $i"]);
}
$all = pull('notes');
eq('paging walks every record once', count(pull('notes', 2)), count($all));
check('rows created outside sync get uids on read', count(array_filter(array_keys($all), static fn ($u) => preg_match('/^zr_[0-9a-f]{20}$/D', $u) === 1)) === count($all));

$current = pull('notes')[$noteUid];
isProblem('trash with a stale digest', req('POST', '/sync/notes/trash', ['uid' => $noteUid, 'expect' => 'sha256:' . str_repeat('1', 64)]), 409, 'sync_stale');
eq('trash applies', req('POST', '/sync/notes/trash', ['uid' => $noteUid, 'expect' => $current['digest']])[1]['status'], 'applied');
$trashedId = (int) $wp->scalar('SELECT `ID` FROM {prefix}posts WHERE `post_status` = ? AND `post_type` = ?', ['trash', 'tp_notes']);
check('trash moves the post to the WordPress trash: outside every read, listed by pull as trashed', $db->findFirst('notes', ['where' => ['uid' => $noteUid]]) === null
    && $trashedId > 0 && (pull('notes')[$noteUid]['trashed'] ?? null) === true, pull('notes')[$noteUid] ?? null);
eq('trash of a trashed uid is unchanged', req('POST', '/sync/notes/trash', ['uid' => $noteUid, 'expect' => $current['digest']])[1]['status'], 'unchanged');
// A push of the trashed uid with `expect: absent` restores the post in place (same id), under the delete-and-update rules.
[$s, $restored] = req('POST', '/sync/notes', ['record' => $current['record'], 'expect' => 'absent']);
eq('pushing a trashed uid restores the post', [$s, $restored['status'] ?? null, $db->findFirst('notes', ['where' => ['uid' => $noteUid]])['id'] ?? null], [200, 'applied', $trashedId]);

// ================================================================ convert (fixtures) and merge

$fixtures = dirname(__DIR__) . '/fixtures/sync';
$convert = static fn (string $direction, string $text) => req('POST', '/sync/notes/convert', ['direction' => $direction, 'text' => $text]);
$markdown = file_get_contents("$fixtures/document.md");
$blocks = $convert('toBlocks', $markdown)[1]['text'];
eq('Markdown is a fixed point through blocks', $convert('toMarkdown', $blocks)[1]['text'], $markdown);
// The fence language becomes a className attribute; core escapes its backslash as \.
$fenced = $convert('toBlocks', "```a\\b\nx\n```\n")[1]['text'];
eq('block attributes are spelled as WordPress serializes them', [$fenced, serialize_blocks(parse_blocks($fenced))],
    array_fill(0, 2, "<!-- wp:code {\"className\":\"language-a\\u005cb\"} -->\n<pre class=\"wp-block-code language-a\\b\"><code>x<br></code></pre>\n<!-- /wp:code -->\n\n"));
eq('editor-saved blocks pull as Markdown', $convert('toMarkdown', file_get_contents("$fixtures/editor.blocks"))[1]['text'], file_get_contents("$fixtures/editor.md"));
foreach (['table' => 'core/table', 'aligned' => 'core/paragraph', 'widget' => 'acme/widget'] as $name => $block) {
    $r = $convert('toMarkdown', file_get_contents("$fixtures/$name.blocks"));
    isProblem("$name is not Markdown", $r, 422, 'not_representable');
    check("$name refusal names $block", str_contains($r[1]['detail'] ?? '', $block), $r[1]);
}
eq('static blocks pull as HTML without delimiters', $convert('toHtml', file_get_contents("$fixtures/static.blocks"))[1]['text'], file_get_contents("$fixtures/static.html"));
isProblem('dynamic blocks are not HTML', $convert('toHtml', file_get_contents("$fixtures/dynamic.blocks")), 422, 'not_representable');
[, $batch] = req('POST', '/sync/notes/convert', ['records' => [['direction' => 'toMarkdown', 'text' => file_get_contents("$fixtures/table.blocks")], ['direction' => 'toBlocks', 'text' => 'Hi']]]);
eq('batched convert refuses per item', [$batch['records'][0]['refused'], $batch['records'][1]['text']], ['not_representable', "<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->\n\n"]);

$merge = static fn (string $base, string $ours, string $theirs) => req('POST', '/sync/notes/merge', ['base' => $base, 'ours' => $ours, 'theirs' => $theirs])[1];
eq('independent line edits merge', $merge("a\n\nb\n\nc\n", "A\n\nb\n\nc\n", "a\n\nb\n\nC\n"), ['merged' => "A\n\nb\n\nC\n", 'conflicts' => []]);
eq('the same line edited twice conflicts', $merge("a\n\nb\n", "a\n\nX\n", "a\n\nY\n"), ['merged' => null, 'conflicts' => [['ours' => "X\n", 'theirs' => "Y\n", 'line' => 3]]]);

$seedDir = sys_get_temp_dir() . '/tp-cycle-seed-' . bin2hex(random_bytes(4)); mkdir($seedDir);
file_put_contents($seedDir . '/.ignored.json', 'not seed input');
file_put_contents($seedDir . '/README.txt', 'not seed input');
$writeSeed = static function (string $name, array $records) use ($seedDir): void {
    file_put_contents($seedDir . '/' . $name . '.json', wp_json_encode(['collection' => $name, 'format' => 'json', 'records' => $records]));
};
foreach (['seedAuthors', 'seedArticles'] as $name) { $writeSeed($name, []); }
$empty = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('empty seeds do not depend on schema reference cycles', array_sum(array_column($empty, 'created')), 0);
$authorUid = \TypedPress\Sync\Uid::mint(); $articleUid = \TypedPress\Sync\Uid::mint();
$writeSeed('seedAuthors', [['uid' => $authorUid, 'fields' => ['name' => 'Author', 'peer' => null]]]);
$writeSeed('seedArticles', [['uid' => $articleUid, 'fields' => ['name' => 'Article']]]);
$created = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('nullable or omitted references can seed cyclic schemas', array_sum(array_column($created, 'created')), 2);
$writeSeed('seedAuthors', [['uid' => $authorUid, 'fields' => ['name' => 'Author', 'peer' => $articleUid]]]);
$writeSeed('seedArticles', [['uid' => $articleUid, 'fields' => ['name' => 'Article', 'peer' => $authorUid]]]);
$existing = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('already-existing targets resolve when seed schemas form a cycle', [array_sum(array_column($existing, 'created')), array_sum(array_column($existing, 'updated'))], [0, 2]);
$seedAuthor = $db->findFirst('seedAuthors', ['where' => ['uid' => $authorUid]]);
$seedArticle = $db->findFirst('seedArticles', ['where' => ['uid' => $articleUid]]);
eq('cyclic references are stored as their actual target identities', [$seedAuthor['peer'], $seedArticle['peer']], [$seedArticle['id'], $seedAuthor['id']]);
$writeSeed('seedAuthors', [['uid' => \TypedPress\Sync\Uid::mint(), 'fields' => ['name' => 'Missing target', 'peer' => \TypedPress\Sync\Uid::mint()]]]);
$writeSeed('seedArticles', []);
problem('an actual missing seed reference is still refused', fn () => \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir), 422, 'sync_missing_reference', '/fields/peer');
$itemUid = \TypedPress\Sync\Uid::mint(); $newAuthorUid = \TypedPress\Sync\Uid::mint();
$item = $db->insert('aSeedItems', ['uid' => $itemUid, 'name' => 'Existing item'], true)[0];
$writeSeed('aSeedItems', [['uid' => $itemUid, 'fields' => ['name' => 'Existing item', 'peer' => $newAuthorUid]]]);
$writeSeed('seedAuthors', [['uid' => $newAuthorUid, 'fields' => ['name' => 'New author']]]);
$outside = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('a dependency cycle is seeded before an outside collection that references it', [$outside['seedAuthors']['created'], $outside['aSeedItems']['updated']], [1, 1]);
eq('the outside record resolves the new target inside the schema cycle', $db->findFirst('aSeedItems', ['where' => ['id' => $item['id']]])['peer'], $db->findFirst('seedAuthors', ['where' => ['uid' => $newAuthorUid]])['id']);
$nodes = $db->insert('seedNodes', [['name' => 'A'], ['name' => 'B']], true);
$writeSeed('seedNodes', [['uid' => $nodes[0]['uid'], 'fields' => ['name' => 'A', 'parent' => $nodes[0]['uid']]]]);
$selfReference = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('an ordinary parent reference can seed an existing self-reference', $selfReference['seedNodes']['updated'], 1);
$writeSeed('seedNodes', [['uid' => $nodes[0]['uid'], 'fields' => ['name' => 'A', 'parent' => $nodes[1]['uid']]], ['uid' => $nodes[1]['uid'], 'fields' => ['name' => 'B', 'parent' => $nodes[0]['uid']]]]);
$parentCycle = \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir);
eq('ordinary parent reference cycles resolve existing targets', $parentCycle['seedNodes']['updated'], 2);
eq('ordinary parent reference cycles store both target identities', [$db->findFirst('seedNodes', ['where' => ['id' => $nodes[0]['id']]])['parent'], $db->findFirst('seedNodes', ['where' => ['id' => $nodes[1]['id']]])['parent']], [$nodes[1]['id'], $nodes[0]['id']]);
eq('repeating an ordinary parent cycle seed is unchanged', \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir)['seedNodes']['unchanged'], 2);
chmod($seedDir, 0000); clearstatcache(true, $seedDir);
try {
    // A root test runner can still read mode-000 directories; exercise real permission errors elsewhere.
    if (!is_readable($seedDir)) {
        $listingFailed = false;
        try { \TypedPress\Sync\Seed::run($wp->plugin(), $seedDir); }
        catch (RuntimeException $e) { $listingFailed = $e->getMessage() === 'Cannot list seed records'; }
        check('unreadable seed contents throw instead of acknowledging an empty seed', $listingFailed);
    }
} finally { chmod($seedDir, 0700); }
// ---------------------------------------------------------------- the plugin's own seed (`seed: true`)
// A record the seed refuses names the file it was compiled from, and the refusal is kept for the
// build: later requests report it without the lock and without running the records again.
$own = $wp->plugin();
$ownDir = $own->dir . '/tp/app/seed';
$ownVersion = $own->dir . '/tp/app/seed-version.php';
mkdir($ownDir);
$ownUid = \TypedPress\Sync\Uid::mint();
$writeOwn = static function (string $body) use ($ownDir, $ownVersion, $ownUid): array {
    $php = '<?php return ' . var_export(['collection' => 'notes', 'format' => 'md', 'records' => [
        ['uid' => $ownUid, 'fields' => ['title' => 'Seeded from a file'], 'body' => $body, 'path' => 'content/notes/embed.md'],
    ]], true) . ';';
    file_put_contents($ownDir . '/notes.php', $php);
    $version = ['notes.php' => hash('sha256', $php)];
    file_put_contents($ownVersion, '<?php return ' . var_export($version, true) . ';');
    if (function_exists('opcache_invalidate')) { opcache_invalidate($ownDir . '/notes.php', true); opcache_invalidate($ownVersion, true); }

    return $version;
};
$writeOwn("Hello\n\n<iframe src=\"https://example.com\"></iframe>\n");
$seedLock = static fn (callable $fn) => \TypedPress\Wp\Migrator::locked($own->connection(), 'seed', $fn);
$first = clone $own;
$first->installSeed();
$refusal = (string) $first->unavailable();
check('a refused seed record names the file it came from', str_starts_with($refusal, 'Seed refused: content/notes/embed.md: core/html can\'t be written as Markdown'), $refusal);
eq('a refused seed leaves no receipt', get_option('tp_notes_seed'), false);
eq('a refused seed is kept with its message', get_option('tp_notes_seed_refused')['problem'] ?? null, $refusal);
// While this process holds the seed lock, a request that ran the seed again would wait for it.
$started = microtime(true);
$again = $seedLock(static function () use ($own): string {
    $second = clone $own;
    $second->installSeed();

    return (string) $second->unavailable();
});
eq('the next request reports the kept refusal', $again, $refusal);
check('and reports it without waiting for the seed lock', microtime(true) - $started < 5, microtime(true) - $started);
// A seed another request is still importing says so, in its own words.
$kept = get_option('tp_notes_seed_refused');
delete_option('tp_notes_seed_refused');
$busy = $seedLock(static function () use ($own, $ownVersion): string {
    try {
        \TypedPress\Sync\Seed::install($own, $ownVersion, 1);
    } catch (\TypedPress\Wp\LockBusy $e) {
        return $e->getMessage();
    }

    return 'not refused';
});
eq('a held seed lock is reported as a seed, not as migrations', $busy, 'another request is still importing the seed content; try again shortly');
eq('a busy seed lock is not kept as a refusal', get_option('tp_notes_seed_refused'), false);
update_option('tp_notes_seed_refused', $kept, false);
// A new build (another seed version) runs the seed again, and its receipt clears the refusal.
$fixedVersion = $writeOwn("Hello\n\nNo embed here.\n");
$fixed = clone $own;
$fixed->installSeed();
eq('a changed seed version runs the seed again', [$fixed->unavailable(), get_option('tp_notes_seed')], [null, $fixedVersion]);
eq('and its receipt clears the kept refusal', get_option('tp_notes_seed_refused'), false);
eq('the fixed record is seeded', $db->findFirst('notes', ['where' => ['uid' => $ownUid]])['title'] ?? null, 'Seeded from a file');
// An error the app's own hook throws for a record is a refusal too, with the record's file.
$writeOwn("Hello\n");
$hookSeed = require $ownDir . '/notes.php';
$hookSeed['records'][0] = ['uid' => \TypedPress\Sync\Uid::mint(), 'fields' => ['title' => 'forbidden title'], 'path' => 'content/notes/forbidden.md'];
$hookPhp = '<?php return ' . var_export($hookSeed, true) . ';';
file_put_contents($ownDir . '/notes.php', $hookPhp);
file_put_contents($ownVersion, '<?php return ' . var_export(['notes.php' => hash('sha256', $hookPhp)], true) . ';');
if (function_exists('opcache_invalidate')) { opcache_invalidate($ownDir . '/notes.php', true); opcache_invalidate($ownVersion, true); }
$hooked = clone $own;
$hooked->installSeed();
check('an error a hook throws for a seed record names its file and is kept', str_starts_with((string) $hooked->unavailable(), 'Seed refused: content/notes/forbidden.md: this title is not allowed')
    && (get_option('tp_notes_seed_refused')['problem'] ?? null) === $hooked->unavailable(), $hooked->unavailable());
// Activating the plugin again retries a kept refusal.
update_option('tp_notes_seed_refused', $kept, false);
\TypedPress\Sync\Seed::retry($own);
eq('activation forgets a kept seed refusal', get_option('tp_notes_seed_refused'), false);
unlink($ownDir . '/notes.php'); rmdir($ownDir); unlink($ownVersion); delete_option('tp_notes_seed');
foreach (['seedAuthors', 'seedArticles', 'aSeedItems', 'seedNodes'] as $name) { unlink($seedDir . '/' . $name . '.json'); }
unlink($seedDir . '/.ignored.json'); unlink($seedDir . '/README.txt'); rmdir($seedDir);
finish('sync');
