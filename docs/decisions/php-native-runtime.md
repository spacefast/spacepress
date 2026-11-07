# Keep the request runtime native to PHP and share validated state

The target is a “no-Rust-or-JS in runtime version that's designed much better
and natively to PHP than 0.8” (2026-11-07). The compiler and local build tools
may use Rust and JavaScript; deployed request handling must use PHP and
WordPress. Browser scripts in the admin and identity interfaces are client code.

We keep native arrays and scalars in Db, Schema, Store, Access, Jobs and the
WordPress adapters. Compiled callbacks retain PHP object handles for JavaScript
containers, with conversion owned by Seam. We use PHP object ownership for
request-local state, pass validated objects explicitly, and load optional PHP
libraries when used. This avoids a second schema interpretation during a request
and avoids keeping discarded REST bodies alive under reusable object IDs.

Replacing every JsObject/JsArray with a PHP array would restore the aliasing and
numeric-key bugs documented in [JS references](../design-js-references.md).
TypeScript shape information does not prove that an object has no aliases.
The current [runtime contract](../runtime-contract.md) and
[class compilation](../class-compilation.md) remain authoritative. There is no
new compatibility path or runtime engine.

The focused changes, all based on #118 (`spacefast-cutover`), are:

- This change: Runtime validates schema.php once, then passes that same Schema
  to Plugin, stores and App. Constructor/boot signatures require the object;
  there is no fallback load. Tests check identity across these owners.
