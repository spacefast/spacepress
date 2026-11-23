<?php

declare(strict_types=1);

/*
 * Reactive queries on WordPress, in-process (tests/php/wp.php): the per-kind counters written with
 * each committing transaction, and the subscription seam (SpacePress\Live\Module::evaluate, and the
 * facade route over it) answering "not modified" or a fresh result as the visitor. What a visitor
 * may not read never shows: not a row, not a field, not that a write happened.
 * Concurrent writers and the HTTP cost are proven on MariaDB in tests/wp/live.test.ts.
 */

use SpacePress\Live\Module as Live;
use SpacePress\Live\Token;
use SpacePress\Viewer;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
$text = ['type' => 'text'];
$open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'subscriber'], 'update' => ['role' => 'subscriber'], 'delete' => ['role' => 'subscriber']];
$status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
$schema = ['name' => 'live', 'collections' => [
    // Anyone reads every row and field: answered by counter.
    'lists' => ['key' => 'lists', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'name' => $text], 'access' => $open,
        'relations' => ['todos' => ['kind' => 'many', 'collection' => 'todos', 'from' => 'id', 'to' => 'listId', 'optional' => false]]],
    'todos' => ['key' => 'todos', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'title' => $text, 'listId' => ['type' => 'integer']], 'access' => $open,
        'relations' => ['list' => ['kind' => 'one', 'collection' => 'lists', 'from' => 'listId', 'to' => 'id', 'optional' => true]]],
    // A `ref()` field as the compiler emits it: one name for the column and the relation.
    'chores' => ['key' => 'chores', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'title' => $text, 'list' => ['type' => 'integer', 'references' => ['collection' => 'lists', 'column' => 'id']]], 'access' => $open,
        'relations' => ['list' => ['kind' => 'one', 'collection' => 'lists', 'from' => 'list', 'to' => 'id', 'optional' => true]]],
    // Editors only.
    'secrets' => ['key' => 'secrets', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'title' => $text], 'access' => ['read' => ['role' => 'editor'], 'create' => ['role' => 'editor']]],
    // A field only admins read.
    'staff' => ['key' => 'staff', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'name' => $text, 'salary' => $text + ['access' => ['read' => ['role' => 'admin']]]], 'access' => $open],
    // Rows of their owner only.
    'diary' => ['key' => 'diary', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'entry' => $text, 'ownerId' => ['type' => 'integer']],
        'access' => ['read' => ['fn' => 'diary__access__read'], 'create' => ['role' => 'subscriber'], 'update' => ['role' => 'subscriber'], 'delete' => ['role' => 'subscriber']]],
    // Drafts, in a table (scheduled rows are promoted by Db::promoteDue).
    'memos' => ['key' => 'memos', 'primaryKey' => 'id', 'drafts' => true, 'columns' => ['id' => $id, 'title' => $text, 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]],
        'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']]],
    // A post type: wp-admin and core REST save it without SpacePress's API.
    'articles' => ['key' => 'articles', 'primaryKey' => 'id', 'drafts' => true, 'editor' => true, 'title' => 'title',
        'columns' => ['id' => $id, 'title' => $text + ['notNull' => true], 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]],
        'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']]],
    // Listing switched off on the API.
    'hidden' => ['key' => 'hidden', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'title' => $text], 'access' => $open,
        'api' => ['list' => false, 'get' => true, 'create' => true, 'update' => true, 'delete' => true]],
    // The client's key differs from the stored name.
    'job_notes' => ['key' => 'jobNotes', 'primaryKey' => 'id', 'columns' => ['id' => $id, 'title' => $text], 'access' => $open],
]];
$functions = <<<'PHP'
    function diary__access__read(\SpacePress\JsObject $ctx)
    {
        $user = \SpacePress\Js::prop($ctx, 'user');

        return $user === null ? false : ['ownerId' => \SpacePress\Js::prop($user, 'id')];
    }
    PHP;

$wp = wpSite('live', ['schema' => $schema, 'functions' => $functions, 'users' => ['ed' => 'editor', 'sub' => 'subscriber', 'sub2' => 'subscriber', 'boss' => 'administrator']]);
$app = $wp->app();
$db = $app->db;
$as = static fn (?string $who): Viewer => new Viewer($who === null ? null : $wp->user($who));
$counter = static fn (string $kind, string $scope = 'all'): int => (int) ($wp->scalar('SELECT `version` FROM {prefix}sp__versions WHERE `kind` = ? AND `scope` = ?', [$kind, $scope]) ?? 0);

