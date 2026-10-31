<?php

declare(strict_types=1);

/*
 * Content sync runtime (design §5.3) on standalone, in-process through App::handle against a real
 * SQLite file: canonical JSON golden, uid minting, /sync reads/writes/trash, reference uids, body
 * conversion fixtures and the server-side merge. WordPress behaviour is proven by tests/wp/sync.test.ts.
 */

use Zero\App;
use Zero\Sync\Canon;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = sys_get_temp_dir() . '/zero-sync-test-' . bin2hex(random_bytes(4));
$editor = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']];
$api = ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true];
$schema = [
    'version' => 3, 'runtime' => '0.2', 'name' => 'notes', 'target' => 'standalone', 'site' => ['uidPrefix' => 'zr_'],
    'collections' => [
        'people' => [
            'primaryKey' => 'id', 'uid' => true, 'sync' => null, 'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'name' => ['type' => 'text', 'notNull' => true],
                'uid' => ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]],
            ],
        ],
        'notes' => [
            'primaryKey' => 'id', 'uid' => true, 'sync' => ['dir' => 'content/notes', 'format' => 'md'], 'title' => 'title', 'content' => 'body', 'slug' => 'slug',
            'drafts' => true, 'revisions' => true, 'access' => ['create' => ['fn' => 'notes__create'], 'update' => ['fn' => 'notes__update']] + $editor, 'api' => $api, 'relations' => [],
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
    namespace ZeroApp;
    // Authors and up create; while the test flag is set, only published rows (status comes from its default).
    function notes__create($ctx) {
        $rank = ['author' => 1, 'editor' => 2, 'admin' => 3][$ctx['user']['role'] ?? ''] ?? 0;
        if (empty($GLOBALS['zeroCreateNeedsPublished'])) {
            return $rank >= 1;
        }
        // The generated `now` values must be the instant the rule itself reads.
        $now = \Zero\Js::iso(\Zero\Js::now());
        return $rank >= 1 && ($ctx['data']['status'] ?? null) === 'published'
            && ($ctx['data']['publishedAt'] ?? null) === $now && ($ctx['data']['updatedAt'] ?? null) === $now;
    }
    // Editors may update every note; authors only notes credited to a person with their name (a filter).
    function notes__update($ctx) {
        return match ($ctx['user']['role'] ?? null) {
            'editor', 'admin' => true,
            'author' => ['authorId' => ['in' => array_column(\Zero\db()->findMany('people', ['where' => ['name' => $ctx['user']['name']]]), 'id')]],
            default => false,
        };
    }
    // Normalisation the client didn't send: titles are trimmed.
    function notes__beforeCreate($data) { return ['title' => trim($data['title'])] + $data; }
    // A hook that tries to rewrite identity: the runtime must refuse it after the hook.
    // A compiled hook returning `{}` (the empty-object marker) replaces the patch with nothing to change.
    function notes__beforeUpdate($patch, $existing) { return match ($patch['title'] ?? null) { 'steal uid' => $patch + ['uid' => 'zr_99999999999999999999'], 'drop it' => new \Zero\JsObject(), default => $patch }; }
    PHP;
$migration = <<<'SQL'
    CREATE TABLE "people" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "uid" text);
    --> statement-breakpoint
    CREATE UNIQUE INDEX "people_uid_unique" ON "people" ("uid");
    --> statement-breakpoint
    CREATE TABLE "notes" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" text NOT NULL, "slug" text, "body" text, "meta" text,
      "authorId" integer REFERENCES "people"("id") ON DELETE set null, "updatedAt" text NOT NULL,
      "status" text DEFAULT 'published' NOT NULL, "publishedAt" text, "uid" text);
    --> statement-breakpoint
    CREATE UNIQUE INDEX "notes_slug_unique" ON "notes" ("slug");
    --> statement-breakpoint
    CREATE UNIQUE INDEX "notes_uid_unique" ON "notes" ("uid");
    SQL;
@mkdir("$root/zero/app/migrations", 0777, true);
@mkdir("$root/data", 0777, true);
file_put_contents("$root/zero/app/schema.php", '<?php return ' . var_export($schema, true) . ';');
file_put_contents("$root/zero/app/functions.php", $functions);
file_put_contents("$root/zero/app/migrations/0001_init.sql", $migration);
copyRuntime($root);
putenv('ZERO_DB_PATH');
putenv('ZERO_AUTO_MIGRATE');
ini_set('error_log', "$root/error.log");
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));

