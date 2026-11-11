<?php

declare(strict_types=1);

/*
 * Feature 3 (§6.1) on WordPress, in-process (tests/php/wp.php): the transactional outbox, dedupe
 * keys, retries with backoff and the dead state, once() receipts, the Idempotency-Key header, receipt
 * sweep and the `jobs` CLI. Time moves through FIRST_NOW; the runner is called directly, and due jobs
 * are drained through Action Scheduler's queue runner (the delivery every WordPress site uses; AS
 * through WP-CLI and cron is proven in tests/wp/jobs.test.ts).
 */

use First\Jobs\Jobs;
use First\Jobs\Runner;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// The blog fixture plus what a compiled jobs config adds: one job, an idempotent action, a hook
// that enqueues, and a once() call (these bodies are what the compiler emits for them).
$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['jobs'] = ['notify' => [
    'input' => ['postId' => ['type' => 'integer', 'notNull' => true], 'note' => ['type' => 'text']],
    'handler' => 'job__notify', 'retries' => 3, 'agents' => false,
]];
$schema['actions']['remember'] = ['input' => ['note' => ['type' => 'text', 'notNull' => true]], 'handler' => 'action__remember',
    'access' => ['role' => 'anyone'], 'agents' => true, 'idempotent' => true, 'signature' => null];
$schema['actions']['plain'] = ['input' => [], 'handler' => 'action__plain',
    'access' => ['role' => 'anyone'], 'agents' => true, 'idempotent' => false, 'signature' => null];
$schema['collections']['posts']['hooks']['afterCreate'] = 'posts__afterCreate';
$functions = file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

    function job__notify(\First\JsObject $input, $ctx)
    {
        if (($input->p['note'] ?? null) === 'fail') {
            // Writes and enqueues first, so the failure must roll them back.
            \First\db()->insert('comments', ['postId' => $input->p['postId'], 'name' => 'partial', 'body' => $ctx->p['jobId']]);
            \First\Jobs\Jobs::enqueue('notify', ['postId' => $input->p['postId'], 'note' => 'from-failed']);
            throw new \First\JsError('notify failed on attempt ' . $ctx->p['attempt']);
        }
        \First\db()->insert('comments', ['postId' => $input->p['postId'], 'name' => 'job', 'body' => $ctx->p['jobId'] . ':' . $ctx->p['attempt'] . ':' . ($ctx->p['user'] === null ? 'nobody' : 'someone')]);
    }

    function posts__afterCreate(\First\JsObject $row, $ctx)
    {
        \First\Jobs\Jobs::enqueue('notify', ['postId' => $row->p['id'], 'note' => $row->p['excerpt']], $row->p['excerpt'] === 'keyed' ? ['key' => 'post-' . $row->p['title']] : null);
        if ($row->p['title'] === 'Explode') {
            throw new \First\HttpError(500, 'boom', 'afterCreate exploded');
        }
    }

    function action__remember(\First\JsObject $input, $ctx)
    {
        $key = 'remember-' . ($input->p['note'] === 'a2' ? 'a' : $input->p['note']);

        $result = \First\Jobs\Receipts::once('fn', $key, fn () => ['note' => $input->p['note'], 'at' => count(\First\db()->findMany('comments')), 'empty' => new \stdClass(), 'list' => []]);
        $result['f'] = static fn () => 1;
        return $result;
    }

    function action__plain(\First\JsObject $input, $ctx)
    {
        return count(\First\db()->findMany('comments'));
    }
    PHP;