// Reads that actually ran, per collection: "not modified" by counter must not run one.
$ran = [];
\SpacePress\Extensions::onRead(static function (array $rows, string $collection) use (&$ran): array {
    $ran[$collection] = ($ran[$collection] ?? 0) + 1;

    return $rows;
}, true);
$reads = static function (callable $fn) use (&$ran): array {
    $ran = [];
    $out = $fn();

    return [$out, $ran];
};
/** One query as $who: the result. */
$ask = static fn (?string $who, array $query): array => Live::evaluate($db, $as($who), [$query])[0];
$plain = static fn (mixed $data): mixed => json_decode((string) \SpacePress\Js::jsonStringify($data), true);

// ---------------------------------------------------------------- counters

eq('no counter before any write', $counter('todos'), 0);
$list = $db->insert('lists', ['name' => 'Home'], true)[0];
$db->transaction(static function () use ($db, $list): void {
    $db->insert('todos', ['title' => 'one', 'listId' => $list['id']]);
    $db->insert('todos', ['title' => 'two', 'listId' => $list['id']]);
});
eq('a transaction counts once per kind it wrote, however many rows', $counter('todos'), 1);
eq('each kind has its own counter', $counter('lists'), 1);
eq('a kind without drafts keeps one counter, not two', $wp->sql('SELECT `kind`, `scope` FROM {prefix}sp__versions ORDER BY `kind`, `scope`'), [['kind' => 'lists', 'scope' => 'all'], ['kind' => 'todos', 'scope' => 'all']]);
try {
    $db->transaction(static function () use ($db): void {
        $db->insert('todos', ['title' => 'doomed']);
        throw new \RuntimeException('rollback');
    });
} catch (\RuntimeException) {
}
eq('a rolled-back write counts nothing', $counter('todos'), 1);
$db->insert('todos', ['title' => 'three']);
eq('the transaction after a rollback counts only itself', $counter('todos'), 2);
$db->insert('job_notes', ['title' => 'n']);
eq('counters are kept by collection', $counter('job_notes'), 1);

// ---------------------------------------------------------------- not modified, by counter

$q = ['kind' => 'todos', 'op' => 'list', 'args' => ['orderBy' => ['id' => 'asc']]];
[$first, $n] = $reads(static fn () => $ask(null, $q));
check('a first answer carries the result and a token', $first['changed'] === true && is_string($first['token']) && array_column($plain($first['data']), 'title') === ['one', 'two', 'three'], $first);
eq('the first answer ran the read', $n, ['todos' => 1]);
[$again, $n] = $reads(static fn () => $ask(null, $q + ['token' => $first['token']]));
eq('nothing changed: not modified, no data', array_keys($again), ['changed', 'token']);
eq('not modified', $again['changed'], false);
eq('and the read did not run', $n, []);
check('every answer carries a new token', $again['token'] !== $first['token']);

$db->insert('lists', ['name' => 'Elsewhere']);
[$other, $n] = $reads(static fn () => $ask(null, $q + ['token' => $again['token']]));
eq('a write to a kind the read does not use changes nothing and runs nothing', [$other['changed'], $n], [false, []]);

$db->update('todos', ['title' => 'one!'], ['title' => 'one']);
[$changed, $n] = $reads(static fn () => $ask(null, $q + ['token' => $other['token']]));
check('a write to the kind answers the fresh result', $changed['changed'] === true && array_column($plain($changed['data']), 'title') === ['one!', 'two', 'three'], $changed);
eq('by running the read once', $n, ['todos' => 1]);
eq('the result is spliced in as the JSON it was hashed as', json_decode($changed['json'], true), $plain($changed['data']));

// A write that leaves this result as it was: the counter moved, the read runs, the answer is the same.
$db->insert('todos', ['title' => 'four']);
$top = ['kind' => 'todos', 'op' => 'list', 'args' => ['orderBy' => ['id' => 'asc'], 'limit' => 2]];
$t = $ask(null, $top);
$db->insert('todos', ['title' => 'five']);
[$same, $n] = $reads(static fn () => $ask(null, $top + ['token' => $t['token']]));
eq('a write outside the result is not modified, after one read', [$same['changed'], $n], [false, ['todos' => 1]]);
[$settled, $n] = $reads(static fn () => $ask(null, $top + ['token' => $same['token']]));
eq('and the next poll is answered by counter again', [$settled['changed'], $n], [false, []]);

