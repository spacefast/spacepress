<?php

declare(strict_types=1);

/*
 * Feature 3 (§6.1) on WordPress, in-process (tests/php/wp.php): jobs queued in their write's transaction, dedupe
 * keys, retries with backoff and the dead state, once() receipts, the Idempotency-Key header, receipt
 * sweep and the `jobs` CLI. Time moves through SP_NOW; the runner is called directly, and due jobs
 * are drained through Action Scheduler's queue runner (the delivery every WordPress site uses; AS
 * through WP-CLI and cron is proven in tests/wp/jobs.test.ts).
 */

use SpacePress\Jobs\Jobs;
use SpacePress\Jobs\Runner;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';
require __DIR__ . '/jobs_transaction_cases.php';

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

    function job__notify(\SpacePress\JsObject $input, $ctx)
    {
        if (($input->p['note'] ?? null) === 'fail') {
            // Writes and enqueues first, so the failure must roll them back.
            \SpacePress\db()->insert('comments', ['postId' => $input->p['postId'], 'name' => 'partial', 'body' => $ctx->p['jobId']]);
            \SpacePress\Jobs\Jobs::enqueue('notify', ['postId' => $input->p['postId'], 'note' => 'from-failed']);
            throw new \SpacePress\JsError('notify failed on attempt ' . $ctx->p['attempt']);
        }
        \SpacePress\db()->insert('comments', ['postId' => $input->p['postId'], 'name' => 'job', 'body' => $ctx->p['jobId'] . ':' . $ctx->p['attempt'] . ':' . ($ctx->p['user'] === null ? 'nobody' : 'someone')]);
    }

    function posts__afterCreate(\SpacePress\JsObject $row, $ctx)
    {
        \SpacePress\Jobs\Jobs::enqueue('notify', ['postId' => $row->p['id'], 'note' => $row->p['excerpt']], $row->p['excerpt'] === 'keyed' ? ['key' => 'post-' . $row->p['title']] : null);
        if ($row->p['title'] === 'Explode') {
            throw new \SpacePress\HttpError(500, 'boom', 'afterCreate exploded');
        }
    }

    function action__remember(\SpacePress\JsObject $input, $ctx)
    {
        $key = 'remember-' . ($input->p['note'] === 'a2' ? 'a' : $input->p['note']);

        $result = \SpacePress\Jobs\Receipts::once('fn', $key, fn () => ['note' => $input->p['note'], 'at' => count(\SpacePress\db()->findMany('comments')), 'empty' => new \stdClass(), 'list' => []]);
        $result['f'] = static fn () => 1;
        return $result;
    }

    function action__plain(\SpacePress\JsObject $input, $ctx)
    {
        return count(\SpacePress\db()->findMany('comments'));
    }
    PHP;

$wp = wpSite('jobs', ['schema' => $schema, 'functions' => $functions, 'users' => ['ed' => 'editor']]);
$app = $wp->app();
$db = $app->db;
$jobs = static fn (?string $state = null) => $wp->sql('SELECT * FROM {prefix}sp__jobs' . ($state === null ? '' : " WHERE `state` = '$state'") . ' ORDER BY `createdAt`, `id`');
$job = static fn (string $id) => $wp->sql('SELECT * FROM {prefix}sp__jobs WHERE `id` = ?', [$id])[0] ?? null;
$actionsFor = static fn (string $id): int => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}actionscheduler_actions WHERE `hook` = ? AND `args` = ? AND `status` = ?', ['sp_job', json_encode(['id' => $id]), 'pending']);
/** Action Scheduler's pending delivery for a job: its scheduled time, or null. */
$delivery = static fn (string $id) => $wp->scalar('SELECT `scheduled_date_gmt` FROM {prefix}actionscheduler_actions WHERE `hook` = ? AND `args` = ? AND `status` = ? ORDER BY `action_id` DESC',
    [\SpacePress\Wp\Jobs\ActionSchedulerQueue::HOOK, json_encode(['id' => $id]), 'pending']);