$wp = wpSite('jobs', ['schema' => $schema, 'functions' => $functions, 'users' => ['ed' => 'editor']]);
$app = $wp->app();
$db = $app->db;
$jobs = static fn (?string $state = null) => $wp->sql('SELECT * FROM {prefix}first__jobs' . ($state === null ? '' : " WHERE `state` = '$state'") . ' ORDER BY `createdAt`, `id`');
$job = static fn (string $id) => $wp->sql('SELECT * FROM {prefix}first__jobs WHERE `id` = ?', [$id])[0] ?? null;
$outbox = static fn () => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__outbox');
/** Action Scheduler's pending delivery for a job: its scheduled time, or null. */
$delivery = static fn (string $id) => $wp->scalar('SELECT `scheduled_date_gmt` FROM {prefix}actionscheduler_actions WHERE `hook` = ? AND `args` = ? AND `status` = ? ORDER BY `action_id` DESC',
    [\First\Wp\Jobs\ActionSchedulerQueue::HOOK, json_encode(['id' => $id]), 'pending']);
/** Run every due action through Action Scheduler's queue runner, as cron would: [ran, done, failed, dead]. */
$drain = static function () use ($wp): array {
    $before = array_column($wp->sql('SELECT `id`, `state` FROM {prefix}first__jobs'), 'state', 'id');
    ActionScheduler_QueueRunner::instance()->run('First tests');
    $after = array_column($wp->sql('SELECT `id`, `state` FROM {prefix}first__jobs'), 'state', 'id');
    $ran = array_filter($after, static fn (string $state, string $id) => ($before[$id] ?? null) !== $state, ARRAY_FILTER_USE_BOTH);

    return ['ran' => count($ran)] + array_count_values($ran);
};
$request = static function (string $method, string $path, mixed $body = null, array $headers = [], ?string $as = null) use ($wp): array {
    [$status, $out, $raw] = $wp->handle($method, $path, $body === null ? '' : json_encode($body), $as, $headers);

    return [$status, json_decode($raw, true), array_change_key_case($out, CASE_LOWER)];
};
$cli = static fn (string ...$args) => $wp->cli(...$args);
$post = static fn (string $title, ?string $excerpt = null) => $request('POST', '/posts', ['title' => $title, 'excerpt' => $excerpt], [], 'ed');
// First's clock is pinned at this instant; Action Scheduler keeps the real one. Deliveries are
// scheduled no earlier than real now, so the two must agree at the start: later moves of the pinned
// clock call the runner directly, as a worker would.
$t0 = time();
$at = static fn (int $seconds, int $ms = 0): string => \First\Js::iso($t0 * 1000 + $seconds * 1000 + $ms);
$asTime = static fn (int $seconds): string => gmdate('Y-m-d H:i:s', $t0 + $seconds);

// ---- outbox: a committed write queues its job; a rolled-back write leaves nothing --------------------------------
putenv('FIRST_NOW=' . $at(0));
[$status, $created] = $post('Hello');
eq('create with an enqueueing hook', $status, 201);
$pid = $created['data']['id'];
$queued = $jobs();
check('the job is queued after commit with its validated input', count($queued) === 1 && $queued[0]['state'] === 'pending'
    && json_decode($queued[0]['input'], true) === ['postId' => $created['data']['id'], 'note' => null] && $queued[0]['runAt'] === $at(0), $queued);
eq('the outbox is drained', $outbox(), 0);
[$status] = $post('Explode');
eq('a throwing hook fails the request', $status, 500);
eq('rollback: no job and no outbox row', [count($jobs()), $outbox()], [1, 0]);
problem('enqueue validates input like an action', static fn () => $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 'x'])), 422, 'invalid_input', '/postId');

// A crash after commit leaves the committed job row and its outbox ticket; the sweep delivers it.
$wp->exec('INSERT INTO {prefix}first__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `createdAt`) VALUES (?, ?, ?, ?, 0, ?, ?)', ['00000000-0000-4000-8000-000000000001', 'notify', json_encode(['postId' => $pid]), 'pending', $at(0), $at(0)]);
$wp->exec('INSERT INTO {prefix}first__outbox VALUES (?, ?, ?, NULL, ?, ?)', ['00000000-0000-4000-8000-000000000001', 'notify', json_encode(['postId' => $pid]), $at(0), $at(0)]);
eq('maintain drains a stranded outbox row', Runner::maintain()['dispatched'], 1);
eq('the ticket is consumed', $outbox(), 0);

