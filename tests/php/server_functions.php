<?php

declare(strict_types=1);

/*
 * query(), mutation(), job(options, handler), cron() and x.enqueue() on WordPress: tests/fixtures/server-functions,
 * built by `typedpress build`, booted in-process (tests/php/wp.php) with Action Scheduler. Calls go through the
 * seam the REST route uses; due work is run by Action Scheduler's own queue runner.
 *
 *   php tests/php/server_functions.php <wp-content dir>
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp = wpSite('server-functions', ['wpContent' => $argv[1]]);
$call = static fn (string $name, array $input, array $headers = []) => $wp->call('POST', "/actions/$name", (object) $input, null, [], [], [], $headers);
$schedules = static fn (): array => array_map(
    static fn (array $row): array => [$row['args'], $row['schedule'] === null ? null : get_class(unserialize($row['schedule']))],
    $wp->sql("SELECT `args`, `schedule` FROM {prefix}actionscheduler_actions WHERE `hook` = 'tp_job_schedule' AND `status` = 'pending' ORDER BY `args`"),
);
$runDue = static fn () => ActionScheduler_QueueRunner::instance()->run('TypedPress tests');

// ---- a query: typed input, an omitted optional field takes its default -------------------------------------------
$wp->exec("INSERT INTO {prefix}tp_notes (`title`) VALUES ('one'), ('two'), ('three')");
eq('a query with no input uses its destructuring defaults', $call('recent', [])[1], ['three', 'two']);
eq('a query reads its typed input', $call('recent', ['limit' => 1, 'prefix' => '> '])[1], ['> three']);
[$status, $problem] = $call('recent', ['limit' => 'two']);
eq('input of the wrong type is refused before the handler runs', [$status, $problem['code'], $problem['pointer'] ?? null], [422, 'invalid_input', '/limit']);
[$status, $problem] = $call('recent', ['limit' => 1, 'other' => true]);
eq('an input field the type does not declare is refused', [$status, $problem['code']], [422, 'invalid_input']);
$query = wp_get_ability('fns/recent');
eq('a query is a read-only ability', [(bool) ($query->get_meta_item('annotations')['readonly'] ?? false)], [true]);
eq('its optional input fields are not required', $query->get_input_schema()['required'] ?? [], []);

// ---- a mutation: one transaction with the job it queues on the job's own export ---------------------------------
[$status, $added] = $call('add', ['title' => 'four']);
eq('a mutation writes', $status, 200);
$id = $added['id'];
$queued = $wp->sql("SELECT `job`, `input`, `key` FROM {prefix}tp__jobs WHERE `job` = 'stamp'");
eq('x.enqueue() queues that job with its input and key', [count($queued), json_decode($queued[0]['input'], true), $queued[0]['key']], [1, ['id' => $id], "note-$id"]);
[$status, $problem] = $call('add', ['title' => 'five', 'fail' => true]);
eq('a mutation that throws', [$status, $problem['code']], [409, 'rolled_back']);
eq('rolls back its write and its job together', [(int) $wp->scalar("SELECT COUNT(*) FROM {prefix}tp_notes WHERE `title` = 'five'"), count($wp->sql("SELECT 1 FROM {prefix}tp__jobs WHERE `job` = 'stamp'"))], [0, 1]);
[$status, $problem] = $call('add', ['title' => str_repeat('x', 21)]);
eq('a check in the handler names its field', [$status, $problem['pointer'] ?? null], [422, '/title']);
$runDue();
eq('Action Scheduler runs the queued job', $wp->scalar('SELECT `stamped` FROM {prefix}tp_notes WHERE `id` = ?', [$id]), 'yes');

// ---- rate limits: per caller and window; a failed call still counts ----------------------------------------------
eq('the declared limit (3/min) is used up by the calls above, failed ones included', $call('add', ['title' => 'six'])[0], 429);
$_SERVER['REMOTE_ADDR'] = '192.0.2.7';
eq('another address has its own count', $call('add', ['title' => 'six'])[0], 200);
$opened = array_map(static fn () => $call('open', [])[0], range(1, 31));
eq('a mutation open to anyone gets 30 calls a minute by default', [$opened[29], $opened[30]], [200, 429]);

// ---- every and cron: scheduled once per build on Action Scheduler, removed with the job ---------------------------
do_action('action_scheduler_init');
eq('each schedule is one Action Scheduler action', $schedules(), [
    ['["hourly","every:3600"]', ActionScheduler_IntervalSchedule::class],
    ['["nightly","cron:0 3 * * *"]', ActionScheduler_CronSchedule::class],
]);
do_action('action_scheduler_init');
eq('installing again adds nothing', count($schedules()), 2);
check('and the install is recorded as done', \TypedPress\Wp\Jobs\ActionSchedulerQueue::installed());
// Fire the hourly schedule now, as Action Scheduler would at its time.
$hourly = (int) $wp->scalar("SELECT `action_id` FROM {prefix}actionscheduler_actions WHERE `hook` = 'tp_job_schedule' AND `args` = ? AND `status` = 'pending'", ['["hourly","every:3600"]']);
ActionScheduler_QueueRunner::instance()->process_action($hourly, 'TypedPress tests');
$runDue();
eq('a firing queues the job, which then runs', $wp->sql('SELECT `by` FROM {prefix}tp_ticks'), [['by' => 'every']]);
eq('and the recurring action is scheduled again', count($schedules()), 2);
// A build without `nightly`: the same site with that job taken out of the app's schema.php, loaded
// the way a deploy loads a new build. Its action goes; `hourly` stays.
$schemaFile = $wp->plugin()->dir . '/tp/app/schema.php';
$source = (string) file_get_contents($schemaFile);
$withoutNightly = preg_replace("/^        'nightly' => .*\n(?:(?!        '[a-z]).*\n)*/m", '', $source, 1, $removed);
eq('the test removes the nightly job from the build', $removed, 1);
file_put_contents($schemaFile, $withoutNightly);
$rebuilt = new \TypedPress\Wp\Plugin($wp->plugin()->dir, $wp->plugin()->dir . '/typedpress-app-fns.php', \TypedPress\Schema::load($schemaFile));
(new ReflectionProperty(\TypedPress\Wp\Runtime::class, 'plugin'))->setValue(null, $rebuilt);
// The install marker is keyed by the build's hash, so a new build runs every install step again.
check('the new build is not marked installed', !\TypedPress\Wp\InstallMarker::forget() || !\TypedPress\Wp\InstallMarker::current());
check('a build that drops a schedule is not installed until the schedule is removed', !\TypedPress\Wp\Jobs\ActionSchedulerQueue::installed());
do_action('action_scheduler_init');
eq('the next install unschedules it and keeps the rest', $schedules(), [['["hourly","every:3600"]', ActionScheduler_IntervalSchedule::class]]);

finish('server functions');