/** Run every due action through Action Scheduler's queue runner, as cron would: [ran, done, failed, dead]. */
$drain = static function () use ($wp): array {
    $before = array_column($wp->sql('SELECT `id`, `state` FROM {prefix}sp__jobs'), 'state', 'id');
    ActionScheduler_QueueRunner::instance()->run('SpacePress tests');
    $after = array_column($wp->sql('SELECT `id`, `state` FROM {prefix}sp__jobs'), 'state', 'id');
    $ran = array_filter($after, static fn (string $state, string $id) => ($before[$id] ?? null) !== $state, ARRAY_FILTER_USE_BOTH);

    return ['ran' => count($ran)] + array_count_values($ran);
};
$request = static function (string $method, string $path, mixed $body = null, array $headers = [], ?string $as = null) use ($wp): array {
    [$status, $out, $raw] = $wp->handle($method, $path, $body === null ? '' : json_encode($body), $as, $headers);

    return [$status, json_decode($raw, true), array_change_key_case($out, CASE_LOWER)];
};
$cli = static fn (string ...$args) => $wp->cli(...$args);
$post = static fn (string $title, ?string $excerpt = null) => $request('POST', '/posts', ['title' => $title, 'excerpt' => $excerpt], [], 'ed');
// SpacePress's clock is pinned at this instant; Action Scheduler keeps the real one. Deliveries are
// scheduled no earlier than real now, so the two must agree at the start: later moves of the pinned
// clock call the runner directly, as a worker would.
$t0 = time();
$at = static fn (int $seconds, int $ms = 0): string => \SpacePress\Js::iso($t0 * 1000 + $seconds * 1000 + $ms);
$asTime = static fn (int $seconds): string => gmdate('Y-m-d H:i:s', $t0 + $seconds);

// ---- a committed write queues its job; a rolled-back write leaves nothing ---------- --------------------------------
putenv('SP_NOW=' . $at(0));
[$status, $created] = $post('Hello');
eq('create with an enqueueing hook', $status, 201);
$pid = $created['data']['id'];
$queued = $jobs();
check('the job is queued with its validated input', count($queued) === 1 && $queued[0]['state'] === 'pending'
    && json_decode($queued[0]['input'], true) === ['postId' => $created['data']['id'], 'note' => null] && $queued[0]['runAt'] === $at(0), $queued);
eq('with one pending action', $actionsFor($queued[0]['id']), 1);
[$status] = $post('Explode');
eq('a throwing hook fails the request', $status, 500);
eq('rollback records no new job', count($jobs()), 1);
problem('enqueue validates input like an action', static fn () => $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 'x'])), 422, 'invalid_input', '/postId');

// Only waiting jobs without a delivery need recovery.
$stranded = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
foreach ($stranded as $n => $id) {
    $wp->exec('INSERT INTO {prefix}sp__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `createdAt`) VALUES (?, ?, ?, ?, 0, ?, ?)', [$id, 'notify', json_encode(['postId' => $pid]), $n === 2 ? 'dead' : 'pending', $at(0), $at(0)]);
}
as_schedule_single_action(time(), 'sp_job', ['id' => $stranded[1]], 'spacepress-blog');
delete_option(\SpacePress\Wp\Jobs\ActionSchedulerQueue::PREPARED);
do_action('action_scheduler_init');
do_action('action_scheduler_init');
eq('the next request gives a stranded ticket its action, once, and no job a second one', array_map($actionsFor, $stranded), [1, 1, 0]);
eq('the groups are recorded as prepared, with the version of the step', get_option(\SpacePress\Wp\Jobs\ActionSchedulerQueue::PREPARED), 'v1:spacepress,spacepress-blog');
// The moved job runs with the others below; the two helper rows are this case's own.
as_unschedule_all_actions('sp_job', ['id' => $stranded[1]]);
$wp->exec('DELETE FROM {prefix}sp__jobs WHERE `id` IN (?, ?)', [$stranded[1], $stranded[2]]);

