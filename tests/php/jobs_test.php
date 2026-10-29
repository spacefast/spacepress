<?php

declare(strict_types=1);

/*
 * Feature 3 (§6.1) on the standalone runtime, in-process: the transactional outbox, dedupe keys,
 * retries with backoff and the dead state, once() receipts, the Idempotency-Key header, receipt
 * sweep and the `jobs` CLI. Time moves through ZERO_NOW; the runner is called directly.
 */

use Zero\App;
use Zero\Jobs\Jobs;
use Zero\Jobs\Runner;

require __DIR__ . '/blog_app.php';
require __DIR__ . '/harness.php';

$root = blogApp(sys_get_temp_dir() . '/zero-jobs-test-' . bin2hex(random_bytes(4)));
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($root)));
putenv('ZERO_DB_PATH');
putenv('ZERO_AUTO_MIGRATE');
ini_set('error_log', "$root/error.log");

// The blog fixture plus what a compiled jobs config adds: one job, an idempotent action, a hook
// that enqueues, and a once() call (these bodies are what the compiler emits for them).
$schema = require "$root/zero/app/schema.php";
$schema['jobs'] = ['notify' => [
    'input' => ['postId' => ['type' => 'integer', 'notNull' => true], 'note' => ['type' => 'text']],
    'handler' => 'job__notify', 'retries' => 3, 'agents' => false,
]];
$schema['actions']['remember'] = ['input' => ['note' => ['type' => 'text', 'notNull' => true]], 'handler' => 'action__remember',
    'access' => ['role' => 'anyone'], 'agents' => true, 'idempotent' => true, 'signature' => null];
$schema['actions']['plain'] = ['input' => [], 'handler' => 'action__plain',
    'access' => ['role' => 'anyone'], 'agents' => true, 'idempotent' => false, 'signature' => null];
$schema['collections']['posts']['hooks']['afterCreate'] = 'posts__afterCreate';
file_put_contents("$root/zero/app/schema.php", '<?php return ' . var_export($schema, true) . ';');
file_put_contents("$root/zero/app/functions.php", <<<'PHP'

    function job__notify(array $input, $ctx)
    {
        if (($input['note'] ?? null) === 'fail') {
            // Writes and enqueues first, so the failure must roll them back.
            \Zero\db()->insert('comments', ['postId' => $input['postId'], 'name' => 'partial', 'body' => $ctx['jobId']]);
            \Zero\Jobs\Jobs::enqueue('notify', ['postId' => $input['postId'], 'note' => 'from-failed']);
            throw new \Zero\JsError('notify failed on attempt ' . $ctx['attempt']);
        }
        \Zero\db()->insert('comments', ['postId' => $input['postId'], 'name' => 'job', 'body' => $ctx['jobId'] . ':' . $ctx['attempt'] . ':' . ($ctx['user'] === null ? 'nobody' : 'someone')]);
    }

    function posts__afterCreate(array $row, $ctx)
    {
        \Zero\Jobs\Jobs::enqueue('notify', ['postId' => $row['id'], 'note' => $row['excerpt']], $row['excerpt'] === 'keyed' ? ['key' => 'post-' . $row['title']] : null);
        if ($row['title'] === 'Explode') {
            throw new \Zero\HttpError(500, 'boom', 'afterCreate exploded');
        }
    }

    function action__remember(array $input, $ctx)
    {
        $key = 'remember-' . ($input['note'] === 'a2' ? 'a' : $input['note']);

        return \Zero\Jobs\Receipts::once('fn', $key, fn () => ['note' => $input['note'], 'at' => count(\Zero\db()->findMany('comments')), 'empty' => new \stdClass(), 'list' => []]);
    }

    function action__plain(array $input, $ctx)
    {
        return count(\Zero\db()->findMany('comments'));
    }
    PHP, FILE_APPEND);