require "$root/zero/runtime/bootstrap.php";
$app = App::boot($root);
$db = \Zero\db();
$tokens = [];
foreach (['ed' => 'editor', 'au' => 'author'] as $name => $role) {
    $app->identity()->addUser($name, $role, null);
    $tokens[$name] = $app->identity()->createToken($name, null)['token'];
}

/** @return array{int, mixed} [status, data or problem] */
function req(string $method, string $path, mixed $body = null, ?string $as = 'ed', array $query = []): array
{
    global $app, $tokens;
    $headers = $as === null ? [] : ['authorization' => 'Bearer ' . $tokens[$as]];
    [$status, , $out] = $app->handle($method, $path, $query, $body === null ? '' : json_encode($body), $headers);
    $json = json_decode($out, true);

    return [$status, $status < 300 ? ($json['data'] ?? null) : $json];
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

$ada = $db->insert('people', ['name' => 'Ada'], true)[0];
check('uid minted on insert', preg_match('/^zr_[0-9a-f]{20}$/D', $ada['uid']) === 1, $ada);
isProblem('uid is immutable', req('PATCH', "/people/{$ada['id']}", ['uid' => 'zr_00000000000000000000']), 422, 'invalid_input', '/uid');
$hooked = $db->insert('notes', ['title' => 'Hooked'], true)[0];
problem('a hook cannot change a uid either', fn () => $db->update('notes', ['title' => 'steal uid'], ['id' => $hooked['id']]), 422, 'invalid_input', '/uid');
$before = $db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['title'];
$db->update('notes', ['title' => 'drop it'], ['id' => $hooked['id']]);
eq('a beforeUpdate returning {} replaces the patch with nothing', $db->findFirst('notes', ['where' => ['id' => $hooked['id']]])['title'], $before);
// What sync authorizes (Wire::decode's data) is plain outside json(): a select sent as `{}` is [].
eq('sync hands rules plain arrays outside json() values, and keeps {} inside them', \Zero\Js::jsonStringify(\Zero\Sync\Wire::decode('notes',
    \Zero\Js::decodeJson('{"uid":"zr_0f0f0f0f0f0f0f0f0f0f","fields":{"title":"T","meta":{"a":{}}},"body":null}'), true)), '{"title":"T","meta":{"a":{}},"body":null}');
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

$noteUid = 'zr_aaaaaaaaaaaaaaaaaaaa';
$record = ['uid' => $noteUid, 'fields' => ['title' => 'First', 'slug' => 'first', 'meta' => ['b' => 1, 'a' => [true]], 'authorId' => $ada['uid'], 'status' => 'draft', 'publishedAt' => null],
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
// `fields: {}` (an object on the wire, the marker once decoded) is an empty field set, not a type error.
[$s, $empty] = req('POST', '/sync/notes', ['record' => ['uid' => 'zr_0e0e0e0e0e0e0e0e0e0e', 'fields' => new stdClass(), 'body' => null], 'expect' => 'absent']);
check('a push with fields: {} is accepted as an object (then the required title is what is missing)', $s === 422 && ($empty['pointer'] ?? null) === '/title', $empty);
$stale = req('POST', '/sync/notes', ['record' => ['fields' => ['title' => 'Later']] + $record, 'expect' => 'sha256:' . str_repeat('0', 64)]);
isProblem('wrong expected digest is stale', $stale, 409, 'sync_stale');
eq('stale carries the current record and digest', [$stale[1]['current']['digest'], $stale[1]['current']['record']], [$created['digest'], $record]);
eq('stale wrote nothing', $db->findFirst('notes', ['where' => ['uid' => $noteUid]])['title'], 'First');

$spaced = ['uid' => 'zr_cccccccccccccccccccc', 'fields' => ['title' => '  Spaced  ', 'slug' => 'spaced'], 'body' => null];
[$s, $normalized] = req('POST', '/sync/notes', ['record' => $spaced, 'expect' => 'absent']);
eq('a hook that reshapes the write reports normalized with the stored record',
    [$s, $normalized['status'], $normalized['record']['fields']['title']], [201, 'normalized', 'Spaced']);
eq('normalized digest is the stored record', $normalized['digest'], Canon::digest($normalized['record']));


// `{}` and `[]` are different JSON, and a json() value keeps the difference through storage, so the
// write is applied as sent and the digest a client holds is one a pull reproduces.
$shapes = ['uid' => 'zr_ffffffffffffffffffff', 'fields' => ['title' => 'Shapes', 'slug' => 'shapes', 'meta' => ['nested' => new stdClass(), 'list' => []], 'authorId' => null, 'status' => 'draft', 'publishedAt' => null], 'body' => null];
[, $shaped] = req('POST', '/sync/notes', ['record' => $shapes, 'expect' => 'absent']);
[, , $raw] = $app->handle('GET', '/sync/notes', ['after' => '0', 'first' => '100'], '', ['authorization' => 'Bearer ' . $tokens['ed']]);
eq('{} and [] in a json() value are kept apart: applied as sent, pulled back apart',
    [$shaped['status'], str_contains($raw, '"meta":{"list":[],"nested":{}}') || str_contains($raw, '"meta":{"nested":{},"list":[]}')], ['applied', true]);
eq('an answer digest is the digest a pull returns', $shaped['digest'], pull('notes')['zr_ffffffffffffffffffff']['digest']);
// Re-push the pulled record as the wire carried it (decoding it to PHP arrays would turn {} into []).
$pulled = array_values(array_filter(json_decode($raw, false)->data->records, static fn ($r) => ($r->uid ?? $r->record->uid) === 'zr_ffffffffffffffffffff'))[0];
[, , $out] = $app->handle('POST', '/sync/notes', [], json_encode(['record' => $pulled->record, 'expect' => $shaped['digest']]), ['authorization' => 'Bearer ' . $tokens['ed']]);
eq('and pushing the pulled record is a no-op', json_decode($out, true)['data']['status'] ?? $out, 'unchanged');

// A read transform (lane B's field access) hides `meta` from the viewer: the answer to a write is what
// that viewer pulls, never the trusted row.
\Zero\Extensions::onRead(static fn (array $rows, string $c, ?\Zero\Viewer $v) => $c === 'notes' && $v !== null && ($v->user['name'] ?? null) === 'ed'
    ? array_map(static fn (array $r) => array_diff_key($r, ['meta' => true]), $rows) : $rows);
$hidden = ['uid' => 'zr_eeeeeeeeeeeeeeeeeeee', 'fields' => ['title' => ' Hidden ', 'slug' => 'hidden', 'meta' => ['secret' => 1]], 'body' => null];
[, $answer] = req('POST', '/sync/notes', ['record' => $hidden, 'expect' => 'absent']);
check('a normalized answer carries only what the viewer reads', !array_key_exists('meta', $answer['record']['fields']), $answer['record']);
eq('and the digest a pull by that viewer returns', $answer['digest'], pull('notes')['zr_eeeeeeeeeeeeeeeeeeee']['digest']);

// ================================================================ references and validation

$orphan = ['uid' => 'zr_bbbbbbbbbbbbbbbbbbbb', 'fields' => ['title' => 'Orphan', 'authorId' => 'zr_ffffffffffffffffffff'], 'body' => null];
isProblem('unknown reference uid', req('POST', '/sync/notes', ['record' => $orphan, 'expect' => 'absent']), 422, 'sync_missing_reference', '/fields/authorId');
isProblem('references are not resolved for a caller who may not write', req('POST', '/sync/notes', ['record' => $orphan, 'expect' => 'absent'], as: null), 401, 'unauthenticated');
isProblem('generated columns are not writable', req('POST', '/sync/notes', ['record' => ['fields' => ['updatedAt' => '2000-01-01T00:00:00Z']] + $orphan, 'expect' => 'absent']), 422, 'invalid_input', '/fields/updatedAt');
isProblem('validation runs through the pipeline', req('POST', '/sync/notes', ['record' => ['fields' => ['status' => 'bogus', 'title' => 'x']] + $orphan, 'expect' => 'absent']), 422, 'invalid_input', '/status');

$unsynced = $db->insert('people', ['name' => 'Legacy'], true)[0];
$db->store()->update('people', $unsynced['id'], ['uid' => null]);
$db->update('notes', ['authorId' => $unsynced['id']], ['uid' => $noteUid]);
$legacyUid = pull('notes')[$noteUid]['record']['fields']['authorId'];
eq('a referenced row without a uid gets one on pull', $legacyUid, $db->findFirst('people', ['where' => ['id' => $unsynced['id']]])['uid']);

// ================================================================ access

isProblem('anonymous cannot pull', req('GET', '/sync/notes', as: null), 401, 'unauthenticated');
isProblem('a filtered update rule is not enough to pull', req('GET', '/sync/notes', as: 'au'), 403, 'forbidden');
isProblem('nor to convert', req('POST', '/sync/notes/convert', ['direction' => 'toBlocks', 'text' => 'x'], as: 'au'), 403, 'forbidden');
isProblem('collections without sync have no sync route', req('GET', '/sync/people'), 404, 'not_found');

// Writes are authorized row by row through the pipeline: an author may create and may update rows
// their filter matches, but a stale write discloses nothing to a caller who can't pull.
$au = $db->insert('people', ['name' => 'au'], true)[0];
// A create rule reading defaulted values sees them on sync as on an ordinary create, and reads the
// write's one instant: the clock moves a millisecond on every read (ZERO_NOW_STEP), so sync's preview
// and the rule evaluation must not read it separately.
$GLOBALS['zeroCreateNeedsPublished'] = true;
putenv('ZERO_NOW=2026-01-01T00:00:00.000Z');
putenv('ZERO_NOW_STEP=1');
$plain = req('POST', '/notes', ['title' => 'Plain', 'slug' => 'plain-create'], as: 'au');
[$s] = req('POST', '/sync/notes', ['record' => ['uid' => 'zr_12121212121212121212', 'fields' => ['title' => 'Synced', 'slug' => 'synced-create'], 'body' => null], 'expect' => 'absent'], as: 'au');
eq('a create rule sees defaults on sync as on an ordinary create', [$plain[0], $s], [201, 201]);
putenv('ZERO_NOW_STEP');
putenv('ZERO_NOW');
unset($GLOBALS['zeroCreateNeedsPublished']);
$own = ['uid' => 'zr_dddddddddddddddddddd', 'fields' => ['title' => 'Mine', 'slug' => 'mine', 'meta' => null, 'authorId' => $au['uid'], 'status' => 'draft', 'publishedAt' => null], 'body' => null];
[$s, $mine] = req('POST', '/sync/notes', ['record' => $own, 'expect' => 'absent'], as: 'au');
eq('the create rule authorizes a new uid', [$s, $mine['status']], [201, 'applied']);
eq('a filtered update rule authorizes rows it matches', req('POST', '/sync/notes', ['record' => ['body' => "Edited.\n"] + $own, 'expect' => $mine['digest']], as: 'au')[1]['status'], 'applied');
$theirs = pull('notes')['zr_cccccccccccccccccccc'];
isProblem('and masks rows it does not, as item routes do', req('POST', '/sync/notes', ['record' => ['body' => 'Mine now'] + $theirs['record'], 'expect' => $theirs['digest']], as: 'au'), 404, 'not_found');
isProblem('authorization comes before staleness, so a probe learns nothing', req('POST', '/sync/notes', ['record' => $theirs['record'], 'expect' => 'absent'], as: 'au'), 404, 'not_found');
isProblem('nor does an anonymous no-op push', req('POST', '/sync/notes', ['record' => $theirs['record'], 'expect' => $theirs['digest']], as: null), 401, 'unauthenticated');
$leak = req('POST', '/sync/notes', ['record' => $own, 'expect' => 'absent'], as: 'au');
isProblem('a stale write on a row the caller may update', $leak, 409, 'sync_stale');
check('carries no current record for a caller who cannot pull', !array_key_exists('current', $leak[1]), $leak[1]);
isProblem('trash needs the delete rule', req('POST', '/sync/notes/trash', ['uid' => $own['uid'], 'expect' => $mine['digest']], as: 'au'), 403, 'forbidden');

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
check('standalone trash deletes the row (revisions keep it)', $db->findFirst('notes', ['where' => ['uid' => $noteUid]]) === null && !isset(pull('notes')[$noteUid]));
eq('trash of an absent uid is unchanged', req('POST', '/sync/notes/trash', ['uid' => $noteUid, 'expect' => $current['digest']])[1]['status'], 'unchanged');

// ================================================================ convert (fixtures) and merge

$fixtures = dirname(__DIR__) . '/fixtures/sync';
$convert = static fn (string $direction, string $text) => req('POST', '/sync/notes/convert', ['direction' => $direction, 'text' => $text]);
$markdown = file_get_contents("$fixtures/document.md");
$blocks = $convert('toBlocks', $markdown)[1]['text'];
eq('Markdown is a fixed point through blocks', $convert('toMarkdown', $blocks)[1]['text'], $markdown);
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

finish('sync');