- [#120](https://github.com/spacefast/zero/pull/120): remove the unused vendored
  merge terminal diagnostic and omit it during dependency regeneration. Add a
  tokenizer check for direct process calls and foreign-engine class references.
- [#121](https://github.com/spacefast/zero/pull/121): defer Composer and its
  autoload-files initialization until a scoped vendor class is requested. Keep
  Composer's authoritative map for both namespaced and prefixed global classes.
- [#122](https://github.com/spacefast/zero/pull/122): replace numeric REST response
  IDs with WeakMap keys. A discarded internal response cannot supply the body
  of a later unrelated response. A WordPress behavior test reproduces the old
  failure and checks live serving and consumption.

## Audit findings and remaining work

**Generated code.** Scalars already use PHP values, boolean conditions use
native PHP, array lengths use count(), and known objects have native handle
identity. Generated code is static PHP under a stable namespace, suitable for
opcache. Ordinary PHP functions, closures, foreach and explicit service calls are
readable; Js::prop/set/add calls and class descriptor dispatch make authored
handlers harder to follow than handwritten PHP. Required object reads still go
through checked helpers. A type assertion or alias can invalidate an apparent
shape proof, so emitting unchecked property reads needs a stronger proof than a
required TypeScript field.

Keep helpers where behavior differs: PHP treats the string "0" as false,
strlen counts bytes rather than UTF-16 units, PHP integer arithmetic can exceed
JavaScript's double precision, PHP array assignments copy values, and missing
properties differ from null. Js::add deliberately rounds operands, including
exact stored IDs, before arithmetic. PHP + or concatenation is not a blanket
replacement. A future compiler optimization should begin with a narrowly proven
operation, retain the differential Node/PHP corpus, and measure a whole request.
This audit changes no compiler emission; native/host/wasm capture parity passes.

**Boot and loading.** The baseline loads schema.php in Runtime::app,
Plugin::__construct and App::boot. Reusing the validated object removes the
repeated require/validation and keeps the pipeline's metadata consistent with
registration. Opcache already shares immutable literal arrays, so this does not
save another full schema-sized allocation. The app's generated functions remain
lazy. The normal Zero autoloader performs an is_file lookup on first class use;
it neither scans the tree nor needs Composer on the host. Optional dependencies
formerly loaded eagerly even for collection reads. Their deferred loader keeps
existing namespace isolation and covers the toolkit's global class names too.

**The largest measured boot cost remains MCP initialization.** The pinned
adapter's McpComponentRegistry::has_any_projection projects every registered
tool into both supported protocol revisions during rest_api_init, including a
normal Zero REST request. One separately instrumented request attributed
128.098 ms and 62,072,880 additional live PHP bytes to McpAdapter::init (inclusive
of its callbacks). The PHP interval was 162.242 ms: its share is
128.097742 / 162.242086 × 100 = 78.95%. These diagnostic values are excluded from
the latency results below. The callback trace is in
[php-native-profile.json](../benchmarks/php-native-profile.json).

The adapter requires create_server during mcp_adapter_init and performs those
projections inside server construction. Its public API does not expose deferred
tool registration on an existing server. The next performance change should add
lazy projection to the adapter and update the pinned plugin after behavior tests.
Skipping its initialization by inspecting the incoming URL would break internal
rest_do_request calls and route discovery; replaying its lifecycle hooks would
risk duplicate servers. This audit leaves that dependency behavior intact.

**WordPress storage and hooks.** Connection shares WordPress's $wpdb connection
so core APIs and Zero stores participate in one transaction. Compiled SQL uses
mysqli prepared statements; it is not a second database connection. Post and
user writes use core APIs, SCF codecs and hooks. Rollback cleans touched post,
option and SCF caches; after-commit work belongs to the store. These are better
boundaries than a generic database facade around WordPress.

Do not put viewer-dependent rows in a shared object cache without authority,
locale and invalidation keys. Keep durable job receipts, locks and schema
versions out of transients, whose eviction cannot mean successful completion.
The current migration checks use options and database locks, not transient
leases. Schema hashing still reads the generated file per request and ledger
key verification reads information_schema; neither is the measured limiter.
Any future compiler-supplied fingerprint must preserve updates copied in without
activation and the migration refusal gates.

Post types disable rewrite rules; registering them does not flush rewrites on
every request. The REST adapter registers through WordPress and preserves its
CORS hook order. SCF field registration is eager because core REST and editor
saves need the same definitions. In the diagnostic profile its REST registration
is much cheaper than MCP; deferring it by URL is not justified by this evidence.

**Memory and correctness.** REST body ownership was a real defect: a discarded
response left a numeric key behind, and PHP immediately reused it for an
unrelated WP_REST_Response in the behavior test. WeakMap removes the entry when
the response dies and preserves one-time serving for live responses. This also
releases any captured stream state belonging to a discarded response.
The post store's readGuards currently examines password-protected posts before
pagination and may run password verification for many rows. That work scales
with the protected collection, not the requested page; it needs a separate
large-collection fixture and a policy-preserving query design. It was not the
limiter in this fixture, which contains no protected benchmark posts.

**Errors and security.** Expected HttpError and JsError values become problem
documents. Unexpected errors are logged and details require ZERO_DEBUG=1.
Streaming starts after commit, so later I/O errors cannot roll back the write.
bootstrap.php changes PHP precision and error-display settings globally; a future
cleanup should separate numeric serialization policy from site-wide diagnostics.
This audit does not broaden the debug surface or alter authorization.

A source scan of first-party and vendored PHP found no Node, Rust, wasm, V8 or
FFI execution bridge. The baseline did contain an extra shell_exec('tput cols')
in an unused vendored diagnostic, so the original “only proc_open” claim was
false for the packaged tree. After #120 the sole direct process call is
Deployment/Local.php's proc_open. Local::main requires CLI PHP before dispatch;
its process helper is private and the adapter is offline deployment tooling.
The ordinary request graph does not enter it. The tokenizer check distinguishes
global calls from database methods such as PDO::exec and ignores quoted text;
it is a source boundary check, not a proof about arbitrary dynamic calls or
other installed WordPress plugins. Vendor regeneration and the actual parser
and merger tests cover the removal. No shell-dependent formatter is retained.

## Measurement on WordPress and MariaDB

**Verdict: no measurable request latency improvement.** Both boot changes are
small relative to MCP projection. The latency ranges overlap, and the allocator's
peak remains unchanged. Keep the changes for explicit ownership, consistent
metadata and fewer dependencies loaded; do not advertise a request speedup.

Baseline: `138bfe46510c6b6d96af527ecae56e88765902b4`. The fixture is
`tests/wp/app`, built with the real compiler, containing the combined lane
schema. The original schema.php is 115,396 bytes (filesize). WordPress reports
7.1.4, PHP 8.5.12, MariaDB 11.4.13; platform plugins come from the harness pins.
Apache's opcache is enabled, JIT disabled, revalidate_freq=0; no persistent object
cache is installed. MariaDB uses the harness's tmpfs volume. Concurrency is one,
using the local HTTP connection. These are warm steady-state measurements, not
cold startup, throughput or a comparison against the retired 0.8 capsule.

The shared machine has 24 logical CPUs (nproc). Load averages were initially
2.29/2.81/3.44 (uptime); concurrent work, including local verification during the
schema run, raised the one-minute average to 7.26. Other agents' work was left
running. Alternating sides controls some drift but does not isolate the host.
The separate callback profile identifies the application-side limiter; it does
not include a CPU or network saturation claim. The generator waits for and
validates every response before issuing the next request.

Each experiment alternates baseline and candidate for five pairs. Each phase
warms ten requests and measures twenty-five. The first experiment applies only
the schema-sharing change; the second applies only the loader change. They use
the same mounted app and database. Do not add their medians together.

| Experiment | HTTP median, before → after (ms) | Range of phase medians, before / after (ms) | PHP peak used bytes, before → after | Peak allocated bytes |
| --- | --- | --- | --- | --- |
| Shared schema | 132.289 → 131.644 | 130.689–138.613 / 130.144–138.999 | 74,396,488 → 74,396,432 | 75,497,472 on both |
| Deferred vendor loader | 130.421 → 130.502 | 130.332–130.908 / 129.328–130.814 | 74,396,488 → 74,394,816 | 75,497,472 on both |

The loader's included-file median is 1,134 → 1,121: 1,134 − 1,121 = 13 fewer
files. Its used-peak difference is 74,396,488 − 74,394,816 = 1,672 bytes; the
schema difference is 56 bytes. These are PHP heap counters, not process RSS or
shared opcache memory. All allocated peaks are exactly
75,497,472 / 1,048,576 = 72 MiB. These differences do not justify a practical
memory-saving claim. Raw per-request samples and per-phase medians are committed
in [schema samples](../benchmarks/php-native-schema.json) and
[autoload samples](../benchmarks/php-native-autoload.json).

For each request, HTTP milliseconds = (perf_counter_ns after reading the complete
body − perf_counter_ns before urlopen) / 1,000,000. The test-only MU plugin records
PHP milliseconds = (hrtime at rest_pre_serve_request − hrtime at MU-plugin load)
/ 1,000,000, plus memory_get_peak_usage(false/true) and included file count.
That PHP interval excludes WordPress startup before MU plugins and final body
emission; HTTP time includes both. It does include app boot and operation work.
The table takes the median of each phase's twenty-five samples, then the median
of the five phase medians. A range is min/max of those five medians. The same
aggregation applies to memory and included-file counters.

Every response must be HTTP 200, decode as JSON, contain exactly twenty-five rows
with titles Benchmark 0 through Benchmark 24 in order, and match the first
response's SHA-256. Both experiments have zero failures. Per experiment the
validated count is 2 × 5 × (10 + 25) = 350, of which 2 × 5 × 25 = 250 are timed
samples. Both bodies hash to
`bd3abae698140ac6c634859142005d4e43c3b17b4a397e4b72c186c80265823d`.
The rows are actually read, hydrated and encoded in the measured request.

To reproduce, use an otherwise fresh fixture database and preserve runtime
snapshots outside the mounted directory. Build and start with:

```sh
cargo build --locked
target/debug/zero build tests/wp/app --quiet
export ZERO_WP_PROJECT=zero-php-native ZERO_WP_PORT=8872
tests/wp/harness.sh up --wp-content tests/wp/app/.zero/wp-content
tests/wp/harness.sh wp eval '$db = Zero\Wp\Runtime::plugin()->app()->db; for ($i = 0; $i < 25; $i++) { $db->insert("posts", ["title" => "Benchmark " . $i, "status" => "published"], true); }'
python3 tests/wp/bench-runtime.py \
  --before /tmp/baseline-Zero --after /tmp/candidate-Zero \
  --content tests/wp/app/.zero/wp-content \
  --url 'http://127.0.0.1:8872/wp-json/zero/v1/posts?limit=25&orderBy=id' \
  --output /tmp/runtime-results.json
tests/wp/harness.sh down
```

The runner installs its metrics plugin explicitly, switches only the runtime,
sets distinct old file mtimes to invalidate Apache's opcache without disabling
file caching, warms each side, and removes its metrics plugin in finally. Profiling
plugins must be removed first. Schema/loader snapshots retain all other runtime
files from the baseline. Tests additionally exercise native/host capture,
wasm/native capture, compiled callback contracts, WordPress/SQLite pipeline
behavior, and real WordPress/MariaDB REST, abilities, MCP and sync behavior.
