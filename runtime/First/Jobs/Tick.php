<?php

declare(strict_types=1);

namespace First\Jobs;

use First\Js;
use function First\db;

/**
 * `wp first jobs tick`: one bounded pass of every background duty on this site, for a host whose
 * own worker drives WordPress (no wp-cron spawn, no Action Scheduler async runner). A host calls it
 * on a schedule and again while `remaining` is true. It never spawns HTTP requests or processes.
 *
 * In order, each within what is left of `limit` (units of work) and `budgetMs` (wall time):
 * 1. hand committed outbox tickets to the queue, oldest first;
 * 2. re-queue jobs whose runner died (`running` longer than Runner::STUCK_MS);
 * 3. expire idempotency receipts older than Runner::RECEIPT_TTL_MS;
 * 4. run due jobs directly, at most half of what is left, so maintenance always gets a share;
 * 5. run due Action Scheduler actions (uploads cleanup, guest pruning, identity dispatch, deliveries
 *    the direct pass didn't reach);
 * 6. run due WP-Cron events (identity maintenance and the like), rescheduling recurring ones.
 *
 * A failing job counts as a failure and is retried by its own policy; a failing action or event
 * counts too and the pass goes on. Expired receipts are the one thing it deletes: they are the
 * idempotency cache, kept 7 days by design (Runner::maintain deletes them the same way).
 */
final class Tick
{
    public const DEFAULT_LIMIT = 25;
    public const MAX_LIMIT = 100;
    public const DEFAULT_BUDGET_MS = 45_000;

    /** @return array{processed: int, failures: int, outboxDispatched: int, requeued: int, receiptsExpired: int, remaining: bool} */
    public static function run(int $limit = self::DEFAULT_LIMIT, int $budgetMs = self::DEFAULT_BUDGET_MS): array
    {
        $limit = max(1, min(self::MAX_LIMIT, $limit));
        $deadline = microtime(true) + max(1, $budgetMs) / 1000;
        $left = static fn (int $used): int => microtime(true) >= $deadline ? 0 : max(0, $limit - $used);
        $processed = 0;
        $failures = 0;
        $remaining = false;

        // 1. Outbox: one ticket is one unit.
        $tickets = Storage::run('SELECT "id" FROM {outbox} ORDER BY "createdAt", "id" LIMIT ' . $limit);
        $dispatched = $tickets === [] ? 0 : Outbox::dispatch(array_column($tickets, 'id'));
        $failures += count($tickets) - $dispatched;
        $remaining = $remaining || count($tickets) === $limit;

        // 2 and 3. Recovery and expiry, bounded by the same limit.
        $now = Js::now();
        [$requeued, $expired] = db()->transaction(static function () use ($limit, $now): array {
            $stuck = Storage::run('SELECT "id" FROM {jobs} WHERE "state" = \'running\' AND "lockedAt" < ? ORDER BY "lockedAt", "id" LIMIT ' . $limit . Storage::forUpdate(), [Js::iso($now - Runner::STUCK_MS)]);
            foreach ($stuck as $row) {
                Storage::run('UPDATE {jobs} SET "state" = \'pending\', "lockedAt" = NULL, "runAt" = ? WHERE "id" = ?', [Js::iso($now), $row['id']]);
                Outbox::queue()->schedule((string) $row['id'], Js::iso($now));
            }
            Storage::run('DELETE FROM {receipts} WHERE "createdAt" < ? LIMIT ' . $limit, [Js::iso($now - Runner::RECEIPT_TTL_MS)]);

            return [count($stuck), Storage::changes()];
        });
        $remaining = $remaining || $requeued === $limit || $expired === $limit;

        // 4. Due jobs, directly: at most half of what is left, and at least one.
        $direct = max(1, intdiv($left($processed), 2));
        if ($left($processed) > 0) {
            $due = Storage::run('SELECT "id" FROM {jobs} WHERE "state" IN (\'pending\', \'failed\') AND "runAt" <= ? ORDER BY "runAt", "id" LIMIT ' . ($direct + 1), [Js::iso(Js::now())]);
            $remaining = $remaining || count($due) > $direct;
            foreach (array_slice($due, 0, $direct) as $row) {
                if ($left($processed) === 0) {
                    $remaining = true;
                    break;
                }
                $result = Runner::run((string) $row['id']);
                $processed++;
                if ($result !== null && $result['state'] !== 'done') {
                    $failures++;
                }
            }
        }

        // 5. Due Action Scheduler actions. A job delivery whose job already ran above finds it done
        // and completes as a no-op (ActionSchedulerQueue's handler); one moved later by a failed
        // attempt waits for its new time (Runner::run refuses jobs that are not yet due).
        if (class_exists(\ActionScheduler::class) && $left($processed) > 0) {
            $store = \ActionScheduler::store();
            $ids = $store->query_actions(['status' => \ActionScheduler_Store::STATUS_PENDING, 'date' => new \DateTime('now', new \DateTimeZone('UTC')), 'date_compare' => '<=', 'per_page' => $left($processed) + 1, 'orderby' => 'date', 'order' => 'ASC']);
            foreach ($ids as $i => $id) {
                if ($left($processed) === 0) {
                    $remaining = true;
                    break;
                }
                \ActionScheduler::runner()->process_action((int) $id, 'first-jobs-tick');
                $processed++;
                if ($store->get_status((int) $id) === \ActionScheduler_Store::STATUS_FAILED) {
                    $failures++;
                }
            }
        }

        // 6. Due WP-Cron events, run in this process. Action Scheduler's own queue hook is skipped: its
        // actions were run above, within the limit.
        $cron = function_exists('wp_get_ready_cron_jobs') ? wp_get_ready_cron_jobs() : [];
        foreach ($cron as $timestamp => $hooks) {
            foreach ($hooks as $hook => $events) {
                foreach ($events as $event) {
                    if ($hook === 'action_scheduler_run_queue') {
                        continue;
                    }
                    if ($left($processed) === 0) {
                        $remaining = true;
                        break 3;
                    }
                    if (!empty($event['schedule'])) {
                        wp_reschedule_event((int) $timestamp, (string) $event['schedule'], (string) $hook, $event['args'], true);
                    }
                    wp_unschedule_event((int) $timestamp, (string) $hook, $event['args'], true);
                    try {
                        do_action_ref_array((string) $hook, $event['args']);
                    } catch (\Throwable $e) {
                        error_log('[first] jobs tick: ' . $hook . ': ' . $e->getMessage());
                        $failures++;
                    }
                    $processed++;
                }
            }
        }

        return ['processed' => $processed, 'failures' => $failures, 'outboxDispatched' => $dispatched,
            'requeued' => $requeued, 'receiptsExpired' => $expired, 'remaining' => $remaining];
    }
}