// ---- dedupe key: one pending job per (job, key) ------------------------------------------------------------------
$first = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k1']));
$again = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k1']));
$inOneTx = $db->transaction(static fn () => [Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k2']), Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k2'])]);
check('a pending key returns the existing job id', $first === $again && $inOneTx[0] === $inOneTx[1], [$first, $again, $inOneTx]);
$upper = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'K1']));
check('keys compare byte for byte: K1 is not k1', $upper['id'] !== $first['id'], [$upper, $first]);
eq('so only one row per key exists', (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__jobs WHERE `key` IS NOT NULL'), 3);
$delayed = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['delay' => 90]));
eq('delay sets runAt, and the delivery is scheduled for then', [$job($delayed['id'])['runAt'], $delivery($delayed['id'])], [$at(90), $asTime(90)]);

// ---- Action Scheduler runs due jobs with a null user -----------------------------------------------------------
// The pinned clock is in the past, so every delivery but the delayed one is due now for Action Scheduler's real clock.
eq('the queue runner drains every due job', $drain(), ['ran' => 5, 'done' => 5]);
$bodies = array_column($db->findMany('comments', ['where' => ['name' => 'job']]), 'body');
check('each handler ran once, attempt 1, as nobody', count($bodies) === 5 && array_filter($bodies, static fn ($b) => !str_ends_with($b, ':1:nobody')) === [], $bodies);
eq('the delayed job waits for its runAt', array_column($jobs('pending'), 'id'), [$delayed['id']]);
$rerun = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k1']));
check('a finished job frees its key', $rerun['id'] !== $first['id'], [$rerun, $first]);
eq('running a done job is a no-op', Runner::run($first['id']), null);

// ---- retries with backoff, then dead ---------------------------------------------------------------------------
$failing = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid, 'note' => 'fail'], ['key' => 'doomed']));
// Action Scheduler runs it (and the re-enqueued k1 job); the failure is re-scheduled by First, AS only sees a completed action.
eq('the queue runner runs the due jobs', $drain(), ['ran' => 2, 'done' => 1, 'failed' => 1]);
$row = $job($failing['id']);
check('a throwing handler fails the attempt and backs off 1 minute', $row['state'] === 'failed' && $row['attempts'] === 1
    && $row['runAt'] === $at(60) && str_contains($row['lastError'], 'notify failed on attempt 1'), $row);
eq('a failed job is not due before its backoff: its delivery is rescheduled for then', [$delivery($failing['id']), $drain()], [$asTime(60), ['ran' => 0]]);
$during = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'doomed']));
check('dedupe holds only while pending/running: a failed job frees its key', $during !== $failing, [$during, $failing]);
putenv('FIRST_NOW=' . $at(60));
eq('while a newer job holds the key, the retry waits instead of running', [Runner::run($failing['id']),
    $job($failing['id'])['state'] . ' ' . $job($failing['id'])['runAt']], [null, 'failed ' . $at(120)]);