// A write that commits while a poll's read is running: the token keeps the counters from before
// the read, so the next poll runs the read again instead of trusting a result that missed the write.
$racing = false;
\SpacePress\Extensions::onRead(static function (array $rows, string $collection) use (&$racing, $db): array {
    if ($racing && $collection === 'todos') {
        $racing = false;
        $db->insert('todos', ['title' => 'landed mid-read']);
    }

    return $rows;
}, true);
// (A list: its rows pass the read hook above, after its SQL ran.)
$all = ['kind' => 'todos', 'op' => 'list', 'args' => ['orderBy' => ['id' => 'asc'], 'limit' => 100]];
$c0 = $ask(null, $all);
$db->insert('todos', ['title' => 'six']);
$racing = true;
$c1 = $ask(null, $all + ['token' => $c0['token']]);
eq('the poll answers what its read saw', [$c1['changed'], count($plain($c1['data']))], [true, count($plain($c0['data'])) + 1]);
check('the write landed during that read', $racing === false);
$c2 = $ask(null, $all + ['token' => $c1['token']]);
eq('and the next poll holds the write that landed during it', [$c2['changed'], count($plain($c2['data'] ?? []))], [true, count($plain($c0['data'])) + 2]);

// ---------------------------------------------------------------- every operation

$page = $ask(null, ['kind' => 'todos', 'op' => 'paginate', 'args' => ['orderBy' => ['id' => 'asc'], 'limit' => 2]]);
check('paginate answers { rows, cursor }', array_column($plain($page['data'])['rows'], 'title') === ['one!', 'two'] && is_string($plain($page['data'])['cursor']), $page);
$next = $ask(null, ['kind' => 'todos', 'op' => 'paginate', 'args' => ['orderBy' => ['id' => 'asc'], 'limit' => 2, 'cursor' => $plain($page['data'])['cursor']]]);
eq('the cursor of one page is the next subscription', array_column($plain($next['data'])['rows'], 'title'), ['three', 'four']);
$count = $ask(null, ['kind' => 'todos', 'op' => 'count', 'args' => ['where' => ['title' => ['like' => 't%']]]]);
eq('count', $count['data'], 2);
$one = $ask(null, ['kind' => 'lists', 'op' => 'get', 'id' => $list['id']]);
eq('get by id', $plain($one['data'])['name'], 'Home');
$byFilter = $ask(null, ['kind' => 'lists', 'op' => 'get', 'args' => ['where' => ['name' => 'Home']]]);
eq('get by a filter', $plain($byFilter['data'])['id'], $plain($one['data'])['id']);
eq('get of a missing row is null', $ask(null, ['kind' => 'lists', 'op' => 'get', 'id' => 999999])['data'], null);
$keyed = $ask(null, ['kind' => 'jobNotes', 'op' => 'count']);
eq("a kind is named by the client's key", $keyed['data'], 1);

// ---------------------------------------------------------------- what the read depends on

$with = ['kind' => 'todos', 'op' => 'list', 'args' => ['where' => ['title' => 'two'], 'with' => ['list' => true]]];
$w = $ask(null, $with);
eq('with loads the relation', $plain($w['data'])[0]['list']['name'], 'Home');
$db->update('lists', ['name' => 'House'], ['id' => $list['id']]);
$w2 = $ask(null, $with + ['token' => $w['token']]);
check('a write to a kind loaded through with refreshes the read', $w2['changed'] === true && $plain($w2['data'])[0]['list']['name'] === 'House', $w2);
$through = ['kind' => 'todos', 'op' => 'count', 'args' => ['where' => ['list' => ['name' => 'House']]]];
$r = $ask(null, $through);
eq('a filter through a relation', $r['data'], 2);
$db->update('lists', ['name' => 'Flat'], ['id' => $list['id']]);
$r2 = $ask(null, $through + ['token' => $r['token']]);
eq('a write to the kind a filter looks into refreshes the read', [$r2['changed'], $r2['data'] ?? null], [true, 0]);