// ---- dedupe key: one pending job per (job, key) ------------------------------------------------------------------
$first = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k1']));
$again = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k1']));
$inOneTx = $db->transaction(static fn () => [Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k2']), Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'k2'])]);
check('a pending key returns the existing job id', $first === $again && $inOneTx[0] === $inOneTx[1], [$first, $again, $inOneTx]);
$upper = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'K1']));
check('keys compare byte for byte: K1 is not k1', $upper['id'] !== $first['id'], [$upper, $first]);
eq('so only one row per key exists', (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}sp__jobs WHERE `key` IS NOT NULL'), 3);
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
// Action Scheduler runs it (and the re-enqueued k1 job); the failure is re-scheduled by SpacePress, AS only sees a completed action.
eq('the queue runner runs the due jobs', $drain(), ['ran' => 2, 'done' => 1, 'failed' => 1]);
$row = $job($failing['id']);
check('a throwing handler fails the attempt and backs off 1 minute', $row['state'] === 'failed' && $row['attempts'] === 1
    && $row['runAt'] === $at(60) && str_contains($row['lastError'], 'notify failed on attempt 1'), $row);
eq('a failed job is not due before its backoff: its delivery is rescheduled for then', [$delivery($failing['id']), $drain()], [$asTime(60), ['ran' => 0]]);
$during = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'doomed']));
check('dedupe holds only while pending/running: a failed job frees its key', $during !== $failing, [$during, $failing]);
putenv('SP_NOW=' . $at(60));
eq('while a newer job holds the key, the retry waits instead of running', [Runner::run($failing['id']),
    $job($failing['id'])['state'] . ' ' . $job($failing['id'])['runAt']], [null, 'failed ' . $at(120)]);
$wp->exec('DELETE FROM {prefix}sp__jobs WHERE `id` = ?', [$during['id']]);
// While the retry runs it holds its key again: an enqueue from inside the handler returns the same job.
$retryHolds = null;
\SpacePress\Extensions::onWritten(static function (string $op, string $c, array $row) use (&$retryHolds, $failing, $pid): void {
    if ($c === 'comments' && $row['name'] === 'partial' && $retryHolds === null) {
        $retryHolds = Jobs::enqueue('notify', ['postId' => $pid], ['key' => 'doomed']) === $failing;
    }
});
eq('second attempt fails, backoff 5 minutes', [Runner::run($failing['id'])['state'], $job($failing['id'])['runAt']], ['failed', $at(360)]);
putenv('SP_NOW=' . $at(360));
$last = Runner::run($failing['id']);
eq('the third failure (retries: 3) is dead', [$last['state'], $last['attempts']], ['dead', 3]);
eq('a retry reclaims its dedupe key while it runs', $retryHolds, true);
eq('a dead job is never run again', Runner::run($failing['id']), null);
eq('each failed attempt rolled back its write and its enqueue', [count($db->findMany('comments', ['where' => ['name' => 'partial']])),
    (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp__jobs WHERE `input` LIKE '%from-failed%'")], [0, 0]);

// A commit callback that throws after the handler committed must not re-run the job.
$committedJob = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $created['data']['id'], 'note' => 'callback']));
$armed = true;
\SpacePress\Extensions::onWritten(static function (string $op, string $c, array $row) use (&$armed): void {
    if ($armed && $c === 'comments' && $row['name'] === 'job') {
        $armed = false;
        \SpacePress\Extensions::afterCommit(static fn () => throw new \RuntimeException('callback after commit'));
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
$wp->exec('DELETE FROM {prefix}sp__jobs WHERE `id` = ?', [$holder['id']]);
[, $out] = $cli('jobs', 'retry', $failing['id']);
eq('`jobs retry` re-queues a dead job from attempt 0', [$out['data'] ?? null, $jobs('pending') !== []], [['id' => $failing['id'], 'state' => 'pending'], true]);
[, $out] = $cli('jobs', 'cancel', $delayed['id']);
eq('`jobs cancel`', $out['data'] ?? null, ['id' => $delayed['id'], 'state' => 'dead']);
eq('`jobs cancel` on a dead job is refused', $cli('jobs', 'cancel', $delayed['id'])[1]['error']['code'] ?? null, 'not_cancellable');

// ---- stuck running jobs are re-queued after 10 minutes ---------------------------------------------------------
$wp->exec("UPDATE {prefix}sp__jobs SET `state` = 'running', `lockedAt` = ? WHERE `id` = ?", [$at(-241), $failing['id']]);
eq('maintain re-queues a stuck job', Runner::maintain()['requeued'], 1);
eq('the stuck job is pending again, with a delivery', [$job($failing['id'])['state'], $delivery($failing['id']) !== null], ['pending', true]);

// ---- a waiting job with no action gets one, once ---------------------------------------------------------------
// Only a job from before this runtime, one queued before Action Scheduler was ready in a request that died,
// or one whose action someone deleted can be left without one; daily maintenance gives it its action.
$orphan = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid], ['delay' => 120]));
$wp->exec('DELETE FROM {prefix}actionscheduler_actions WHERE `hook` = ? AND `args` = ?', ['sp_job', json_encode(['id' => $orphan['id']])]); // a lost action
eq('maintain gives a waiting job without an action one, at its runAt', [Runner::maintain()['recovered'], $delivery($orphan['id'])], [1, gmdate('Y-m-d H:i:s', max(time(), intdiv((int) \SpacePress\Js::date($job($orphan['id'])['runAt']), 1000)))]);
eq('and leaves it alone once it has one', [Runner::recover(), $actionsFor($orphan['id'])], [0, 1]);
as_unschedule_all_actions('sp_job', ['id' => $orphan['id']]); // what Tools > Scheduled Actions > Cancel does
eq('an action an administrator cancelled is not brought back', [Runner::recover(), $actionsFor($orphan['id'])], [0, 0]);
$wp->exec("UPDATE {prefix}sp__jobs SET `state` = 'dead', `dedupe` = NULL WHERE `id` = ?", [$orphan['id']]);
as_unschedule_all_actions('sp_job', ['id' => $orphan['id']]);