$wp->exec('DELETE FROM {prefix}first__jobs WHERE `id` = ?', [$during['id']]);
// While the retry runs it holds its key again: an enqueue from inside the handler returns the same job.
$retryHolds = null;
\First\Extensions::onWritten(static function (string $op, string $c, array $row) use (&$retryHolds, $failing, $pid): void {
    if ($c === 'comments' && $row['name'] === 'partial' && $retryHolds === null) {
        $retryHolds = Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'doomed']) === $failing;
    }
});
eq('second attempt fails, backoff 5 minutes', [Runner::run($failing['id'])['state'], $job($failing['id'])['runAt']], ['failed', $at(360)]);
putenv('FIRST_NOW=' . $at(360));
$last = Runner::run($failing['id']);
eq('the third failure (retries: 3) is dead', [$last['state'], $last['attempts']], ['dead', 3]);
eq('a retry reclaims its dedupe key while it runs', $retryHolds, true);
eq('a dead job is never run again', Runner::run($failing['id']), null);
eq('each failed attempt rolled back its write and its enqueue', [count($db->findMany('comments', ['where' => ['name' => 'partial']])),
    (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}first__jobs WHERE `input` LIKE '%from-failed%'"), $outbox()], [0, 0, 0]);

// A commit callback that throws after the handler committed must not re-run the job.
$committedJob = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $created['data']['id'], 'note' => 'callback']));
$armed = true;
\First\Extensions::onWritten(static function (string $op, string $c, array $row) use (&$armed): void {
    if ($armed && $c === 'comments' && $row['name'] === 'job') {
        $armed = false;
        \First\Extensions::afterCommit(static fn () => throw new \RuntimeException('callback after commit'));
    }
});
$result = Runner::run($committedJob['id']);
eq('a commit-callback failure keeps the committed job done, its effect written once', [$result['state'], count($db->findMany('comments', ['where' => ['body' => ['like' => $committedJob['id'] . '%']]])),
    $job($committedJob['id'])['state']], ['done', 1, 'done']);

// ---- CLI: list, retry, cancel ------------------------------------------------------------------------------------
[, $out] = $cli('jobs', 'list', '--state', 'dead');
eq('`jobs list --state dead`', array_column($out['data'], 'id'), [$failing['id']]);
$holder = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'doomed']));
eq('`jobs retry` is refused while another pending job holds the key', $cli('jobs', 'retry', $failing['id'])[1]['error']['code'] ?? null, 'key_in_use');
$wp->exec('DELETE FROM {prefix}first__jobs WHERE `id` = ?', [$holder['id']]);
[, $out] = $cli('jobs', 'retry', $failing['id']);
eq('`jobs retry` re-queues a dead job from attempt 0', [$out['data'] ?? null, $jobs('pending') !== []], [['id' => $failing['id'], 'state' => 'pending'], true]);
[, $out] = $cli('jobs', 'cancel', $delayed['id']);
eq('`jobs cancel`', $out['data'] ?? null, ['id' => $delayed['id'], 'state' => 'dead']);
eq('`jobs cancel` on a dead job is refused', $cli('jobs', 'cancel', $delayed['id'])[1]['error']['code'] ?? null, 'not_cancellable');

// ---- stuck running jobs are re-queued after 10 minutes ---------------------------------------------------------
$wp->exec("UPDATE {prefix}first__jobs SET `state` = 'running', `lockedAt` = ? WHERE `id` = ?", [$at(-241), $failing['id']]);
eq('maintain re-queues a stuck job', Runner::maintain()['requeued'], 1);
eq('the stuck job is pending again, with a delivery', [$job($failing['id'])['state'], $delivery($failing['id']) !== null], ['pending', true]);

// Both registered handler contracts consume the same validated, persisted JSON payload.
(static function () use ($schema, $db): void {
    eval('namespace FirstApp; function refs__job($input, $ctx) { $GLOBALS["refsJob"] = [is_object($input), \First\Js::jsonStringify($input->p["meta"]), $input->p["info"] instanceof \First\JsObject, $input->p["rows"]->a[0] instanceof \First\JsObject]; } function refs__jobValidate($value, $ctx) { return $ctx->p["user"] !== null || "enqueue requires a user"; }');
    $seen = null;
    $spec = ['input' => ['meta' => ['type' => 'json', 'notNull' => true, 'rules' => ['validate' => 'refs__jobValidate']], 'info' => ['type' => 'group', 'fields' => []], 'rows' => ['type' => 'repeater', 'fields' => []]], 'handler' => 'refs__job', 'retries' => 1];
    $schema['jobs']['jsonCompiled'] = $spec;
    $schema['jobs']['jsonNative'] = ['handler' => static function (array $input) use (&$seen): void {
        $seen = [is_array($input), \First\Js::jsonStringify($input['meta']), is_array($input['info']), is_array($input['rows'][0])];
    }] + $spec;
    $other = new \First\Db($db->store(), new \First\Schema($schema), $db->media());
    \First\Db::setInstance($other);
    $other->setActor(['id' => 1, 'name' => 'Editor', 'role' => 'editor']);
    try {
        $meta = \First\Js::decodeJson('{"1":1,"0":2,"empty":{}}');
        foreach (['jsonCompiled', 'jsonNative'] as $name) {
            $queued = \First\Seam::enqueue($name, new \First\JsObject(['meta' => $meta, 'info' => new \First\JsObject(), 'rows' => new \First\JsArray([new \First\JsObject()])]));
            eq("$name completes", \First\Jobs\Runner::run($queued->p['id'])['state'], 'done');
        }
        eq('compiled and native jobs receive their own container contracts with identical JSON', [$GLOBALS['refsJob'], $seen], [[true, '{"0":2,"1":1,"empty":{}}', true, true], [true, '{"0":2,"1":1,"empty":{}}', true, true]]);
    } finally { \First\Db::setInstance($db); unset($GLOBALS['refsJob']); }
})();