require "$root/zero/runtime/bootstrap.php";
$app = App::boot($root);
$pdo = $app->store->pdo();
$db = $app->db;
$jobs = static fn (?string $state = null) => $pdo->query('SELECT * FROM "__zero_jobs"' . ($state === null ? '' : " WHERE \"state\" = '$state'") . ' ORDER BY "createdAt", "id"')->fetchAll();
$outbox = static fn () => (int) $pdo->query('SELECT COUNT(*) FROM "__zero_outbox"')->fetchColumn();
$request = static function (string $method, string $path, mixed $body = null, array $headers = []) use ($app): array {
    [$status, $out, $raw] = $app->handle($method, $path, [], $body === null ? '' : json_encode($body), $headers);

    return [$status, json_decode($raw, true), array_change_key_case($out, CASE_LOWER)];
};
$cli = static function (string ...$args) use ($root): array {
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/zero/bin/zero.php") . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>/dev/null', $out, $code);

    return [$code, json_decode(implode("\n", $out), true)];
};
[, $token] = [$cli('user', 'add', 'ed', '--role', 'editor'), $cli('token', 'create', 'ed')[1]['data']['token']];
$editor = ['authorization' => "Bearer $token"];
$post = static fn (string $title, ?string $excerpt = null) => $request('POST', '/posts', ['title' => $title, 'excerpt' => $excerpt], $editor);

// ---- outbox: a committed write queues its job; a rolled-back write leaves nothing --------------------------------
putenv('ZERO_NOW=2026-01-01T00:00:00.000Z');
[$status, $created] = $post('Hello');
eq('create with an enqueueing hook', $status, 201);
$queued = $jobs();
check('the job is queued after commit with its validated input', count($queued) === 1 && $queued[0]['state'] === 'pending'
    && json_decode($queued[0]['input'], true) === ['postId' => $created['data']['id'], 'note' => null] && $queued[0]['runAt'] === '2026-01-01T00:00:00.000Z', $queued);
eq('the outbox is drained', $outbox(), 0);
[$status] = $post('Explode');
eq('a throwing hook fails the request', $status, 500);
eq('rollback: no job and no outbox row', [count($jobs()), $outbox()], [1, 0]);
problem('enqueue validates input like an action', static fn () => $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 'x'])), 422, 'invalid_input', '/postId');

// A crash between commit and dispatch leaves the row in the outbox; the next worker pass moves it.
$pdo->exec("INSERT INTO \"__zero_outbox\" VALUES ('00000000-0000-4000-8000-000000000001', 'notify', '{\"postId\":1}', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
eq('maintain drains a stranded outbox row', Runner::maintain()['dispatched'], 1);
eq('the stranded job is queued', count($jobs('pending')), 2);

// ---- dedupe key: one pending job per (job, key) ------------------------------------------------------------------
$first = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 1], ['key' => 'k1']));
$again = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 2], ['key' => 'k1']));
$inOneTx = $db->transaction(static fn () => [Jobs::enqueue('notify', ['postId' => 1], ['key' => 'k2']), Jobs::enqueue('notify', ['postId' => 2], ['key' => 'k2'])]);
check('a pending key returns the existing job id', $first === $again && $inOneTx[0] === $inOneTx[1], [$first, $again, $inOneTx]);
eq('so only one row per key exists', (int) $pdo->query('SELECT COUNT(*) FROM "__zero_jobs" WHERE "key" IS NOT NULL')->fetchColumn(), 2);
$delayed = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 1], ['delay' => 90]));
eq('delay sets runAt', $pdo->query("SELECT \"runAt\" FROM \"__zero_jobs\" WHERE \"id\" = '{$delayed['id']}'")->fetchColumn(), '2026-01-01T00:01:30.000Z');

// ---- the worker runs due jobs with a null user ------------------------------------------------------------------
[$code, $out] = $cli('jobs', 'work', '--once');
eq('`jobs work --once` drains every due job', [$code, $out['data']['ran'] ?? null, $out['data']['done'] ?? null], [0, 4, 4]);
$bodies = array_column($db->findMany('comments', ['where' => ['name' => 'job']]), 'body');
check('each handler ran once, attempt 1, as nobody', count($bodies) === 4 && array_filter($bodies, static fn ($b) => !str_ends_with($b, ':1:nobody')) === [], $bodies);
eq('the delayed job waits for its runAt', array_column($jobs('pending'), 'id'), [$delayed['id']]);
$rerun = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 1], ['key' => 'k1']));
check('a finished job frees its key', $rerun['id'] !== $first['id'], [$rerun, $first]);
eq('running a done job is a no-op', Runner::run($first['id']), null);

