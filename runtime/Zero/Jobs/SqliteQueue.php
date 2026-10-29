<?php

declare(strict_types=1);

namespace Zero\Jobs;

/** Standalone: the jobs table is the queue; `zero jobs work` polls it. */
final class SqliteQueue implements Queue
{
    public function schedule(string $id, string $runAtIso): void
    {
    }
}