// The first result is original; every replay comes from the persisted snapshot.
(static function (): void {
    $point = new \First\JsObject(['x' => 1]);
    $set = (new \First\JsSet())->add($point);
    $set->add($set);
    $map = (new \First\JsMap())->set($point, $set);
    $map->set($map, $point);
    $date = new \First\JsDate(0);
    $source = new \First\JsObject(['nested' => new \First\JsArray([1]), 'error' => new \First\JsError('snapshot'),
        'emptyError' => \First\Js::dynamicConstruct('Error', new \First\JsArray()),
        'point' => $point, 'set' => $set, 'map' => $map, 'date' => $date, 'again' => $date, 'absent' => \First\Js::undefined()]);
    $runs = 0;
    $load = static function () use ($source, &$runs): \First\JsObject { $runs++; return $source; };
    $first = \First\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    $first->p['nested']->a[] = 2;
    $first->p['point']->p['x'] = 2;
    $first->p['set']->add('first');
    $first->p['map']->set('first', 2);
    $first->p['date']->milliseconds = 1;
    $second = \First\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    $second->p['nested']->a[] = 3;
    $second->p['point']->p['x'] = 3;
    $second->p['set']->add('second');
    $second->p['map']->set('second', 3);
    $second->p['date']->milliseconds = 2;
    $third = \First\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    eq('once() returns the original first and an independent snapshot on every replay', [
        'runs' => $runs, 'original' => $first === $source, 'independent' => $first !== $second,
        'nested' => $third->p['nested']->a,
        'error' => [$third->p['error'] !== $source->p['error'], $third->p['error']->getMessage(),
            \First\Js::dynamicStaticCall('Object', 'hasOwn', new \First\JsArray([$third->p['error'], 'message'])),
            \First\Js::dynamicStaticCall('Object', 'hasOwn', new \First\JsArray([$third->p['emptyError'], 'message']))],
        'point' => $third->p['point']->p['x'],
        'set' => [$third->p['set']->size(), $third->p['set']->has($third->p['point']), $third->p['set']->has($third->p['set'])],
        'map' => [$third->p['map']->size(), $third->p['map']->get($third->p['point']) === $third->p['set'], $third->p['map']->get($third->p['map']) === $third->p['point']],
        'date' => [$third->p['date'] instanceof \First\JsDate, $third->p['date'] !== $date, $third->p['date'] === $third->p['again'], $third->p['date']->milliseconds],
        'undefined' => $third->p['absent'] === \First\Js::undefined(),
    ], ['runs' => 1, 'original' => true, 'independent' => true, 'nested' => [1], 'error' => [true, 'snapshot', true, false],
        'point' => 1, 'set' => [2, true, true], 'map' => [2, true, true], 'date' => [true, true, true, 0], 'undefined' => true]);
})();

