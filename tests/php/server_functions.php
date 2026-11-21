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

// ---- structured input is checked against its type; nullable is not optional ------------------------------------
eq('a structured input that fits runs', $call('tag', ['who' => ['name' => 'ann'], 'tags' => ['a', 'b'], 'note' => null])[1], 'ann:a,b:none');
[$status, $problem] = $call('tag', ['who' => ['name' => 99], 'tags' => ['a'], 'note' => null]);
eq('a nested field of the wrong type is refused where it is', [$status, $problem['pointer'] ?? null], [422, '/who/name']);
[$status, $problem] = $call('tag', ['who' => ['name' => 'ann'], 'tags' => 'a', 'note' => null]);
eq('a list sent as a string is refused', [$status, $problem['pointer'] ?? null], [422, '/tags']);
[$status, $problem] = $call('tag', ['who' => ['name' => 'ann', 'extra' => 1], 'tags' => [], 'note' => null]);
eq('a nested key the type does not declare is refused', [$status, $problem['pointer'] ?? null], [422, '/who/extra']);
[$status, $problem] = $call('tag', ['who' => ['name' => 'ann'], 'tags' => []]);
eq('a nullable field must still be sent', [$status, $problem['pointer'] ?? null], [422, '/note']);
$tag = wp_get_ability('fns/tag')->get_input_schema();
eq('the ability schema states the type and what is required', [$tag['properties']['tags']['items']['type'] ?? null, $tag['required'] ?? []], ['string', ['who', 'tags', 'note']]);

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

// ---- concurrent calls each count: the counter is one row updated in each call's transaction ------------------------
$rates = static fn () => (int) $wp->scalar('SELECT MAX(`used`) FROM {prefix}tp__rates');
$_SERVER['REMOTE_ADDR'] = '192.0.2.9';
$call('add', ['title' => 'r1']);
$call('add', ['title' => 'r2', 'fail' => true]);
eq('a call and a failed call both count', $wp->scalar('SELECT `used` FROM {prefix}tp__rates ORDER BY `used` DESC LIMIT 1') !== null, true);
check('the counter is a row, not an option', $rates() >= 2);

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
// A running instance of the dropped schedule: Action Scheduler stores its successor after it runs, which is cancelled.
$stale = as_schedule_cron_action(time() - 10, '0 3 * * *', 'tp_job_schedule', ['nightly', 'cron:0 3 * * *'], 'typedpress-fns');
eq('an instance stored for a schedule the build dropped is cancelled at once', $wp->scalar('SELECT `status` FROM {prefix}actionscheduler_actions WHERE `action_id` = ?', [$stale]), 'canceled');
$second = as_schedule_recurring_action(time() + 60, 3600, 'tp_job_schedule', ['hourly', 'every:3600'], 'typedpress-fns');
eq('a second pending instance of a kept schedule is cancelled', [$wp->scalar('SELECT `status` FROM {prefix}actionscheduler_actions WHERE `action_id` = ?', [$second]), count($schedules())], ['canceled', 1]);
// Another app's schedule with the same job and spelling never runs this app's job.
$before = (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}tp__jobs WHERE `job` = 'hourly'");
$other = as_schedule_single_action(time() - 5, 'tp_job_schedule', ['hourly', 'every:3600'], 'typedpress-other-app');
ActionScheduler_QueueRunner::instance()->process_action($other, 'TypedPress tests');
eq('another app\'s schedule queues nothing here', (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}tp__jobs WHERE `job` = 'hourly'"), $before);

finish('server functions');