// ---- queued before Action Scheduler is ready (a wp-hooks `init` handler at priority 0) ----------------------------
$ready = new \ReflectionProperty(\ActionScheduler::class, 'data_store_initialized');
$ready->setValue(null, false);
try {
    $early = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => $pid]));
    eq('before Action Scheduler is ready, the write commits and its job waits', [$job($early['id'])['state'] ?? null, $actionsFor($early['id'])], ['pending', 0]);
} finally {
    $ready->setValue(null, true);
}
// The first request after an update prepares the site (recovering the job) before the deferred delivery runs.
delete_option(\SpacePress\Wp\Jobs\ActionSchedulerQueue::PREPARED);
do_action('action_scheduler_init');
eq('then gets one action once Action Scheduler is ready, even when preparing recovered it first', $actionsFor($early['id']), 1);
$wp->exec("UPDATE {prefix}sp__jobs SET `state` = 'dead', `dedupe` = NULL WHERE `id` = ?", [$early['id']]);
as_unschedule_all_actions('sp_job', ['id' => $early['id']]);

// ---- a connection wpdb replaced mid-transaction never commits ------------------------------------------------------
// wpdb::check_connection() leaves a new handle after a reconnect. The stand-in: the transaction began on
// another handle, so this one looks like a replacement (the database underneath is the same).
$handle = new \ReflectionProperty(\SpacePress\Wp\Connection::class, 'handle');
$refused = null;
try {
    $db->transaction(static function () use ($handle): void {
        $handle->setValue(\SpacePress\Wp\Plugin::instance()->connection(), new \stdClass());
    });
} catch (\RuntimeException $e) {
    $refused = $e->getMessage();
}
check('a transaction whose connection was replaced refuses to commit', str_contains((string) $refused, 'connection was lost'), $refused);
$written = null;
try {
    $db->transaction(static function () use ($handle, $wp, &$written): void {
        $handle->setValue(\SpacePress\Wp\Plugin::instance()->connection(), new \stdClass());
        try {
            $wp->exec('SELECT 1');
        } catch (\SpacePress\Wp\DbError $e) {
            $written = $e->getMessage();
            throw $e;
        }
    });
} catch (\SpacePress\Wp\DbError) {
}
check('and refuses every statement after the reconnect, which would commit on its own', str_contains((string) $written, 'connection was lost'), $written);