// The same through a `ref()` field, where the column and the relation share a name.
$db->insert('chores', ['title' => 'sweep', 'list' => $list['id']]);
$byRef = ['kind' => 'chores', 'op' => 'count', 'args' => ['where' => ['list' => ['name' => 'Flat']]]];
$f = $ask(null, $byRef);
eq('a filter through a ref() field', $f['data'], 1);
$db->update('lists', ['name' => 'Loft'], ['id' => $list['id']]);
$f2 = $ask(null, $byRef + ['token' => $f['token']]);
eq('a write to the kind a ref() field filters into refreshes the read', [$f2['changed'], $f2['data'] ?? null], [true, 0]);
$byValue = ['kind' => 'chores', 'op' => 'count', 'args' => ['where' => ['list' => $list['id']]]];
eq('a ref() field filtered by its value depends on its own kind only', Token::open($ask(null, $byValue)['token'])['c'], [['chores', 'all', $counter('chores')]]);

// ---------------------------------------------------------------- a reader the kind refuses

$db->insert('secrets', ['title' => 'plan']);
$secret = ['kind' => 'secrets', 'op' => 'list'];
$denied = $ask('sub', $secret);
eq('a kind the visitor may not read answers its 403, with no token', [array_keys($denied), $denied['error']['status'], $denied['error']['code']], [['error'], 403, 'forbidden']);
eq('and its 401 to an anonymous visitor', $ask(null, $secret)['error']['status'], 401);
$before = $counter('secrets');
$db->insert('secrets', ['title' => 'second plan']);
check('the write was counted', $counter('secrets') === $before + 1);
eq('a write to it changes nothing in what the refused visitor is answered', $ask('sub', $secret), $denied);
eq('count and get are refused the same way', [$ask('sub', ['kind' => 'secrets', 'op' => 'count'])['error']['status'], $ask('sub', ['kind' => 'secrets', 'op' => 'get', 'id' => 1])['error']['status']], [403, 403]);
$allowed = $ask('ed', $secret);
eq('an editor reads it', array_column($plain($allowed['data']), 'title'), ['plan', 'second plan']);
// A read through a refused kind is refused whole, and a later write to that kind shows nothing.
$viaSecret = ['kind' => 'todos', 'op' => 'count', 'args' => ['where' => ['title' => 'two']]];
$mixed = Live::evaluate($db, $as('sub'), [$viaSecret, $secret]);
eq('one refused query does not fail the others', [isset($mixed[0]['token']), $mixed[1]['error']['status']], [true, 403]);

// ---------------------------------------------------------------- rows of someone else

$mine = $db->insert('diary', ['entry' => 'mine', 'ownerId' => $wp->userId('sub')], true)[0];
$diary = ['kind' => 'diary', 'op' => 'list'];
$d = $ask('sub', $diary);
eq('a filter rule: the owner reads their rows', array_column($plain($d['data']), 'entry'), ['mine']);
$db->insert('diary', ['entry' => 'theirs', 'ownerId' => $wp->userId('sub2')]);
[$d2, $n] = $reads(static fn () => $ask('sub', $diary + ['token' => $d['token']]));
eq("another owner's write is not modified", $d2['changed'], false);
eq('decided by running the read as the visitor, never by the counter', $n, ['diary' => 1]);
[$d3, $n] = $reads(static fn () => $ask('sub', $diary + ['token' => $d2['token']]));
eq('a kind the visitor reads in part is never answered by counter', [$d3['changed'], $n], [false, ['diary' => 1]]);
eq('the other owner sees only theirs', array_column($plain($ask('sub2', $diary)['data']), 'entry'), ['theirs']);
eq('an anonymous visitor is refused', $ask(null, $diary)['error']['status'], 401);

// ---------------------------------------------------------------- a field the visitor may not read