// ---- retries with backoff, then dead ---------------------------------------------------------------------------
$failing = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 1, 'note' => 'fail'], ['key' => 'doomed']));
$attempt = Runner::run($failing['id']);
$row = $pdo->query("SELECT * FROM \"__zero_jobs\" WHERE \"id\" = '{$failing['id']}'")->fetch();
check('a throwing handler fails the attempt and backs off 1 minute', $attempt['state'] === 'failed' && $row['attempts'] === 1
    && $row['runAt'] === '2026-01-01T00:01:00.000Z' && str_contains($row['lastError'], 'notify failed on attempt 1'), $row);
eq('a failed job is not due before its backoff', Runner::next() === $failing['id'], false);
$during = $db->transaction(static fn () => Jobs::enqueue('notify', ['postId' => 9], ['key' => 'doomed']));
check('dedupe holds only while pending/running: a failed job frees its key', $during !== $failing, [$during, $failing]);
$pdo->exec("DELETE FROM \"__zero_jobs\" WHERE \"id\" = '{$during['id']}'");
putenv('ZERO_NOW=2026-01-01T00:01:00.000Z');
eq('second attempt fails, backoff 5 minutes', [Runner::run($failing['id'])['state'], $pdo->query("SELECT \"runAt\" FROM \"__zero_jobs\" WHERE \"id\" = '{$failing['id']}'")->fetchColumn()], ['failed', '2026-01-01T00:06:00.000Z']);
putenv('ZERO_NOW=2026-01-01T00:06:00.000Z');
$last = Runner::run($failing['id']);
eq('the third failure (retries: 3) is dead', [$last['state'], $last['attempts']], ['dead', 3]);
eq('a dead job is never run again', Runner::run($failing['id']), null);
eq('each failed attempt rolled back its write and its enqueue', [count($db->findMany('comments', ['where' => ['name' => 'partial']])),
    (int) $pdo->query("SELECT COUNT(*) FROM \"__zero_jobs\" WHERE \"input\" LIKE '%from-failed%'")->fetchColumn(), $outbox()], [0, 0, 0]);

// ---- CLI: list, retry, cancel ------------------------------------------------------------------------------------
[, $out] = $cli('jobs', 'list', '--state', 'dead');
eq('`jobs list --state dead`', array_column($out['data'], 'id'), [$failing['id']]);
[, $out] = $cli('jobs', 'retry', $failing['id']);
eq('`jobs retry` re-queues a dead job from attempt 0', [$out['data'] ?? null, $jobs('pending') !== []], [['id' => $failing['id'], 'state' => 'pending'], true]);
[, $out] = $cli('jobs', 'cancel', $delayed['id']);
eq('`jobs cancel`', $out['data'] ?? null, ['id' => $delayed['id'], 'state' => 'dead']);
eq('`jobs cancel` on a dead job is refused', $cli('jobs', 'cancel', $delayed['id'])[1]['error']['code'] ?? null, 'not_cancellable');

// ---- stuck running jobs are re-queued after 10 minutes ---------------------------------------------------------
$pdo->exec("UPDATE \"__zero_jobs\" SET \"state\" = 'running', \"lockedAt\" = '2025-12-31T23:55:59.000Z' WHERE \"id\" = '{$failing['id']}'");
eq('maintain re-queues a stuck job', Runner::maintain()['requeued'], 1);
eq('the stuck job is pending again', $pdo->query("SELECT \"state\" FROM \"__zero_jobs\" WHERE \"id\" = '{$failing['id']}'")->fetchColumn(), 'pending');