// Both registered handler contracts consume the same validated, persisted JSON payload.
(static function () use ($schema, $db): void {
    eval('namespace SpacePressApp; function refs__job($input, $ctx) { $GLOBALS["refsJob"] = [is_object($input), \SpacePress\Js::jsonStringify($input->p["meta"]), $input->p["info"] instanceof \SpacePress\JsObject, $input->p["rows"]->a[0] instanceof \SpacePress\JsObject]; } function refs__jobValidate($value, $ctx) { return $ctx->p["user"] !== null || "enqueue requires a user"; }');
    $seen = null;
    $spec = ['input' => ['meta' => ['type' => 'json', 'notNull' => true, 'rules' => ['validate' => 'refs__jobValidate']], 'info' => ['type' => 'group', 'fields' => []], 'rows' => ['type' => 'repeater', 'fields' => []]], 'handler' => 'refs__job', 'retries' => 1];
    $schema['jobs']['jsonCompiled'] = $spec;
    $schema['jobs']['jsonNative'] = ['handler' => static function (array $input) use (&$seen): void {
        $seen = [is_array($input), \SpacePress\Js::jsonStringify($input['meta']), is_array($input['info']), is_array($input['rows'][0])];
    }] + $spec;
    $other = new \SpacePress\Db($db->store(), new \SpacePress\Schema($schema), $db->media());
    \SpacePress\Db::setInstance($other);
    $other->setActor(['id' => 1, 'name' => 'Editor', 'role' => 'editor']);
    try {
        $meta = \SpacePress\Js::decodeJson('{"1":1,"0":2,"empty":{}}');
        foreach (['jsonCompiled', 'jsonNative'] as $name) {
            $queued = \SpacePress\Seam::enqueue($name, new \SpacePress\JsObject(['meta' => $meta, 'info' => new \SpacePress\JsObject(), 'rows' => new \SpacePress\JsArray([new \SpacePress\JsObject()])]));
            eq("$name completes", \SpacePress\Jobs\Runner::run($queued->p['id'])['state'], 'done');
        }
        eq('compiled and native jobs receive their own container contracts with identical JSON', [$GLOBALS['refsJob'], $seen], [[true, '{"0":2,"1":1,"empty":{}}', true, true], [true, '{"0":2,"1":1,"empty":{}}', true, true]]);
    } finally { \SpacePress\Db::setInstance($db); unset($GLOBALS['refsJob']); }
})();

// The first result is original; every replay comes from the persisted snapshot.
(static function (): void {
    $point = new \SpacePress\JsObject(['x' => 1]);
    $set = (new \SpacePress\JsSet())->add($point);
    $set->add($set);
    $map = (new \SpacePress\JsMap())->set($point, $set);
    $map->set($map, $point);
    $date = new \SpacePress\JsDate(0);
    $source = new \SpacePress\JsObject(['nested' => new \SpacePress\JsArray([1]), 'error' => new \SpacePress\JsError('snapshot'),
        'emptyError' => \SpacePress\Js::dynamicConstruct('Error', new \SpacePress\JsArray()),
        'point' => $point, 'set' => $set, 'map' => $map, 'date' => $date, 'again' => $date, 'absent' => \SpacePress\Js::undefined()]);
    $runs = 0;
    $load = static function () use ($source, &$runs): \SpacePress\JsObject { $runs++; return $source; };
    $first = \SpacePress\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    $first->p['nested']->a[] = 2;
    $first->p['point']->p['x'] = 2;
    $first->p['set']->add('first');
    $first->p['map']->set('first', 2);
    $first->p['date']->milliseconds = 1;
    $second = \SpacePress\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    $second->p['nested']->a[] = 3;
    $second->p['point']->p['x'] = 3;
    $second->p['set']->add('second');
    $second->p['map']->set('second', 3);
    $second->p['date']->milliseconds = 2;
    $third = \SpacePress\Jobs\Receipts::once('fn', 'graph-snapshot', $load);
    eq('once() returns the original first and an independent snapshot on every replay', [
        'runs' => $runs, 'original' => $first === $source, 'independent' => $first !== $second,
        'nested' => $third->p['nested']->a,
        'error' => [$third->p['error'] !== $source->p['error'], $third->p['error']->getMessage(),
            \SpacePress\Js::dynamicStaticCall('Object', 'hasOwn', new \SpacePress\JsArray([$third->p['error'], 'message'])),
            \SpacePress\Js::dynamicStaticCall('Object', 'hasOwn', new \SpacePress\JsArray([$third->p['emptyError'], 'message']))],
        'point' => $third->p['point']->p['x'],
        'set' => [$third->p['set']->size(), $third->p['set']->has($third->p['point']), $third->p['set']->has($third->p['set'])],
        'map' => [$third->p['map']->size(), $third->p['map']->get($third->p['point']) === $third->p['set'], $third->p['map']->get($third->p['map']) === $third->p['point']],
        'date' => [$third->p['date'] instanceof \SpacePress\JsDate, $third->p['date'] !== $date, $third->p['date'] === $third->p['again'], $third->p['date']->milliseconds],
        'undefined' => $third->p['absent'] === \SpacePress\Js::undefined(),
    ], ['runs' => 1, 'original' => true, 'independent' => true, 'nested' => [1], 'error' => [true, 'snapshot', true, false],
        'point' => 1, 'set' => [2, true, true], 'map' => [2, true, true], 'date' => [true, true, true, 0], 'undefined' => true]);
})();