$person = $db->insert('staff', ['name' => 'Ada', 'salary' => '100'], true)[0];
$staff = ['kind' => 'staff', 'op' => 'list'];
$s = $ask('sub', $staff);
eq('a hidden field is absent from the result', $plain($s['data']), [['id' => $person['id'], 'name' => 'Ada']]);
$db->update('staff', ['salary' => '200'], ['id' => $person['id']]);
[$s2, $n] = $reads(static fn () => $ask('sub', $staff + ['token' => $s['token']]));
eq('a write to the hidden field is not modified for that visitor', $s2['changed'], false);
eq('decided by the read, never by the counter', $n, ['staff' => 1]);
// With no write at all the read still runs: a poll costs that visitor the same whether or not a
// field they can't read was written, so its timing says nothing either.
[$s3, $n] = $reads(static fn () => $ask('sub', $staff + ['token' => $s2['token']]));
eq('a visitor a field is hidden from is never answered by counter', [$s3['changed'], $n, Token::open($s3['token'])['c']], [false, ['staff' => 1], null]);
$boss = $ask('boss', $staff);
eq('whoever reads the field gets it', $plain($boss['data'])[0]['salary'], '200');
$db->update('staff', ['salary' => '300'], ['id' => $person['id']]);
[$boss2, $n] = $reads(static fn () => $ask('boss', $staff + ['token' => $boss['token']]));
check('and sees it change', $boss2['changed'] === true && $plain($boss2['data'])[0]['salary'] === '300', $boss2);
problem('a filter on the hidden field is refused as on every read', static function () use ($ask): void {
    $r = $ask('sub', ['kind' => 'staff', 'op' => 'list', 'args' => ['where' => ['salary' => '300']]]);
    throw new \SpacePress\HttpError($r['error']['status'], $r['error']['code'], $r['error']['detail'], $r['error']['pointer'] ?? null);
}, 403, 'forbidden', '/where/salary');

// ---------------------------------------------------------------- drafts

$memos = ['kind' => 'memos', 'op' => 'list', 'args' => ['orderBy' => ['id' => 'asc']]];
$db->insert('memos', ['title' => 'out', 'status' => 'published']);
$m = $ask(null, $memos);
eq('an anonymous visitor reads published rows', array_column($plain($m['data']), 'title'), ['out']);
$allBefore = $counter('memos');
$pubBefore = $counter('memos', 'published');
$draft = $db->insert('memos', ['title' => 'wip', 'status' => 'draft'], true)[0];
eq('a draft moves the all counter only', [$counter('memos') - $allBefore, $counter('memos', 'published') - $pubBefore], [1, 0]);
[$m2, $n] = $reads(static fn () => $ask(null, $memos + ['token' => $m['token']]));
eq('a draft written is not modified for a visitor who reads published rows, without a read', [$m2['changed'], $n], [false, []]);
$editorView = $ask('ed', $memos);
eq('an editor reads the draft', array_column($plain($editorView['data']), 'title'), ['out', 'wip']);
$db->update('memos', ['title' => 'wip 2'], ['id' => $draft['id']]);
[$e2, $n] = $reads(static fn () => $ask('ed', $memos + ['token' => $editorView['token']]));
eq('and sees it change', [$e2['changed'], $n], [true, ['memos' => 1]]);
$db->update('memos', ['status' => 'published'], ['id' => $draft['id']]);
$m3 = $ask(null, $memos + ['token' => $m2['token']]);
check('publishing it reaches the visitor', $m3['changed'] === true && array_column($plain($m3['data']), 'title') === ['out', 'wip 2'], $m3);
$db->update('memos', ['status' => 'draft'], ['id' => $draft['id']]);
$m4 = $ask(null, $memos + ['token' => $m3['token']]);
check('unpublishing it does too', $m4['changed'] === true && array_column($plain($m4['data']), 'title') === ['out'], $m4);
$db->delete('memos', ['id' => $draft['id']]);
[$m5, $n] = $reads(static fn () => $ask(null, $memos + ['token' => $m4['token']]));
eq('deleting a draft is invisible again', [$m5['changed'], $n], [false, []]);

// Scheduled promotion runs no write hooks, yet the row appears to subscribers.
$wp->exec("INSERT INTO {prefix}sp_memos (`title`, `status`, `publishedAt`) VALUES ('later', 'scheduled', '2026-01-02T00:00:00.000Z')");
putenv('SP_NOW=2026-01-03T00:00:00.000Z');
$m6 = $ask(null, $memos); // a token issued at the pinned time
$db->transaction(static fn () => $db->promoteDue());
$m7 = $ask(null, $memos + ['token' => $m6['token']]);
check('a promoted row reaches the visitor', $m7['changed'] === true && array_column($plain($m7['data']), 'title') === ['out', 'later'], $m7);

// ---------------------------------------------------------------- the trust window