// ---- once() and Idempotency-Key ------------------------------------------------------------------------------------
[$s1, $r1] = $request('POST', '/actions/remember', ['note' => 'a']);
$db->insert('comments', ['postId' => $created['data']['id'], 'name' => 'x', 'body' => 'y']);
[$s2, $r2] = $request('POST', '/actions/remember', ['note' => 'a']);
check('once(): the second call returns the stored result', $s1 === 200 && $r1 === $r2, [$r1, $r2]);
eq('a replay keeps {} and [] apart', $app->handle('POST', '/actions/remember', [], '{"note":"a"}')[2], '{"data":{"note":"a","at":' . $r1['data']['at'] . ',"empty":{},"list":[]}}');
eq('once(): same key, different input → 409 idempotency_mismatch', $request('POST', '/actions/remember', ['note' => 'a2'])[1]['code'] ?? null, 'idempotency_mismatch');
[, $other] = $request('POST', '/actions/remember', ['note' => 'a'], $editor);
check('once() is per calling user', $other['data']['at'] !== $r1['data']['at'], [$other, $r1]);

[$s1, $r1, $h1] = $request('POST', '/actions/remember', ['note' => 'b'], ['idempotency-key' => 'req-1']);
[$s2, $r2, $h2] = $request('POST', '/actions/remember', ['note' => 'b'], ['idempotency-key' => 'req-1']);
check('Idempotency-Key replay returns the stored result with Idempotent-Replayed', $s1 === 200 && $s2 === 200 && $r1 === $r2
    && !isset($h1['idempotent-replayed']) && ($h2['idempotent-replayed'] ?? null) === 'true', [$h1, $h2]);
[$s, $mismatch] = $request('POST', '/actions/remember', ['note' => 'c'], ['idempotency-key' => 'req-1']);
eq('same key, different body → 409 idempotency_mismatch', [$s, $mismatch['code']], [409, 'idempotency_mismatch']);
[$s, , $h] = $request('POST', '/actions/plain', [], ['idempotency-key' => 'req-1']);
eq('actions without idempotent: true ignore the header', [$s, $h['idempotent-replayed'] ?? null], [200, null]);
$count = static fn () => count($db->findMany('comments'));
$before = $count();
[$s1, $c1] = $request('POST', '/comments', ['postId' => $created['data']['id'], 'name' => 'n', 'body' => 'once'], ['idempotency-key' => 'create-1']);
[$s2, $c2, $h2] = $request('POST', '/comments', ['postId' => $created['data']['id'], 'name' => 'n', 'body' => 'once'], ['idempotency-key' => 'create-1']);
check('creates replay with their 201 and create no second row', $s1 === 201 && $s2 === 201 && $c1 === $c2 && $count() === $before + 1
    && ($h2['idempotent-replayed'] ?? null) === 'true', [$s1, $s2, $c1, $c2]);
eq('an over-long key is rejected', $request('POST', '/actions/remember', ['note' => 'd'], ['idempotency-key' => str_repeat('k', 65)])[1]['code'], 'invalid_idempotency_key');
$pdo->exec("INSERT INTO \"__zero_receipts\" VALUES ('action:remember', 'stuck', 0, '" . hash('sha256', '{"note":"e"}') . "', 'started', NULL, '2026-01-01T00:00:00.000Z')");
eq('a started receipt → 409 outcome_unknown', $request('POST', '/actions/remember', ['note' => 'e'], ['idempotency-key' => 'stuck'])[1]['code'], 'outcome_unknown');
[$s] = $request('POST', '/posts', ['title' => 'Explode'], $editor + ['idempotency-key' => 'boom']);
eq('a rolled-back request forgets its receipt', [$s, (int) $pdo->query("SELECT COUNT(*) FROM \"__zero_receipts\" WHERE \"key\" = 'boom'")->fetchColumn()], [500, 0]);

putenv('ZERO_NOW=2026-01-08T00:06:00.001Z');
$left = (int) $pdo->query('SELECT COUNT(*) FROM "__zero_receipts"')->fetchColumn();
eq('receipts older than 7 days are swept', [Runner::maintain()['swept'], (int) $pdo->query('SELECT COUNT(*) FROM "__zero_receipts"')->fetchColumn()], [$left, 0]);

finish('jobs');
