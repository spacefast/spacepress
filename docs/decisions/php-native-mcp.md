# Project MCP components when the negotiated revision uses them

Ordinary collection requests register MCP routes, but must not construct protocol
records for every tool and every supported revision. Zero applies a deterministic
build-time patch to the verified MCP Adapter 0.7.1 platform archive. Registration
keeps neutral components; the adapter's existing list and call handlers project
and validate them against the selected revision. Invalid projections remain
unavailable. Authentication, permissions, transport, routing and execution stay
with the adapter.

## Dependency ownership

`src/platform.rs`, `runtime/Zero/Wp/Platform.php` and
`tests/fixtures/platform.json` pin the upstream WordPress.org ZIP to SHA-256
`719d81aa1250615acfd8256f0acc8c13f1712f1ae398c3d5883c8b166024fe9b`.
`Prepared::acquire` verifies that archive, extracts it privately, applies the
patch, then computes the installed tree digest. The plugin lock and deployment
manifest retain both the original archive checksum and the patched tree checksum.
Repeat builds still reject local changes using the previous installed digest.
There is no request-time patcher or process invocation.

The patch is maintained in this spacefast repository. It applies only to this
exact slug, version and verified archive; a registry source checksum and unique
replacement checks fail closed on drift. Other explicitly selected archives are
left intact. Repinning the platform requires reviewing whether this patch is
still needed. Source-only hosts own their platform installation and must install
this patched platform tree to obtain this optimization; emitted application PHP
and capture parity do not change. The original upstream archive remains cached.

The pinned adapter requires `create_server` inside `mcp_adapter_init`. Server
construction immediately registers components. Its public API has no deferred
component registration hook on a server. Moving Zero's callback to a later hook
violates that timing contract; skipping initialization by URL breaks internal
`rest_do_request` and route discovery. Replaying initialization also risks other
plugins' servers. Therefore Zero ships a patched copy through its existing
assembler instead of manipulating the adapter's lifecycle or private state at
runtime. No upstream PR or repository is required.

The behavioral change for adapter diagnostics is deliberate: registration counts
describe neutral components, including ones rejected by every revision. Projection
errors become available when a revision first uses the component, rather than
logging during unrelated requests. Duplicate detection and missing-ability
validation still happen at registration. On a name/URI collision, the existing
component is checked across revisions: one invalid in every revision cannot
reserve the key against a later valid registration. This preserves eager
registration's duplicate precedence while keeping unique registrations neutral.
Each list and call retains the adapter's
revision-specific availability check, including when a client calls without
listing first.

## Measurement

The real `tests/wp/app` fixture runs on the disposable `tests/wp` Apache/WordPress
7.1.4, PHP 8.5.12 and MariaDB 11.4.13 harness. Opcache is enabled with
`revalidate_freq=0`, JIT disabled, no persistent object cache, database on tmpfs.
The runtime is unchanged from `138bfe46510c6b6d96af527ecae56e88765902b4` on
both sides. Only the adapter tree changes. The fixture contains 25 published
posts titled `Benchmark 0` through `Benchmark 24`, read anonymously with
`GET /wp-json/zero/v1/posts?limit=25&orderBy=id` at concurrency one.

`tests/wp/bench-runtime.py` alternates baseline then candidate for five pairs.
Each phase warms ten requests and measures 25: 2 × 5 × (10 + 25) = 350 validated
requests, of which 2 × 5 × 25 = 250 are timed. It validates HTTP 200, exactly 25
ordered titles and one identical response SHA-256 across both sides. HTTP time is
`(perf_counter_ns_after_body - perf_counter_ns_before_open) / 1e6` milliseconds.
The test-only MU plugin measures PHP from its load to `rest_pre_serve_request`
with `(hrtime_end - hrtime_start) / 1e6`, and reads `memory_get_peak_usage()` and
`memory_get_peak_usage(true)` in bytes. Profilers are absent. Distinct old file
mtimes invalidate opcache between snapshots without its new-file exclusion.

Report the median of the five phase medians; the range is their min–max. Raw
samples are in [php-native-mcp.json](../benchmarks/php-native-mcp.json).

| Metric | Before | After |
| --- | ---: | ---: |
| HTTP ms | 132.698 (132.355–135.241) | 41.948 (40.920–42.171) |
| PHP ms | 128.333 (127.555–129.921) | 37.920 (37.122–38.240) |
| Peak used bytes | 74,398,992 | 37,570,824 |
| Peak allocated bytes | 75,497,472 | 44,040,192 |
| Included files | 1,134 | 1,127 |

