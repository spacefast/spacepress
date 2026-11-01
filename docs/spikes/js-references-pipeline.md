# Reference-handle pipeline measurements

Production impact is inconclusive. On the measured warm WordPress/SQLite CLI
fixture, the median process result rose from 2.431 to 3.448 ms/request. This
measures the actual compiled action and database pipeline, including conversion
and response serialization; it does not isolate handle allocation.

The baseline is Seam extraction commit `3b73fa7d`, after the standalone target
was removed. Both sides use the same fixture and PHP 8.5.10, WordPress 7.1.4,
SQLite, and disabled CLI opcache. The shared host has 24 cores; its load averages
before the run were 11.21, 11.72, and 10.69. Five process runs per side alternated
baseline/handles. Each booted a fresh real WordPress, seeded 200 rows and one
related owner, warmed one request, then timed five rounds of 20 requests. Boot
and seeding are excluded. Every timed request invokes the compiled action,
queries all 200 rows with the owner relation and nested json() column, maps a
response, serializes it, decodes it, and verifies every returned value. Both
sides validated 505 requests, with zero errors and 25,192 bytes per response.

| Process run | Baseline median, ms/request | Handles median, ms/request |
|---|---:|---:|
| 1 | 2.946 | 3.294 |
| 2 | 2.065 | 3.448 |
| 3 | 1.982 | 3.480 |
| 4 | 2.431 | 3.231 |
| 5 | 3.144 | 3.609 |
| Median | 2.431 | 3.448 |
| Range | 1.982–3.144 | 3.231–3.609 |

Process CPU time closely tracks wall time in the raw samples, consistent with
CPU work on one process in this local fixture. No isolated profiler run or
real MySQL request profile was captured. The baseline varies substantially on
this shared machine. These runs therefore establish the observed fixture cost,
not a causal production regression or a claim that overhead is small relative
to WordPress/MySQL. No implementation choice is justified by these timings.

Raw wall/CPU samples and work counts are in
[js-references-pipeline-results.json](js-references-pipeline-results.json).

To reproduce, use separate worktrees for the baseline and switch, with their
own Cargo target directories. In each repository root:

```sh
export CARGO_TARGET_DIR="$PWD/target"
cargo build --locked
mkdir -p .zero/refs-pipeline
cp docs/spikes/js-references-pipeline.config.ts .zero/refs-pipeline/zero.config.ts
target/debug/zero build .zero/refs-pipeline --quiet
php docs/spikes/js-references-pipeline.php "$PWD/.zero/refs-pipeline/.zero/wp-content"
```

The fixture and PHP runner are introduced by the switch: copy both unchanged
into the baseline worktree before building. Alternate the last command across
worktrees five times and retain its JSON output. The runner fails immediately
on a bad status, missing row, incorrect relation, or incorrect nested JSON.

Full clean WordPress and PHP suite wall times are reported in the switch PR.
They are single suite runs, include test orchestration, and are not controlled
performance experiments.