[$fresh, $n] = $reads(static fn () => $ask(null, $memos + ['token' => $m7['token']]));
eq('inside the window the counter answers', [$fresh['changed'], $n], [false, []]);
// A write that never passed SpacePress's write path moves no counter...
$wp->exec("UPDATE {prefix}sp_memos SET `title` = 'edited in SQL' WHERE `title` = 'later'");
[$blind, $n] = $reads(static fn () => $ask(null, $memos + ['token' => $fresh['token']]));
eq('a write outside the write path is not seen while the counter is trusted', [$blind['changed'], $n], [false, []]);
// ...so a counter is trusted only so long after the read last ran.
putenv('SP_NOW=' . \SpacePress\Js::iso(\SpacePress\Js::date('2026-01-03T00:00:00.000Z') + Live::TRUST_SECONDS * 1000));
[$late, $n] = $reads(static fn () => $ask(null, $memos + ['token' => $blind['token']]));
check('past the window the read runs again and finds it', $late['changed'] === true && $n === ['memos' => 1] && in_array('edited in SQL', array_column($plain($late['data']), 'title'), true), [$late, $n]);
putenv('SP_NOW');

// ---------------------------------------------------------------- tokens

$t1 = $ask('sub', $q);
$t2 = $ask('sub', $q + ['token' => $t1['token']]);
eq('a token answers its own query', $t2['changed'], false);
$forOther = $ask('sub', ['kind' => 'todos', 'op' => 'list', 'args' => ['orderBy' => ['id' => 'desc']], 'token' => $t1['token']]);
eq('not another query', $forOther['changed'], true);
eq('not another visitor', $ask('sub2', $q + ['token' => $t1['token']])['changed'], true);
eq('not another operation', $ask('sub', ['kind' => 'todos', 'op' => 'paginate', 'args' => ['orderBy' => ['id' => 'asc']], 'token' => $t1['token']])['changed'], true);
foreach (['garbage', '', str_repeat('A', Token::MAX_LENGTH + 1), substr($t1['token'], 0, -4) . 'AAAA', 42, ['x']] as $bad) {
    check('a token this site did not issue is no token: ' . json_encode(is_string($bad) ? substr($bad, 0, 12) : $bad), $ask('sub', $q + ['token' => $bad])['changed'] === true);
}
$raw = (string) base64_decode(strtr($t1['token'], '-_', '+/'));
check('a token is sealed: no kind, claim name or hash shows in it', !str_contains($raw, 'todos') && !str_contains($raw, '"c"') && !str_contains($raw, (string) Token::open($t1['token'])['h']), bin2hex($raw));
check('and its claims open only with the site key', Token::open($t1['token']) !== null && array_keys(Token::open($t1['token'])) === ['q', 'c', 'h', 't']);
// Its length doesn't follow a counter's digits: counters of 9 and 10 seal to tokens of one length.
$sealed = static fn (int $n): int => strlen(Token::seal(['q' => 'x', 'c' => [['todos', 'all', $n]], 'h' => str_repeat('h', 44), 't' => 1]));
eq('a token is padded', [$sealed(9), $sealed(99)], [$sealed(10), $sealed(100)]);
// A post-password cookie changes what a visitor reads, so a token is for one cookie.
$_COOKIE['wp-postpass_' . COOKIEHASH] = 'a-proof';
eq('another visitor\'s password proof makes a token no token', $ask(null, $q + ['token' => $ask(null, $q)['token']])['changed'], false);
$held = $ask(null, $q)['token'];
unset($_COOKIE['wp-postpass_' . COOKIEHASH]);
eq('a token held under one password proof answers nothing without it', $ask(null, $q + ['token' => $held])['changed'], true);
// Two visitors who may not read a kind's rows alike never share what a token says: the refused one holds none.
eq('a refused read issues no token to compare', array_key_exists('token', $ask('sub', $secret)), false);
// A visitor answered by hash holds a token without counters.
eq('a read answered by hash seals no counter', Token::open($ask('sub', $diary)['token'])['c'], null);
eq('a read answered by counter seals the counters it may see', Token::open($t1['token'])['c'], [['todos', 'all', $counter('todos')]]);
eq('a visitor who reads published rows seals the published counter only', Token::open($ask(null, $memos)['token'])['c'], [['memos', 'published', $counter('memos', 'published')]]);

// ---------------------------------------------------------------- wp-admin and core saves

