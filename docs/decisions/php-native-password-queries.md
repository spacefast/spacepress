# Apply anonymous post-password visibility in the query

Anonymous reads use a store-owned SQL predicate over accepted post passwords,
before limit, offset, relation matching and partitioned pagination. A request
without a valid post-password cookie performs no protected-post inventory or
post-cache priming. A bound `SELECT 1 … LIMIT 1` probe determines whether the
predicate can hide any row. If none exists, the store returns no guard, retaining
unrestricted visibility for unique-write checks and native list controllers.
It does not enumerate readable IDs to prove that absence. A scoped native REST password contributes only to its own
collection and explicit viewer. A valid WordPress cookie is verified against
distinct byte-valued passwords instead of against every protected row.

`SqlPredicate` is an internal store policy, separate from author/query filter
arrays. Only the store supplies SQL; values bind as parameters and Sql supplies
the current source alias. User filters cannot inject predicates. The same guard
compiler is used for the root query, relation EXISTS and translation-group
queries. Filtering after a page is read would produce short pages, wrong offsets,
incorrect totals and relation leaks, so it is not an acceptable optimization.

## Policy and bounds

WordPress treats exactly the empty string and `"0"` as public passwords. `HEX`
compares all other passwords byte for byte on MariaDB/MySQL and WordPress's SQLite
translator. Ordinary text equality is unsafe here: the site's collation can fold
case and pad trailing spaces. This also fixes the old inventory query's treatment
of `"0 "` on MariaDB. The database still inspects candidate rows; no claim of a
password index or constant database work is made.

Signed-in readers retain per-post `user_can(viewer, 'edit_post', id)` and the
existing failed-post-lookup refusal. WordPress capability filters can make that
answer depend on arbitrary row-specific PHP code. Replacing it with a role test
or only Zero's update rule would change the policy. That path still inventories
protected posts, but verifies each distinct password once. Its capability cost
remains proportional to the protected inventory. This change removes the
unnecessary whole-collection PHP cost from anonymous reads; it does not claim
to solve arbitrary capability-filter evaluation or a cookie covering many unique
passwords. Cookie validation must still try each distinct protected password
because WordPress stores the proof as a one-way hash.

Viewer/proof cache keys and CoreAccess invalidation are retained. Anonymous SQL
reads no longer depend on a preliminary WP post-cache lookup. A failed unrelated
cache lookup cannot reveal a protected row: the actual query still excludes it.
Editor reads continue to fail closed when that lookup is required and fails.

## Measurement

Use the real `tests/wp/app` on the disposable Apache/WordPress 7.1.4, PHP 8.5.12,
MariaDB 11.4.13 harness, opcache on (`revalidate_freq=0`), JIT off, no persistent
object cache, MariaDB on tmpfs. The lazy MCP adapter from #124 is held unchanged
on both sides to expose the next limiter. Runtime before is
`138bfe46510c6b6d96af527ecae56e88765902b4`; after adds this query change only.

`tests/wp/fixtures/protected-collection.php` inserts 100 or 10,000 published
protected posts with one shared password, followed by 25 published public posts
titled `Benchmark 0` through `Benchmark 24`. The earlier protected IDs ensure
the query cannot obtain its public page by stopping at the first 25 rows.
Read anonymously without a cookie at concurrency one:
`GET /wp-json/zero/v1/posts?limit=25&orderBy=id`.

For each size, bench-runtime.py alternates baseline then candidate for five
pairs. Each phase has ten warmups followed by 25 timed requests. Thus each size
has `2 × 5 × (10 + 25) = 350` validated responses and `2 × 5 × 25 = 250` timed
responses; both sizes total 700 validated, 500 timed, zero errors. Each response
must be HTTP 200 with exactly the 25 public titles in order and an identical
SHA-256 on both sides within that fixture. No profiler runs during timing.

HTTP ms is `(perf_counter_ns_after_body - perf_counter_ns_before_open) / 1e6`.
PHP ms is `(hrtime_at_rest_pre_serve_request - hrtime_at_MU_load) / 1e6`.
Peak used/allocated are `memory_get_peak_usage(false/true)` in bytes. Each table
entry is the median of five phase medians; parentheses show their min–max.
Raw samples: [100 protected](../benchmarks/php-native-password-100.json) and
[10,000 protected](../benchmarks/php-native-password-10000.json).

| Protected rows | Before HTTP ms | After HTTP ms | Before / after peak used bytes |
| ---: | ---: | ---: | ---: |
| 100 | 43.039 (41.733–44.953) | 41.932 (41.316–42.395) | 37,770,600 / 37,571,720 |
| 10,000 | 93.786 (92.941–100.938) | 45.625 (44.634–48.243) | 65,169,144 / 37,571,720 |

| Protected rows | Before PHP ms | After PHP ms | Before / after peak allocated bytes |
| ---: | ---: | ---: | ---: |
| 100 | 38.766 (38.060–40.919) | 38.163 (37.634–38.232) | 39,845,888 / 39,845,888 |
| 10,000 | 89.282 (88.898–96.995) | 41.523 (40.919–43.458) | 67,108,864 / 41,943,040 |

Increasing the protected inventory by `10,000 - 100 = 9,900` rows adds
`93.786072 - 43.039361 = 50.746711 ms` before versus
`45.625079 - 41.932287 = 3.692792 ms` after. At 10,000 rows the HTTP reduction is
`(93.786072 - 45.625079) / 93.786072 × 100 = 51.35%`. Peak used reduction is
`65,169,144 - 37,571,720 = 27,597,424 bytes`, or
`27,597,424 / 1,048,576 = 26.32 MiB`. At 100 rows the ranges overlap; do not
claim a latency win for small inventories. These are warm request measurements,
not throughput or cold startup. The shared host reports 24 logical CPUs via
`nproc`; one-minute load was 2.96 before and 2.54 after the runs. No local
compilation or verification ran during these refreshed measurements, which include
the unrestricted-visibility existence probe; other agents were left running.

Reproduction uses the snapshot runner from #124, with runtime snapshots instead
of adapter snapshots. Build and start the fixture as in tests/wp/run.sh. Copy
the setup fixture to `/tmp/protected-collection.php` in the CLI container and run
`compose exec -T -e ZERO_PROTECTED_BENCH=1 cli wp eval-file /tmp/protected-collection.php 10000`
through harness.sh. Repeat with 100. For each size run:

```sh
ZERO_WP_PROJECT=zero-php-native ZERO_WP_PORT=8872 \
python3 tests/wp/bench-runtime.py \
  --before /tmp/zero-native-runtime-base --after /tmp/zero-native-password-after \
  --content /tmp/zero-native-content \
  --url 'http://127.0.0.1:8872/wp-json/zero/v1/posts?limit=25&orderBy=id' \
  --output docs/benchmarks/php-native-password-10000.json
```

PHP behavior tests cover pagination, hidden relation attachments and filters,
explicit viewers, scoped/nested REST proofs, cookies, native writes and failed
lookups. The MariaDB core-access test also checks counts, native pagination and
case/trailing-space proof mismatches. The forty-row test verifies that anonymous
pagination never primes an unrelated protected post in WordPress's object cache.