// Snapshot generated by b7d5989d, before message ownership and sticky regex state existed.
(static function () use ($wp, $at): void {
    $snapshot = base64_decode(file_get_contents(__DIR__ . '/../fixtures/receipts/builtin-legacy.serialized.base64'), true);
    $wp->exec('INSERT INTO {prefix}first__receipts VALUES (?, ?, ?, ?, ?, ?, ?)', [
        'fn', 'legacy-builtins', (int) (\First\db()->actor()['id'] ?? 0), hash('sha256', ''), 'done', $snapshot, $at(0),
    ]);
    $restored = \First\Jobs\Receipts::once('fn', 'legacy-builtins', static fn () => throw new \RuntimeException('receipt replay must not rerun the operation'));
    $r = $restored->p['regex'];
    $initialIndex = $r->lastIndex;
    $matched = $r->test('ba');
    $matchIndex = $r->lastIndex;
    $failed = $r->test('ba');
    eq('legacy builtin receipts restore messages, regex state and aliases without rerunning', [
        $restored->p['error']->getMessage(),
        \First\Js::dynamicStaticCall('Object', 'hasOwn', new \First\JsArray([$restored->p['error'], 'message'])),
        $r === $restored->p['again'], $r->source, $r->flags, $initialIndex,
        $matched, $matchIndex, $failed, $r->lastIndex,
    ], ['snapshot', true, true, '(a)', 'g', 1, true, 2, false, 0]);
    $current = new \First\RegExp('a/b', 'gy');
    $current->lastIndex = 1;
    $replayed = unserialize(serialize($current));
    eq('current regex snapshots rebuild translation and retain sticky lastIndex', [
        $replayed->source, $replayed->flags, $replayed->lastIndex,
        $replayed->test('xa/b'), $replayed->lastIndex, $replayed->test('xa/b'), $replayed->lastIndex,
    ], ['a\\/b', 'gy', 1, true, 4, false, 0]);
})();

// ---- once() and Idempotency-Key ------------------------------------------------------------------------------------
[$s1, $r1] = $request('POST', '/actions/remember', ['note' => 'a']);
$db->insert('comments', ['postId' => $created['data']['id'], 'name' => 'x', 'body' => 'y']);
[$s2, $r2] = $request('POST', '/actions/remember', ['note' => 'a']);
check('once(): the second call returns the stored result', $s1 === 200 && $r1 === $r2, [$r1, $r2]);
eq('a replay keeps {} and [] apart', $wp->handle('POST', '/actions/remember', '{"note":"a"}')[2], '{"data":{"note":"a","at":' . $r1['data']['at'] . ',"empty":{},"list":[]}}');
eq('once(): same key, different input → 409 idempotency_mismatch', $request('POST', '/actions/remember', ['note' => 'a2'])[1]['code'] ?? null, 'idempotency_mismatch');
[, $other] = $request('POST', '/actions/remember', ['note' => 'a'], [], 'ed');
check('once() is per calling user', $other['data']['at'] !== $r1['data']['at'], [$other, $r1]);

[$s1, $r1, $h1] = $request('POST', '/actions/remember', ['note' => 'b'], ['idempotency-key' => 'req-1']);
[$s2, $r2, $h2] = $request('POST', '/actions/remember', ['note' => 'b'], ['idempotency-key' => 'req-1']);
check('Idempotency-Key replay returns the stored result with Idempotent-Replayed', $s1 === 200 && $s2 === 200 && $r1 === $r2
    && !isset($h1['idempotent-replayed']) && ($h2['idempotent-replayed'] ?? null) === 'true', [$h1, $h2]);
