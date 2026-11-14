<?php

declare(strict_types=1);

namespace First\Wp\Jobs;

use First\Jobs\Runner;
use First\Jobs\Storage;
use First\Wp\Runtime;

/**
 * WordPress delivery through Action Scheduler (§6.1). The `first__jobs` row stays the source of truth
 * (attempts, backoff, dead); AS gets one single action per attempt, written in the transaction that
 * writes the job row. Action Scheduler writes through the global $wpdb, the connection First's
 * transactions run on (Wp\Connection), so the action commits or rolls back with the row; nothing is
 * handed over after commit, and a crash after commit loses nothing. First's own (job, key) dedupe runs
 * first, so AS uniqueness stays off.
 *
 * One thing Action Scheduler keeps outside the database: the id of each group it creates, cached for
 * ten minutes (ActionScheduler_DBStore::create_group). A group created inside a transaction that then
 * rolls back would stay cached under an id with no row, so prepare() creates First's groups at
 * `action_scheduler_init`, before any transaction, and every action later finds its group committed.
 */
final class ActionSchedulerQueue
{
    public const HOOK = 'first_job';
    public const MAINTAIN = 'first_jobs_maintain';
    /** The groups this site's jobs and maintenance use, recorded once they exist (prepare()). */
    public const PREPARED = 'first_jobs_prepared';

    /** The group of the action Action Scheduler is executing right now. */
    private static string $group = '';
    /** When that action was scheduled for (Unix seconds), or null. */
    private static ?int $scheduled = null;

    public static function register(): void
    {
        add_action('action_scheduler_before_execute', static function (int $actionId): void {
            $action = \ActionScheduler::store()->fetch_action($actionId);
            self::$group = (string) ($action->get_group() ?? '');
            $date = $action->get_schedule()?->get_date();
            self::$scheduled = $date instanceof \DateTimeInterface ? $date->getTimestamp() : null;
        });
        add_action(self::HOOK, static function (string $id): void {
            $plugin = Runtime::plugin();
            if ($plugin !== null && $plugin->unavailable() !== null) {
                // Storage is behind this build: run the job once it has caught up, not on the old schema.
                self::schedule($id, \First\Js::iso(\First\Js::now() + 60_000));
            } elseif ($plugin?->app() !== null) {
                // A delivery scheduled for before its job's time is an older one: a failed attempt moved
                // the job later and scheduled its own delivery for then, so running now would skip the
                // backoff. The job's current delivery runs even if someone runs it early by hand.
                $runAt = \First\Jobs\Storage::run('SELECT "runAt" FROM {jobs} WHERE "id" = ?', [$id])[0]['runAt'] ?? null;
                if (is_string($runAt) && self::$scheduled !== null && \First\Js::date($runAt) > \First\Js::now()
                    && self::$scheduled < intdiv((int) \First\Js::date($runAt), 1000)) {
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
            // Maintenance mutates jobs and receipts: skip it while storage is behind; it recurs.
            $plugin = Runtime::plugin();
            if ($plugin !== null && $plugin->unavailable() === null && $plugin->app() !== null) {
                Runner::maintain();
            }
        });
        add_action('action_scheduler_init', static function (): void {
            if (Runtime::plugin() === null) {
                return;
            }
            self::prepare();
            if (!as_has_scheduled_action(self::MAINTAIN, [], 'first')) {
                as_schedule_recurring_action(time() + 3600, DAY_IN_SECONDS, self::MAINTAIN, [], 'first');
            }
        }, 0);
    }

    /**
     * Once per site and app: create First's Action Scheduler groups outside any transaction, and give
     * a job that a runtime before this one left in `first__outbox` (committed, not yet handed to Action
     * Scheduler) its action. The outbox rows themselves stay: data is never deleted automatically.
     * Runs again for a new app name, and on the next request after a failure.
     */
    private static function prepare(): void
    {
        $plugin = Runtime::plugin();
        if ($plugin === null || $plugin->unavailable() !== null || \First\Wp\ZeroNames::pending()) {
            return; // storage is behind this build; a later request prepares
        }
        $groups = ['first', 'first-' . $plugin->schema->name()];
        $done = implode(',', $groups);
        if (get_option(self::PREPARED) === $done) {
            return;
        }
        $connection = $plugin->connection();
        if ($connection->inTransaction()) {
            return; // never inside a transaction: that is the hazard this avoids
        }
        try {
            // One request at a time, so two first requests don't both create a group.
            \First\Wp\Migrator::locked($connection, self::PREPARED, static function () use ($connection, $groups, $done, $plugin): void {
                wp_cache_delete(self::PREPARED, 'options');
                if (get_option(self::PREPARED) === $done) {
                    return;
                }
                self::createGroups($connection, $groups);
                self::moveOutbox($plugin);
                update_option(self::PREPARED, $done, true); // read on every request
            });
        } catch (\Throwable $e) {
            error_log('[first] preparing Action Scheduler for jobs failed (next request retries): ' . $e->getMessage());
        }
    }

    /** @param list<string> $groups */
    private static function createGroups(\First\Wp\Connection $connection, array $groups): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'actionscheduler_groups';
        foreach ($groups as $slug) {
            $connection->run("INSERT INTO `$table` (`slug`) SELECT ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `$table` WHERE `slug` = ?)", [$slug, $slug]);
            // The committed row, so an id a rolled-back creation left in a persistent cache is replaced.
            $groupId = (int) ($connection->run("SELECT MIN(`group_id`) AS `id` FROM `$table` WHERE `slug` = ?", [$slug])[0]['id'] ?? 0);
            if ($groupId > 0) {
                wp_cache_set($slug, $groupId, \ActionScheduler_DBStore::GROUP_IDS_CACHE_GROUP, 10 * MINUTE_IN_SECONDS);
            }
        }
    }

    /**
     * A runtime before this one wrote each job's ticket to `first__outbox` and handed it to Action
     * Scheduler after commit; a crash in between left the ticket. Each pending job with a ticket and no
     * pending or running action gets one, scheduled for its runAt. The tickets are left as they are.
     */
    private static function moveOutbox(\First\Wp\Plugin $plugin): void
    {
        global $wpdb;
        $connection = $plugin->connection();
        if ($connection->run('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$wpdb->prefix . 'first__outbox']) === []) {
            return;
        }
        $plugin->app();
        $db = \First\db();
        foreach (Storage::run('SELECT "id" FROM {outbox} ORDER BY "createdAt", "id"') as $ticket) {
            $id = (string) $ticket['id'];
            $db->transaction(static function () use ($id): void {
                $job = Storage::run('SELECT "runAt" FROM {jobs} WHERE "id" = ? AND "state" = \'pending\'' . Storage::forUpdate(), [$id])[0] ?? null;
                if ($job !== null && !as_has_scheduled_action(self::HOOK, ['id' => $id])) {
                    self::schedule($id, (string) $job['runAt']);
                }
            });
        }
    }

    /** One delivery of job $id at $runAtIso (never in the past), in the caller's transaction when one is open. */
    public static function schedule(string $id, string $runAtIso): void
    {
        $app = Runtime::plugin()?->schema->name() ?? 'app';
        $at = (int) floor(\First\Js::date($runAtIso) / 1000);
        if (as_schedule_single_action(max($at, time()), self::HOOK, ['id' => $id], 'first-' . $app, false) === 0) {
            throw new \RuntimeException("Action Scheduler refused to schedule job $id");
        }
    }
}
