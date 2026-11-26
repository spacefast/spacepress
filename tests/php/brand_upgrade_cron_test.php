<?php

declare(strict_types=1);

/*
 * BrandUpgrade::cron() on its own, against an in-memory cron array: an event already under the
 * current hook at the same time and arguments is the one moving only when it is the same event,
 * compared strictly (custom schedule names "01" and "001" are two schedules).
 */

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/harness.php';

$GLOBALS['cron'] = [];
function _get_cron_array(): array
{
    return $GLOBALS['cron'];
}
function _set_cron_array(array $cron, bool $wp_error = false): bool
{
    $GLOBALS['cron'] = $cron;

    return true;
}
function is_wp_error(mixed $thing): bool
{
    return false;
}

$cron = new ReflectionMethod(\SpacePress\Wp\BrandUpgrade::class, 'cron');
$hooks = ['tp_jobs_maintain' => 'sp_jobs_maintain'];
$key = md5(serialize([]));
$at = 1_900_000_000;
$event = static fn (mixed $schedule, mixed $interval = null, bool $intervalFirst = false): array => $intervalFirst
    ? ['interval' => $interval, 'args' => [], 'schedule' => $schedule]
    : ['schedule' => $schedule, 'args' => []] + ($interval === null ? [] : ['interval' => $interval]);
$run = static function (array $events, bool $dry = false) use ($cron, $hooks, $at): array {
    $GLOBALS['cron'] = [$at => $events];
    $taken = $dry ? [] : null;
    try {
        $dry ? $cron->invokeArgs(null, [$hooks, &$taken]) : $cron->invoke(null, $hooks);
    } catch (\RuntimeException $e) {
        return ['refused', $GLOBALS['cron']];
    }

    return [$dry ? $taken : 'moved', $GLOBALS['cron']];
};

$distinct = ['tp_jobs_maintain' => [$key => $event('01', 60)], 'sp_jobs_maintain' => [$key => $event('001', 60)]];
eq('a current event on schedule "001" is not the one moving on "01": the move stops before anything changes', $run($distinct), ['refused', [$at => $distinct]]);
eq('… and a dry run reports it', $run($distinct, true)[0], ["scheduled event sp_jobs_maintain at $at"]);
$single = ['tp_jobs_maintain' => [$key => $event(false)], 'sp_jobs_maintain' => [$key => $event('0')]];
eq('a single event is not one on schedule "0"', $run($single)[0], 'refused');
$args = ['tp_jobs_maintain' => [$key => ['schedule' => 'hourly', 'args' => [0], 'interval' => 3600]], 'sp_jobs_maintain' => [$key => ['args' => ['0'], 'schedule' => 'hourly', 'interval' => 3600]]];
eq('arguments that only loosely equal another event\'s are another event', $run($args)[0], 'refused');
// The same event, its keys in another order or its interval stored as a string, is the one moving.
$same = ['tp_jobs_maintain' => [$key => $event('hourly', 3600)], 'sp_jobs_maintain' => [$key => $event('hourly', '3600', true)]];
eq('the same event, keys in another order and its interval a numeric string, moves as one', $run($same), ['moved', [$at => ['sp_jobs_maintain' => [$key => $event('hourly', 3600)]]]]);
eq('an event with nothing under the current hook moves', $run(['tp_jobs_maintain' => [$key => $event('01', 60)]]), ['moved', [$at => ['sp_jobs_maintain' => [$key => $event('01', 60)]]]]);

finish('brand_upgrade_cron');
