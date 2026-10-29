<?php

declare(strict_types=1);

namespace Zero\Jobs;

/** Per-target delivery of a queued job row: the standalone worker polls, WordPress hands it to Action Scheduler. */
interface Queue
{
    /** Called inside the dispatch/runner transaction once `id` is pending in the jobs table. */
    public function schedule(string $id, string $runAtIso): void;
}