[$s, $mismatch] = $request('POST', '/actions/remember', ['note' => 'c'], ['idempotency-key' => 'req-1']);
eq('same key, different body → 409 idempotency_mismatch', [$s, $mismatch['code']], [409, 'idempotency_mismatch']);
eq('a key differing only in case is another key', $request('POST', '/actions/remember', ['note' => 'c'], ['idempotency-key' => 'REQ-1'])[0], 200);
[$s, , $h] = $request('POST', '/actions/plain', (object) [], ['idempotency-key' => 'req-1']);
eq('actions without idempotent: true ignore the header', [$s, $h['idempotent-replayed'] ?? null], [200, null]);
$count = static fn () => count($db->findMany('comments'));
$before = $count();
[$s1, $c1] = $request('POST', '/comments', ['postId' => $created['data']['id'], 'name' => 'n', 'body' => 'once'], ['idempotency-key' => 'create-1']);
[$s2, $c2, $h2] = $request('POST', '/comments', ['postId' => $created['data']['id'], 'name' => 'n', 'body' => 'once'], ['idempotency-key' => 'create-1']);
check('creates replay with their 201 and create no second row', $s1 === 201 && $s2 === 201 && $c1 === $c2 && $count() === $before + 1
    && ($h2['idempotent-replayed'] ?? null) === 'true', [$s1, $s2, $c1, $c2]);
eq('an over-long key is rejected', $request('POST', '/actions/remember', ['note' => 'd'], ['idempotency-key' => str_repeat('k', 65)])[1]['code'], 'invalid_idempotency_key');
$wp->exec("INSERT INTO {prefix}first__receipts VALUES ('action:remember', 'stuck', 0, ?, 'started', NULL, ?)", [hash('sha256', '{"note":"e"}'), $at(0)]);
eq('a started receipt → 409 outcome_unknown', $request('POST', '/actions/remember', ['note' => 'e'], ['idempotency-key' => 'stuck'])[1]['code'], 'outcome_unknown');
[$s] = $request('POST', '/posts', ['title' => 'Explode'], ['idempotency-key' => 'boom'], 'ed');
eq('a rolled-back request forgets its receipt', [$s, (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}first__receipts WHERE CAST(`key` AS CHAR) = 'boom'")], [500, 0]);

putenv('FIRST_NOW=' . $at(7 * 86400 + 360, 1));
$left = (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__receipts');
eq('receipts older than 7 days are swept', [Runner::maintain()['swept'], (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__receipts')], [$left, 0]);

// Sweep more than a keyset page, including work committed while dispatch is in flight.
$seedTicket = static function (int $n) use ($wp, $pid, $at): string {
    $id = sprintf('10000000-0000-4000-8000-%012d', $n);
    $wp->exec('INSERT INTO {prefix}first__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `createdAt`) VALUES (?, ?, ?, ?, 0, ?, ?)', [$id, 'notify', json_encode(['postId' => $pid]), 'pending', $at(0), $at(0)]);
    $wp->exec('INSERT INTO {prefix}first__outbox VALUES (?, ?, ?, NULL, ?, ?)', [$id, 'notify', json_encode(['postId' => $pid]), $at(0), $at(0)]);
    return $id;
};
$expectedTickets = [];
for ($i = 1; $i <= 105; $i++) { $expectedTickets[] = $seedTicket($i); }
$originalQueue = \First\Jobs\Outbox::queue();
$queue = new class($seedTicket) implements \First\Jobs\Queue {
    public array $deliveries = [];
    public function __construct(private \Closure $seed) {}
    public function schedule(string $id, string $runAtIso): void
    {
        if ($this->deliveries === []) { ($this->seed)(106); }
        $this->deliveries[$id] = $runAtIso;
    }
};
\First\Jobs\Outbox::useQueue($queue);
try {
    eq('keyset sweep dispatches every page and later committed work', \First\Jobs\Outbox::dispatch(), 106);
    $expectedTickets[] = sprintf('10000000-0000-4000-8000-%012d', 106);
    eq('each swept ticket reaches the queue with its schedule', $queue->deliveries, array_fill_keys($expectedTickets, $at(0)));
    eq('multi-page sweep leaves no outstanding tickets', $outbox(), 0);
} finally {
    \First\Jobs\Outbox::useQueue($originalQueue);
}

finish('jobs');