(static function (): void {
    $current = new \SpacePress\RegExp('a/b', 'gy');
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
$wp->exec("INSERT INTO {prefix}sp__receipts VALUES ('action:remember', 'stuck', 0, ?, 'started', NULL, ?)", [hash('sha256', '{"note":"e"}'), $at(0)]);
eq('a started receipt → 409 outcome_unknown', $request('POST', '/actions/remember', ['note' => 'e'], ['idempotency-key' => 'stuck'])[1]['code'], 'outcome_unknown');
[$s] = $request('POST', '/posts', ['title' => 'Explode'], ['idempotency-key' => 'boom'], 'ed');
eq('a rolled-back request forgets its receipt', [$s, (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp__receipts WHERE CAST(`key` AS CHAR) = 'boom'")], [500, 0]);

putenv('SP_NOW=' . $at(7 * 86400 + 360, 1));
$left = (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}sp__receipts');
eq('receipts older than 7 days are swept', [Runner::maintain()['swept'], (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}sp__receipts')], [$left, 0]);

// ---- `jobs tick`: the host worker's one bounded pass ---------------------------------------------------------------
// Every job is due; a stuck runner and an expired receipt wait. A tick does at
// most `limit` units of each kind and says whether work remains; the next one finishes it.
putenv('SP_NOW=' . $at(8 * 86400));
$wp->exec('DELETE FROM {prefix}sp__jobs');
$wp->exec("UPDATE {prefix}actionscheduler_actions SET `status` = 'canceled' WHERE `status` = 'pending'");
$tickId = static fn (int $n): string => sprintf('20000000-0000-4000-8000-%012d', $n);
for ($n = 1; $n <= 9; $n++) {
    $wp->exec('INSERT INTO {prefix}sp__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `createdAt`) VALUES (?, ?, ?, ?, 0, ?, ?)',
        [$tickId($n), 'notify', json_encode(['postId' => $pid, 'note' => $n === 9 ? 'fail' : null]), 'pending', $at(8 * 86400 - 60 + $n), $at(8 * 86400 - 60 + $n)]);
}
$wp->exec('INSERT INTO {prefix}sp__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `lockedAt`, `createdAt`) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    [$tickId(10), 'notify', json_encode(['postId' => $pid]), 'running', $at(0), $at(8 * 86400 - 3600), $at(0)]);
$wp->exec("INSERT INTO {prefix}sp__receipts VALUES ('action:remember', 'old', 0, ?, 'done', 'null', ?)", [hash('sha256', '{}'), $at(0)]);
$done = static fn (): int => (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp__jobs WHERE `state` = 'done'");

[$code, $first] = $cli('jobs', 'tick', '--limit', '4');
eq('a tick exits 0 and prints its counts', $code, 0);
$pass = $first['data'];
check('the first tick stays within its limit and says more is left', $pass['remaining'] === true && $pass['processed'] <= 4
    && $pass['requeued'] === 1 && $pass['receiptsExpired'] === 1, $pass);
eq('due jobs ran directly: at most half the limit', $done(), 2);
eq('the stuck job is pending again', $wp->scalar('SELECT `state` FROM {prefix}sp__jobs WHERE `id` = ?', [$tickId(10)]), 'pending');
eq('the expired receipt is gone', (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp__receipts WHERE CAST(`key` AS CHAR) = 'old'"), 0);
$ticks = 1;
do {
    $result = $cli('jobs', 'tick', '--limit', '4')[1]['data'];
    $ticks++;
} while ($result['remaining'] && $ticks < 20);
eq('later ticks finish the queue: every job but the failing one is done', $done(), 9);
$failing = $job($tickId(9));
check('a failing job counts as a failure and is kept for its retry, with its error', $failing['state'] === 'failed' && (int) $failing['attempts'] === 1
    && str_contains((string) $failing['lastError'], 'notify failed on attempt 1'), $failing);
eq('a tick with nothing due does nothing', array_intersect_key($cli('jobs', 'tick')[1]['data'], ['processed' => 0, 'remaining' => 0]), ['processed' => 0, 'remaining' => false]);
putenv('SP_NOW=' . $at(8 * 86400 + 120));
$retry = $cli('jobs', 'tick')[1]['data'];
check('once its backoff has passed, a tick retries it (and counts the failure again)', $retry['failures'] >= 1 && (int) $job($tickId(9))['attempts'] === 2, [$retry, $job($tickId(9))]);
eq('a limit outside 1..100 is clamped, not refused', $cli('jobs', 'tick', '--limit', '0')[0], 0);

// ---- overlapping ticks run each action and each cron event once --------------------------------------------------
// A second tick starts while the first has checked an action is pending and is loading it to run: the window
// in which two runners that don't claim both run the same action (Action Scheduler checks the status, then
// fetches the action, then runs it). The second tick finds the actions claimed and the cron lock held, and
// leaves both to the first.
$wp->exec("UPDATE {prefix}actionscheduler_actions SET `status` = 'canceled' WHERE `status` = 'pending'");
$ran = [];
foreach (['one', 'two', 'three'] as $name) {
    as_schedule_single_action(time() - 10, 'sp_test_overlap', ['name' => $name], 'spacepress-tests');
    add_action('sp_test_overlap', static function (string $which) use ($name, &$ran): void {
        if ($which === $name) {
            $ran[] = "action $name";
        }
    });
}
$nested = null;
$overlap = static function () use (&$nested): void {
    if ($nested === null) {
        $nested = false;
        $nested = \SpacePress\Jobs\Tick::run();
    }
};
// Past the status check (`action_scheduler_begin_execute`), the next load of the action starts the second tick.
$checked = false;
$beginExecute = static function () use (&$checked): void {
    $checked = true;
};
$loading = static function (string $class) use (&$checked, $overlap): string {
    if ($checked) {
        $checked = false;
        $overlap();
    }
    return $class;
};
add_action('action_scheduler_begin_execute', $beginExecute);
add_filter('action_scheduler_stored_action_class', $loading);
$outer = \SpacePress\Jobs\Tick::run();
remove_action('action_scheduler_begin_execute', $beginExecute);
remove_filter('action_scheduler_stored_action_class', $loading);
sort($ran);
eq('two overlapping ticks run each action once', $ran, ['action one', 'action three', 'action two']);
check('the tick that holds the claim ran them; the other ran none', $outer['processed'] === 3 && is_array($nested) && $nested['processed'] === 0, [$outer, $nested]);
eq('no claim is left behind', (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}actionscheduler_actions WHERE `claim_id` <> 0 AND `status` = ?', ['pending']), 0);

$ran = [];
$nested = null;
foreach (['first', 'second'] as $name) {
    wp_schedule_single_event(time() - 10, "sp_test_cron_$name");
    add_action("sp_test_cron_$name", static function () use ($name, &$ran, $overlap): void {
        $ran[] = "event $name";
        $overlap();
    });
}
$outer = \SpacePress\Jobs\Tick::run();
eq('two overlapping ticks run each WP-Cron event once', $ran, ['event first', 'event second']);
check('the second tick found core\'s cron lock held and ran no event', $outer['processed'] === 2 && is_array($nested) && $nested['processed'] === 0, [$outer, $nested]);
eq('the first tick releases the cron lock', get_transient('doing_cron'), false);
set_transient('doing_cron', sprintf('%.22F', microtime(true)));
wp_schedule_single_event(time() - 10, 'sp_test_cron_first');
$ran = [];
$nested = false; // no nested tick this time
check('while another cron run (wp-cron.php) holds the lock, a tick leaves its events to it', \SpacePress\Jobs\Tick::run()['processed'] === 0 && $ran === [], $ran);
delete_transient('doing_cron');
eq('once the lock is free, the next tick runs them', [\SpacePress\Jobs\Tick::run()['processed'], $ran], [1, ['event first']]);

// Another run changes the database behind this process's options cache (filled when WordPress loaded):
// a tick reads the lock and the due events from the database, not from that cache.
global $wpdb;
wp_schedule_single_event(time() - 10, 'sp_test_cron_second');
get_transient('doing_cron'); // cached as absent
$wpdb->query($wpdb->prepare("INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('_transient_doing_cron', %s, 'off')", sprintf('%.22F', microtime(true))));
$ran = [];
check('a lock another run took after this process loaded is respected', \SpacePress\Jobs\Tick::run()['processed'] === 0 && $ran === [], $ran);
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name = '_transient_doing_cron'");
wp_cache_delete('alloptions', 'options');
wp_cache_delete('notoptions', 'options');
_get_cron_array(); // the event is in this process's cache
$wpdb->query($wpdb->prepare("UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = 'cron'", serialize(['version' => 2])));
check('an event another run already ran is not run again from a stale cache', \SpacePress\Jobs\Tick::run()['processed'] === 0 && $ran === [], $ran);

// While a tick runs an action, Action Scheduler's fatal-error monitor holds its claim: a fatal error in
// the action fails it and releases the claim, instead of leaving both for the 5-minute timeouts.
$monitored = null;
as_schedule_single_action(time() - 10, 'sp_test_monitor', [], 'spacepress-tests');
add_action('sp_test_monitor', static function () use (&$monitored): void {
    global $wp_filter;
    $monitored = false;
    foreach ($wp_filter['shutdown']->callbacks ?? [] as $callbacks) {
        foreach ($callbacks as $callback) {
            $monitored = $monitored || (is_array($callback['function']) && $callback['function'][0] instanceof ActionScheduler_FatalErrorMonitor);
        }
    }
});
\SpacePress\Jobs\Tick::run();
global $wp_filter;
$left = false;
foreach ($wp_filter['shutdown']->callbacks ?? [] as $callbacks) {
    foreach ($callbacks as $callback) {
        $left = $left || (is_array($callback['function']) && $callback['function'][0] instanceof ActionScheduler_FatalErrorMonitor);
    }
}
eq('the fatal-error monitor watches the claim while an action runs, and is detached after', [$monitored, $left], [true, false]);

// An older delivery of a job that a failed attempt moved later doesn't run it early: the backoff holds.
$backoffId = $tickId(20);
$wp->exec('INSERT INTO {prefix}sp__jobs (`id`, `job`, `input`, `state`, `attempts`, `runAt`, `createdAt`) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [$backoffId, 'notify', json_encode(['postId' => $pid, 'note' => 'fail']), 'failed', $at(8 * 86400 + 3600), $at(0)]);
as_schedule_single_action(time() - 10, \SpacePress\Wp\Jobs\ActionSchedulerQueue::HOOK, ['id' => $backoffId], 'spacepress-tests', false);
\SpacePress\Jobs\Tick::run();
eq('a due delivery for a job whose retry is later leaves the job waiting', [(int) $job($backoffId)['attempts'], $job($backoffId)['state']], [1, 'failed']);
// Its own delivery (scheduled for its retry time, as Runner::fail does), run early by hand with
// `wp action-scheduler action run`, runs it.
as_schedule_single_action((int) floor(\SpacePress\Js::date($at(8 * 86400 + 3600)) / 1000), \SpacePress\Wp\Jobs\ActionSchedulerQueue::HOOK, ['id' => $backoffId], 'spacepress-tests', false);
ActionScheduler_QueueRunner::instance()->process_action((int) $wp->scalar('SELECT `action_id` FROM {prefix}actionscheduler_actions WHERE `hook` = ? AND `args` = ? AND `status` = ? ORDER BY `action_id` DESC',
    [\SpacePress\Wp\Jobs\ActionSchedulerQueue::HOOK, json_encode(['id' => $backoffId]), 'pending']), 'by hand');
eq('the job\'s own delivery, run early by hand, runs it', (int) $job($backoffId)['attempts'], 2);

// ---- the job and its Action Scheduler action commit or roll back together (shared with tests/wp/jobs.test.ts) ----
foreach (firstJobsTransactionCases('notify', ['postId' => $pid]) as [$label, $actual, $expected]) {
    eq($label, $actual, $expected);
}

finish('jobs');