$article = $db->insert('articles', ['title' => 'Hello', 'status' => 'published'], true)[0];
$articles = ['kind' => 'articles', 'op' => 'list'];
$a = $ask(null, $articles);
eq('a post kind lists', array_column($plain($a['data']), 'title'), ['Hello']);
$wp->actAs('ed');
$updated = wp_update_post(['ID' => (int) $article['id'], 'post_title' => 'Hello from wp-admin'], true);
$wp->actAs(null);
check('core saved the post', $updated === (int) $article['id'], $updated);
$a2 = $ask(null, $articles + ['token' => $a['token']]);
check("a save through WordPress's own API is counted and reaches the visitor", $a2['changed'] === true && array_column($plain($a2['data']), 'title') === ['Hello from wp-admin'], $a2);
$wp->actAs('ed');
$draftId = wp_insert_post(['post_type' => 'sp_articles', 'post_title' => 'Core draft', 'post_status' => 'draft'], true);
$wp->actAs(null);
check('core created a draft', is_int($draftId) && $draftId > 0, $draftId);
[$a3, $n] = $reads(static fn () => $ask(null, $articles + ['token' => $a2['token']]));
eq('a draft saved in wp-admin is invisible to the visitor, without a read', [$a3['changed'], $n], [false, []]);
$wp->actAs('ed');
wp_delete_post((int) $article['id'], true);
$wp->actAs(null);
$a4 = $ask(null, $articles + ['token' => $a3['token']]);
eq('a permanent delete in wp-admin reaches the visitor', [$a4['changed'], $plain($a4['data'] ?? null)], [true, []]);
// Move to Trash (wp-admin's, and core REST's DELETE without `force`) and back.
$kept = $db->insert('articles', ['title' => 'Trashed', 'status' => 'published'], true)[0];
$t0 = $ask(null, $articles);
$wp->actAs('ed');
wp_trash_post((int) $kept['id']);
$wp->actAs(null);
$t1 = $ask(null, $articles + ['token' => $t0['token']]);
eq('moving a published post to the trash reaches the visitor', [$t1['changed'], array_column($plain($t1['data'] ?? []), 'title')], [true, []]);
$wp->actAs('ed');
wp_untrash_post((int) $kept['id']);
wp_publish_post((int) $kept['id']);
$wp->actAs(null);
$t2 = $ask(null, $articles + ['token' => $t1['token']]);
eq('and restoring it does too', [$t2['changed'], array_column($plain($t2['data'] ?? []), 'title')], [true, ['Trashed']]);

// ---------------------------------------------------------------- bounds

$many = array_fill(0, 4, ['kind' => 'todos', 'op' => 'count']);
$bounded = Live::evaluate($db, $as(null), [$top, ...$many], 0);
eq('past the time budget the rest are pending; the first always runs', array_map(static fn ($r) => array_keys($r), $bounded), [['changed', 'token', 'data', 'json'], ['pending'], ['pending'], ['pending'], ['pending']]);
for ($i = count($db->findMany('todos', ['limit' => 1000])); $i < Live::MAX_LIST_LIMIT + 5; $i++) {
    $db->insert('todos', ['title' => "filler $i"]);
}
$capped = $ask(null, ['kind' => 'todos', 'op' => 'list', 'args' => ['limit' => 100000]]);
eq('a list is capped at the API limit', count($plain($capped['data'])), Live::MAX_LIST_LIMIT);
foreach ([
    'an unknown kind' => [['kind' => 'nope', 'op' => 'list'], 404, 'not_found', '/queries/0/kind'],
    'the stored name is not the key' => [['kind' => 'job_notes', 'op' => 'list'], 404, 'not_found', '/queries/0/kind'],
    'an unknown op' => [['kind' => 'todos', 'op' => 'delete'], 422, 'invalid_input', '/queries/0/op'],
    'a write op' => [['kind' => 'todos', 'op' => 'create', 'args' => ['title' => 'x']], 422, 'invalid_input', '/queries/0/op'],
    'an unknown option' => [['kind' => 'todos', 'op' => 'list', 'args' => ['columns' => ['id' => true]]], 400, 'invalid_query', '/queries/0/args/columns'],
    'an unknown key' => [['kind' => 'todos', 'op' => 'list', 'as' => 'admin'], 422, 'invalid_input', '/queries/0/as'],
    'get without an id' => [['kind' => 'todos', 'op' => 'get'], 422, 'invalid_input', '/queries/0/id'],
    'an id on a list' => [['kind' => 'todos', 'op' => 'list', 'id' => 1], 422, 'invalid_input', '/queries/0/id'],
    'a bad limit' => [['kind' => 'todos', 'op' => 'list', 'args' => ['limit' => 0]], 400, 'invalid_query', '/queries/0/args/limit'],
    'not an object' => ['todos', 422, 'invalid_input', '/queries/0'],
    'an offset past the API\'s' => [['kind' => 'todos', 'op' => 'list', 'args' => ['offset' => Live::MAX_OFFSET + 1]], 400, 'invalid_query', '/queries/0/args/offset'],
    'relations nested too deep' => [['kind' => 'todos', 'op' => 'list', 'args' => ['with' => ['list' => ['with' => ['todos' => ['with' => ['list' => ['with' => ['todos' => true]]]]]]]]], 400, 'invalid_query', '/queries/0/args/with'],
    'listing switched off' => [['kind' => 'hidden', 'op' => 'list'], 405, 'method_not_allowed', '/queries/0/op'],
    'counting switched off with it' => [['kind' => 'hidden', 'op' => 'count'], 405, 'method_not_allowed', '/queries/0/op'],
] as $label => [$query, $status, $code, $pointer]) {
    $e = Live::evaluate($db, $as(null), [$query])[0]['error'] ?? null;
    eq("refused: $label", [$e['status'] ?? null, $e['code'] ?? null, $e['pointer'] ?? null], [$status, $code, $pointer]);
}
check('get stays on while list is off', array_key_exists('data', $ask(null, ['kind' => 'hidden', 'op' => 'get', 'id' => 1])));

