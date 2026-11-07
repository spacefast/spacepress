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
validation still happen at registration. Each list and call retains the adapter's
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
| HTTP ms | 133.723 (131.494–141.367) | 40.837 (40.446–41.553) |
| PHP ms | 129.077 (127.219–136.517) | 37.167 (36.340–37.566) |
| Peak used bytes | 74,396,488 | 37,568,320 |
| Peak allocated bytes | 75,497,472 | 44,040,192 |
| Included files | 1,134 | 1,127 |

HTTP reduction is `(133.723067 - 40.836618) / 133.723067 × 100 = 69.46%`.
Peak used reduction is `74,396,488 - 37,568,320 = 36,828,168` bytes, or
`36,828,168 / 1,048,576 = 35.12 MiB`. Allocator reduction is
`(75,497,472 - 44,040,192) / 1,048,576 = 30 MiB`. This is warm request latency,
not cold startup, throughput, or a comparison against 0.8. On the shared host,
`nproc` reports 24 logical CPUs; one-minute load was 2.48 before and 2.97 after.
A local Rust test compilation overlapped part of the run. Alternation limits
drift, but does not isolate the host. The phase ranges remain clearly separated.

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
