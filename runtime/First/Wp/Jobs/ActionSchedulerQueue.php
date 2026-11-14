<?php

declare(strict_types=1);

namespace First\Wp\Jobs;

use First\Jobs\Outbox;
use First\Jobs\Queue;
use First\Jobs\Runner;
use First\Wp\Runtime;

/**
 * WordPress delivery through Action Scheduler (§6.1). The `first__jobs` row stays the source of truth
 * (attempts, backoff, dead); AS gets one single action per attempt, written on First's connection so
 * it commits with the job row. First's own (job, key) dedupe runs first, so AS uniqueness stays off.
 */
final class ActionSchedulerQueue implements Queue
{
    public const HOOK = 'first_job';
    public const MAINTAIN = 'first_jobs_maintain';

    /** The group of the action Action Scheduler is executing right now. */
    private static string $group = '';

    public static function register(): void
    {
        Outbox::useQueue(new self());
        add_action('action_scheduler_before_execute', static function (int $actionId): void {
            self::$group = (string) (\ActionScheduler::store()->fetch_action($actionId)->get_group() ?? '');
        });
        add_action(self::HOOK, static function (string $id): void {
            $plugin = Runtime::plugin();
            if ($plugin !== null && $plugin->unavailable() !== null) {
                // Storage is behind this build: run the job once it has caught up, not on the old schema.
                (new self())->schedule($id, \First\Js::iso(\First\Js::now() + 60_000));
            } elseif ($plugin?->app() !== null) {
                // A delivery that arrives before its job's time is an older one: a failed attempt moved
                // the job later and scheduled its own delivery for then. Running now would skip the backoff.
                $runAt = \First\Jobs\Storage::run('SELECT "runAt" FROM {jobs} WHERE "id" = ?', [$id])[0]['runAt'] ?? null;
                if (is_string($runAt) && \First\Js::date($runAt) > \First\Js::now()) {
                    return;
                }
                Runner::run($id);
            } else {
                // No First app is running (deactivated or uninstalled, runtime still active). A job
                // still waiting to run keeps its delivery, in the same app's group, so a reactivated
                // or reinstalled app runs it; a cancelled, finished or missing job needs none.
                global $wpdb;
                // Through First's connection, which throws on a database error: a failed read must fail
                // this action, not complete it as if the job were gone.
                $state = (new \First\Wp\Connection($wpdb))->run('SELECT `state` FROM `' . $wpdb->prefix . 'first__jobs` WHERE `id` = ?', [$id])[0]['state'] ?? null;
                if (!in_array($state, ['pending', 'failed'], true)) {
                    return;
                }
                if (as_schedule_single_action(time() + HOUR_IN_SECONDS, self::HOOK, ['id' => $id], self::$group !== '' ? self::$group : 'first-app', false) === 0) {
                    // Couldn't keep a delivery: fail this action loudly (Action Scheduler records it as
                    // failed, with this message, in Tools > Scheduled Actions) rather than complete it.
                    throw new \RuntimeException("First job $id is waiting for its app, and Action Scheduler refused to keep its delivery");
                }
            }
        });
        add_action(self::MAINTAIN, static function (): void {
            // Maintenance mutates jobs, outbox and receipts: skip it while storage is behind; it recurs.
            $plugin = Runtime::plugin();
            if ($plugin !== null && $plugin->unavailable() === null && $plugin->app() !== null) {
                Runner::maintain();
            }
        });
        add_action('action_scheduler_init', static function (): void {
            if (Runtime::plugin() !== null && !as_has_scheduled_action(self::MAINTAIN, [], 'first')) {
                as_schedule_recurring_action(time() + 3600, DAY_IN_SECONDS, self::MAINTAIN, [], 'first');
            }
        });
    }

    public function schedule(string $id, string $runAtIso): void
    {
        $app = Runtime::plugin()?->schema->name() ?? 'app';
        $at = (int) floor(\First\Js::date($runAtIso) / 1000);
        if (as_schedule_single_action(max($at, time()), self::HOOK, ['id' => $id], 'first-' . $app, false) === 0) {
            throw new \RuntimeException("Action Scheduler refused to schedule job $id");
        }
    }
}