// ---------------------------------------------------------------- the route

$route = static function (?string $who, mixed $body, string $method = 'POST') use ($wp): array {
    $wp->actAs($who);
    try {
        [$status, $headers, $out] = \SpacePress\Wp\Facade::route($wp->plugin(), $method, '/_live', [], is_string($body) ? $body : (string) json_encode($body));

        return [$status, $headers, json_decode((string) $out, true)];
    } finally {
        $wp->actAs(null);
    }
};
[$status, $headers, $out] = $route('sub', ['queries' => [$q, $secret]]);
eq('the route answers 200 with one result per query', [$status, count($out['data']['results'])], [200, 2]);
eq('never cached for another visitor', [$headers['Cache-Control'], $headers['Vary']], ['private, no-store', 'Origin, Cookie, Authorization']);
eq('a result on the wire: changed, token, data', array_keys($out['data']['results'][0]), ['changed', 'token', 'data']);
eq('a refusal on the wire: the problem', [array_keys($out['data']['results'][1]), $out['data']['results'][1]['error']['status']], [['error'], 403]);
eq('the poll window the client keeps to', $out['data']['poll'], Live::POLL);
[, , $second] = $route('sub', ['queries' => [$q + ['token' => $out['data']['results'][0]['token']]]]);
eq('not modified on the wire: no data', [array_keys($second['data']['results'][0]), $second['data']['results'][0]['changed']], [['changed', 'token'], false]);
[, , $asOther] = $route('sub2', ['queries' => [$q + ['token' => $out['data']['results'][0]['token']]]]);
eq('the route answers as the signed-in visitor', $asOther['data']['results'][0]['changed'], true);
add_filter('sp_live_poll', static fn (array $poll): array => ['minMs' => 5000, 'bogus' => 1] + $poll);
eq('a host sets the window with sp_live_poll', $route(null, ['queries' => [$q]])[2]['data']['poll'], ['minMs' => 5000, 'maxMs' => 30000]);
remove_all_filters('sp_live_poll');
problem('GET is not allowed', static fn () => $route(null, ['queries' => [$q]], 'GET'), 405, 'method_not_allowed');
problem('no queries', static fn () => $route(null, ['queries' => []]), 422, 'invalid_input', '/queries');
problem('queries must be a list', static fn () => $route(null, ['queries' => ['a' => $q]]), 422, 'invalid_input', '/queries');
problem('too many queries', static fn () => $route(null, ['queries' => array_fill(0, Live::MAX_QUERIES + 1, $q)]), 422, 'invalid_input', '/queries');
eq('MAX_QUERIES is accepted', count($route(null, ['queries' => array_fill(0, Live::MAX_QUERIES, $q)])[2]['data']['results']), Live::MAX_QUERIES);
problem('an oversized body', static fn () => $route(null, '{"queries":[],"pad":"' . str_repeat('x', Live::MAX_BODY) . '"}'), 413, 'payload_too_large');
problem('invalid JSON', static fn () => $route(null, '{nope'), 400, 'invalid_json');

finish('live');
