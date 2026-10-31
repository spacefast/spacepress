<?php

declare(strict_types=1);

namespace Zero\Wp\Jobs;

use Zero\Jobs\Outbox;
use Zero\Jobs\Queue;
use Zero\Jobs\Runner;
use Zero\Wp\Runtime;

/**
 * WordPress delivery through Action Scheduler (§6.1). The `zero__jobs` row stays the source of truth
 * (attempts, backoff, dead); AS gets one single action per attempt, written on Zero's connection so
 * it commits with the job row. Zero's own (job, key) dedupe runs first, so AS uniqueness stays off.
 */
final class ActionSchedulerQueue implements Queue
{
    public const HOOK = 'zero_job';
    public const MAINTAIN = 'zero_jobs_maintain';

    public static function register(): void
    {
        Outbox::useQueue(new self());
        add_action(self::HOOK, static function (string $id): void {
            $plugin = Runtime::plugin();
            if ($plugin !== null && $plugin->unavailable() !== null) {
                // Storage is behind this build: run the job once it has caught up, not on the old schema.
                (new self())->schedule($id, \Zero\Js::iso(\Zero\Js::now() + 60_000));
            } elseif ($plugin?->app() !== null) {
                Runner::run($id);
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
            if (Runtime::plugin() !== null && !as_has_scheduled_action(self::MAINTAIN, [], 'zero')) {
                as_schedule_recurring_action(time() + 3600, DAY_IN_SECONDS, self::MAINTAIN, [], 'zero');
            }
        });
    }

    public function schedule(string $id, string $runAtIso): void
    {
        $app = Runtime::plugin()?->schema->name() ?? 'app';
        $at = (int) floor(\Zero\Js::date($runAtIso) / 1000);
        if (as_schedule_single_action(max($at, time()), self::HOOK, ['id' => $id], 'zero-' . $app, false) === 0) {
            throw new \RuntimeException("Action Scheduler refused to schedule job $id");
        }
    }
}
