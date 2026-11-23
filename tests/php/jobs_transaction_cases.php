<?php

declare(strict_types=1);

/*
 * A job and its Action Scheduler action commit or roll back together, in the transaction that queues
 * the job. Shared by tests/php/jobs_test.php (WordPress on SQLite, in process) and tests/wp/jobs.test.ts
 * (MariaDB, through `wp eval`), so both engines answer the same four questions:
 *
 * 1. a job queued in a write that rolls back leaves no job row and no action;
 * 2. one queued in a write that commits leaves the job and exactly one pending action;
 * 3. a rollback that would have created SpacePress's Action Scheduler group leaves no cached group id that
 *    the database lacks, under a persistent-style object cache (one whose entries outlive the request
 *    and the transaction, as Memcached or Redis do);
 * 4. a crash after the commit, before any commit callback runs, loses no job: its action committed with it.
 *
 * Returns [label, actual, expected] triples; the caller asserts them. Leaves no job of its own queued.
 */

/** @return list<array{string, mixed, mixed}> */
function firstJobsTransactionCases(string $job, array $input): array
{
    global $wpdb;
    $plugin = \SpacePress\Wp\Runtime::plugin() ?? throw new \LogicException('no SpacePress app is active');
    $connection = $plugin->connection();
    $db = $plugin->app()->db;
    $p = $wpdb->prefix;
    $group = 'spacepress-' . $plugin->schema->name();
    $queued = [];
    $enqueue = static function () use ($job, $input, &$queued): string {
        return $queued[] = \SpacePress\Jobs\Jobs::enqueue($job, $input)['id'];
    };
    $state = static fn (?string $id) => $id === null ? null : ($connection->run("SELECT `state` FROM `{$p}sp__jobs` WHERE `id` = ?", [$id])[0]['state'] ?? null);
    // Each action as "status group": a group id with no row reads as "status (no group)".
    $actions = static fn (?string $id): array => $id === null ? [] : array_map(
        static fn (array $r): string => $r['status'] . ' ' . ($r['slug'] ?? '(no group)'),
        $connection->run("SELECT a.`status`, g.`slug` FROM `{$p}actionscheduler_actions` a LEFT JOIN `{$p}actionscheduler_groups` g ON g.`group_id` = a.`group_id` WHERE a.`hook` = ? AND a.`args` = ? ORDER BY a.`action_id`", ['sp_job', json_encode(['id' => $id])]),
    );
    $rolledBack = static function (callable $fn) use ($db): ?string {
        $id = null;
        try {
            $db->transaction(static function () use ($fn, &$id): void {
                $id = $fn();
                throw new \RuntimeException('first test rollback');
            });
        } catch (\RuntimeException $e) {
            if ($e->getMessage() !== 'first test rollback') {
                throw $e;
            }
        }

        return $id;
    };
    $out = [];

    // 1 and 2.
    $id = $rolledBack($enqueue);
    $out[] = ['a job queued in a write that rolls back leaves no job row and no Action Scheduler action', [$state($id), $actions($id)], [null, []]];
    $id = $db->transaction($enqueue);
    $out[] = ['a job queued in a write that commits leaves the job and exactly one pending action', [$state($id), $actions($id)], ['pending', ["pending $group"]]];

    // 3. A site whose group doesn't exist yet: the next request prepares it (action_scheduler_init),
    // then a write that would have created it rolls back. The cache is shared between "requests".
    $cache = new class () extends \WP_Object_Cache {
        /** @var array<string, mixed> the persistent store: survives the request and every rollback */
        public static array $shared = [];

        public function add($key, $data, $group = 'default', $expire = 0)
        {
            return $group === 'action_scheduler_groups' ? !isset(self::$shared[$key]) && (self::$shared[$key] = $data) !== null : parent::add($key, $data, $group, $expire);
        }

        public function set($key, $data, $group = 'default', $expire = 0)
        {
            if ($group !== 'action_scheduler_groups') {
                return parent::set($key, $data, $group, $expire);
            }
            self::$shared[$key] = $data;

            return true;
        }

        public function get($key, $group = 'default', $force = false, &$found = null)
        {
            if ($group !== 'action_scheduler_groups') {
                return parent::get($key, $group, $force, $found);
            }
            $found = array_key_exists($key, self::$shared);

            return $found ? self::$shared[$key] : false;
        }

        public function delete($key, $group = 'default', $deprecated = false)
        {
            if ($group !== 'action_scheduler_groups') {
                return parent::delete($key, $group, $deprecated);
            }
            $found = array_key_exists($key, self::$shared);
            unset(self::$shared[$key]);

            return $found;
        }

        public function flush_group($group)
        {
            if ($group === 'action_scheduler_groups') {
                self::$shared = [];
            }

            return parent::flush_group($group);
        }
    };
    $previous = $GLOBALS['wp_object_cache'];
    $external = wp_using_ext_object_cache(true);
    $GLOBALS['wp_object_cache'] = $cache;
    $moved = $group . '-moved-' . bin2hex(random_bytes(4));
    try {
        // Move this site's group out of the way (its actions keep their group id), as on a site no job ran on yet.
        $connection->run("UPDATE `{$p}actionscheduler_groups` SET `slug` = ? WHERE `slug` = ?", [$moved, $group]);
        delete_option('sp_jobs_prepared');
        do_action('action_scheduler_init');
        $id = $rolledBack($enqueue);
        $cached = $cache::$shared[$group] ?? null;
        $real = $cached === null || $connection->run("SELECT 1 FROM `{$p}actionscheduler_groups` WHERE `group_id` = ? AND `slug` = ?", [(int) $cached, $group]) !== [];
        $out[] = ['after a rolled-back write, the cached id of SpacePress\'s group is a committed row of that group (or absent)', [$state($id), $actions($id), $real], [null, [], true]];
        $id = $db->transaction($enqueue);
        $out[] = ['the next committed job\'s action is in SpacePress\'s group', $actions($id), ["pending $group"]];
    } finally {
        $GLOBALS['wp_object_cache'] = $previous;
        wp_using_ext_object_cache($external);
        // Put the site's own group back: the case's actions join it and the group made here goes.
        $original = $connection->run("SELECT `group_id` FROM `{$p}actionscheduler_groups` WHERE `slug` = ?", [$moved])[0]['group_id'] ?? null;
        if ($original !== null) {
            foreach ($connection->run("SELECT `group_id` FROM `{$p}actionscheduler_groups` WHERE `slug` = ?", [$group]) as $made) {
                $connection->run("UPDATE `{$p}actionscheduler_actions` SET `group_id` = ? WHERE `group_id` = ?", [(int) $original, (int) $made['group_id']]);
                $connection->run("DELETE FROM `{$p}actionscheduler_groups` WHERE `group_id` = ?", [(int) $made['group_id']]);
            }
            $connection->run("UPDATE `{$p}actionscheduler_groups` SET `slug` = ? WHERE `slug` = ?", [$group, $moved]);
        }
        wp_cache_delete($group, 'action_scheduler_groups');
    }

    // 4. A crash right after COMMIT: no commit callback runs (the first one stands for the process dying).
    $id = null;
    try {
        $db->transaction(static function () use ($enqueue, &$id): void {
            \SpacePress\Extensions::afterCommit(static fn () => throw new \RuntimeException('first test crash after commit'));
            $id = $enqueue();
        });
    } catch (\RuntimeException $e) {
        if ($e->getMessage() !== 'first test crash after commit') {
            throw $e;
        }
    }
    $out[] = ['a crash between commit and any commit callback loses no job: its action committed with it', [$state($id), $actions($id)], ['pending', ["pending $group"]]];

    // Leave nothing queued: these jobs are the cases' own.
    foreach ($queued as $id) {
        as_unschedule_all_actions('sp_job', ['id' => $id]);
        $connection->run("UPDATE `{$p}sp__jobs` SET `state` = 'dead', `dedupe` = NULL, `lastError` = 'cancelled' WHERE `id` = ?", [$id]);
    }

    return $out;
}