HTTP reduction is `(132.698337 - 41.947936) / 132.698337 × 100 = 68.39%`.
Peak used reduction is `74,398,992 - 37,570,824 = 36,828,168` bytes, or
`36,828,168 / 1,048,576 = 35.12 MiB`. Allocator reduction is
`(75,497,472 - 44,040,192) / 1,048,576 = 30 MiB`. This is warm request latency,
not cold startup, throughput, or a comparison against 0.8. On the shared host,
`nproc` reports 24 logical CPUs; one-minute load was 2.69 during and 2.96 after.
No local compilation or verification overlapped the refreshed run, which includes
the duplicate-precedence correction. Other agents remained running. Alternation
limits drift but does not isolate the host; the phase ranges remain separated.


## MCP init share (separate diagnostic experiment)

The latency table above remains uninstrumented. A second run uses the same
alternating method as #123: five baseline/candidate pairs, ten warmups and
25 timed requests per phase, concurrency one, the same original app/runtime and
25 public posts, with only the adapter swapped. It validates
`2 × 5 × (10 + 25) = 350` responses, `2 × 5 × 25 = 250` timed, zero errors.
The opt-in test probe wraps only the existing `McpAdapter::init` callback at
`rest_api_init`; it includes that callback's server-registration callbacks.
Nothing changes the production hook lifecycle.

Per request, MCP ms is `(hrtime_after_init - hrtime_before_init) / 1e6`, live
bytes are `memory_get_usage_after_init - memory_get_usage_before_init`, and
MCP's PHP interval share is `mcp_init_ms / php_ms × 100`. PHP ms retains the
MU-plugin-load to rest_pre_serve_request interval defined above. Each reported
value is the median of the five phase medians, including the per-request share;
parentheses give their min–max. Ratios of separately aggregated medians need not
equal the aggregated per-request ratios. Raw samples and all columns are in
[php-native-mcp-profile.json](../benchmarks/php-native-mcp-profile.json).

| Diagnostic metric | Before | After |
| --- | ---: | ---: |
| MCP init ms | 102.486 (101.551–108.927) | 12.766 (12.690–12.805) |
| MCP share of PHP interval, % | 80.264 (79.581–81.017) | 34.672 (33.964–34.888) |
| MCP additional live bytes | 62,072,824 | 25,244,656 |
| Instrumented PHP ms | 129.253 (127.342–136.315) | 37.002 (36.665–38.142) |

The init duration reduction is
`(102.485522 - 12.766133) / 102.485522 × 100 = 87.54%`. The share change is
`80.264296 - 34.672134 = 45.592162` percentage points. The retained live-byte
reduction is `62,072,824 - 25,244,656 = 36,828,168` bytes, or
`36,828,168 / 1,048,576 = 35.12 MiB`. This live delta is not a peak or RSS.
The diagnostic HTTP medians are intentionally excluded from the uninstrumented
latency claim. The shared host's one-minute load was 5.13 before and 3.94 after;
no local compilation or verification overlapped this run. As with #123, the
probe attributes work but does not isolate the host or claim throughput.

Reproduce this diagnostic with the collection command below, adding
`--mcp-profile` and writing to `docs/benchmarks/php-native-mcp-profile.json`.
The runner installs the alternate probe only for that diagnostic and removes
it in `finally`; the ordinary command still uses the uninstrumented probe.

## Generated output freshness

Rebuild every example with committed plugin locks using this PR's compiler:
`site`, `blog`, `pantry`, `full-site` and `wp-plugins`. The verified upstream MCP
ZIP hash stays unchanged; each installed tree hash changes to the patched tree.
The sweep also refreshes the existing stale full-site generated client and its
JavaScript/declaration outputs. A second build of all those examples produces
no tracked or untracked changes relative to the staged generated outputs.

Reproduce by building a fresh fixture as in `tests/wp/run.sh`, staging its
wp-content to a stable directory, and starting a uniquely named harness. Snapshot
the unpatched adapter from the verified ZIP and the patched adapter from the
build output, plus one unchanged runtime snapshot. Seed the 25 posts before
running other integration tests. Run:

```sh
ZERO_WP_PROJECT=zero-php-native ZERO_WP_PORT=8872 \
python3 tests/wp/bench-runtime.py \
  --before /tmp/zero-native-runtime-base --after /tmp/zero-native-runtime-base \
  --adapter-before /tmp/zero-native-mcp-before \
  --adapter-after /tmp/zero-native-mcp-after \
  --content /tmp/zero-native-content \
  --url 'http://127.0.0.1:8872/wp-json/zero/v1/posts?limit=25&orderBy=id' \
  --output docs/benchmarks/php-native-mcp.json
```

The artifact tests exercise real acquisition and repeat installation. The MCP
fixture checks zero projections after registration and route discovery, internal
REST initialization, and valid/invalid tools in both revisions. The existing
HTTP abilities suite covers tool discovery, calls, hidden abilities and forbidden
writes. These tests use the actual patched adapter, not a replacement transport.
