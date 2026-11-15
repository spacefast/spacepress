# Use native access for stable PHP object parameters

Required constant-key reads from a non-null PHP `JsObject` parameter use
`($input->p['field'] ?? Js::dataGet($input, 'field'))`: a present non-null value
skips the helper, and an absent or null key keeps the checked read's result. Writes to that same proven receiver use native
array assignment after capturing the receiver and key. A TypeScript object shape
alone is insufficient: the emitted function signature must enforce `JsObject`,
the parameter must have no default initializer, and the completed effects analysis
must show no assignment to its binding, including from captured closures.

Reads also take the native-first form when the receiver is any local or parameter that the
effects analysis shows no assignment replaces, read as a plain PHP variable, and every shape its
type allows is a plain object: `$x->p['k'] ?? Js::dataGet($x, 'k')`. No PHP entry type is needed
for this: when `$x` is null, undefined or a primitive, `??` reads the missing property without a
diagnostic and falls to the checked read, which then throws or answers exactly as before. Only a
`JsObject`, `JsArray` or `JsArguments` has a public `p`, and an array-typed receiver keeps the
checked read (its `length` and indexes live outside `p`). The left side is evaluated once even
when it is null (PHP 8.2 and 8.5).

The compiler records this proof on the binding, independently of its inferred
field types. It recognizes direct identifier receivers, including their use in
captured closures. Other locals, assertions, nullable parameters, dynamic reads,
optional fields, computed reads and class statics retain the checked helpers.
Rebinding a parameter through a closure disables the optimization for its whole
body. Destructuring retains its existing emission. No wrapper or alternate
runtime representation is introduced.

The native read keeps the helper's null-coalescing behavior for a missing own
property. It cannot encounter a nullish receiver because PHP enforces the entry
type and the binding cannot be replaced. PHP object handles preserve aliases;
this does not introduce PHP array copy-on-write semantics for authored objects.

Writes retain receiver-before-key-before-value evaluation, including expression
position through the existing sequencing array. The internal write target uses
an enum for checked objects, proven objects, arrays and dynamic values. Compound
writes and updates still snapshot property presence with `Js::has`. A missing
numeric property must become NaN, while a present null may become zero; native
assignment alone must not erase that distinction. `Js::plus`, `Js::add`, array
index checks and class static dispatch remain where their semantics differ.

For example, a proven parameter read changes from
`Js::dataGet($input, 'title')` to
`($input->p['title'] ?? Js::dataGet($input, 'title'))`. A captured write
changes from `Js::set($receiver, $key, $value)` to
`($receiver->p[$key] = $value)`. General numeric addition remains on its helper:
the TypeScript `number` type proves neither a safe integer range nor the absence
of negative zero or non-finite values. Stored exact integers beyond JavaScript's
precision boundary must still round before arithmetic.

The differential Node/PHP corpus now explicitly covers proven reads/writes,
alias mutation, missing required properties, compound updates, values at the
integer precision boundary, reassignment through a closure and nullable inputs.
It checks the emitted native paths and retained checked paths as well as observable
results. Existing class and reference cases remain guards. Native/host capture
and wasm capture parity exercise the same compiler, with no target-specific
optimization flag or output format.

## Representative output and whole request measurement

The real tests/wp app includes a small public action, `nativeHandler`, which
trims a required title, increments a required count and returns those two fields.
This exercises native reads, writes and a compound assignment through the normal
WordPress action endpoint. Its behavior is also an HTTP integration test.

Count literal helper call spellings in the generated `zero/app/functions.php`
with `text.count('\\Zero\\Js::prop(')` (and the corresponding set/add spellings).
The same fixture source compiled before and after gives:

| Generated output | Before | After |
| --- | ---: | ---: |
| Js::prop call sites | 172 | 56 |
| Js::set call sites | 10 | 1 |
| Js::add call sites | 7 | 7 |
| functions.php bytes (`len(read_bytes())`) | 25,911 | 25,482 |

These are static call sites and file bytes, not executed call counts or a latency
claim. The schema.php files are byte-identical (`cmp`); only generated handlers
change. Runtime container ownership and the external API remain the same.

The unchanged runtime is `138bfe46510c6b6d96af527ecae56e88765902b4`, with the
lazy MCP adapter from #124 held constant. Before/after app trees are built from
the exact same fixture source with the baseline and candidate compilers. The
real disposable tests/wp harness runs Apache, WordPress 7.1.4, PHP 8.5.12 and
MariaDB 11.4.13 on tmpfs, opcache on (`revalidate_freq=0`), JIT off, without a
persistent object cache. At concurrency one, POST the checked-in input fixture
to `/wp-json/zero/v1/actions/nativeHandler`; every response must be HTTP 200 and
exactly the checked-in response fixture, with one identical SHA-256 across both
sides.

`bench-runtime.py` alternates baseline then candidate for five pairs, with ten
warmups and 25 timed requests per phase: `2 × 5 × (10 + 25) = 350` validated,
`2 × 5 × 25 = 250` timed, zero errors. HTTP ms is
`(perf_counter_ns_after_body - perf_counter_ns_before_open) / 1e6`; PHP ms is
`(hrtime_at_rest_pre_serve_request - hrtime_at_MU_load) / 1e6`. Peak memory is
`memory_get_peak_usage(false/true)` in bytes. No profiler runs; distinct old PHP
mtimes invalidate opcache without triggering its new-file exclusion. Report the
median of five phase medians, with their min–max in parentheses. Raw samples:
[php-native-handlers.json](../benchmarks/php-native-handlers.json).

| Metric | Before | After |
| --- | ---: | ---: |
| HTTP ms | 40.437 (40.103–40.951) | 40.519 (39.025–42.618) |
| PHP ms | 36.514 (36.202–36.970) | 36.708 (35.281–38.098) |
| Peak used bytes | 37,507,008 | 37,507,008 |
| Peak allocated bytes | 39,845,888 | 39,845,888 |
| Included files | 1,127 | 1,127 |

The observed HTTP difference is `40.519107 - 40.436670 = 0.082437 ms`, or
`0.082437 / 40.436670 × 100 = 0.20%`. The phase ranges overlap and memory is
unchanged, so this experiment demonstrates no whole-request latency improvement.
This narrow change improves generated access without claiming a request speedup.
These are warm requests, not cold startup or throughput. The shared host reports
24 logical CPUs (`nproc`); one-minute load was 2.54 before and 3.27 after. No local
compilation or verification overlapped timing; other agents remained running.

Build the fixture twice with the baseline and candidate compiler, preserving the
same source. Hold the runtime and lazy adapter unchanged, then run:

```sh
ZERO_WP_PROJECT=zero-php-native ZERO_WP_PORT=8872 \
python3 tests/wp/bench-runtime.py \
  --before /tmp/zero-native-runtime-base --after /tmp/zero-native-runtime-base \
  --app-before /tmp/zero-native-app-before --app-after /tmp/zero-native-app-after \
  --app-slug zero-app-blog --content /tmp/zero-native-content \
  --url http://127.0.0.1:8872/wp-json/zero/v1/actions/nativeHandler \
  --body tests/wp/fixtures/native-handler-input.json \
  --expected tests/wp/fixtures/native-handler-response.json \
  --output docs/benchmarks/php-native-handlers.json
```

Validation covers the 199-case differential Node/PHP oracle, compiler contracts,
native/host capture, wasm/native byte parity and the real HTTP action. The shared
fixture's abilities and runtime suites pass together. Formatting and all-target
Clippy pass too.
