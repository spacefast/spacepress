# Compiler and WordPress research adoption

Reviewed on 2026-11-01. Research baseline: Zero
`3d7c3dfeb1a090a0cf484300cc2a1e33b4112ed4` (the `Ship the admin screens when the config opts in with admin: true`
commit; see Git history for the full revision). The optional admin is now emitted
when configured, and component licenses exist. Those facts supersede the earlier
research baseline. Zero's Rust compiler, pure evaluator, effect analysis,
reachable-helper emission, PHP runtime and WordPress integration remain the
foundation.

## Implemented

Field `.ui({ label, help, placeholder, width })` metadata follows the existing
immutable builder through Rust extraction and PHP schema emission. Public schema
description retains it recursively. Native SCF maps it to field settings without
changing data paths or persistent field keys. Explicit plain-text help overrides
type guidance; omitted help preserves it. Scalar config imports preserve supported
presentation metadata instead of only reporting its loss. Payload admin options
that could change behavior still fail rather than being discarded.

`zero check --json` adds a versioned diagnostics envelope, stable codes, explicit
coordinates and deterministic groups. Loader analysis collects independent
failures while refusing all partial programs. The fixture-backed compatibility
registry generates documentation and checks actual refusal codes. Intentional
runtime differences are separate from refusals and defects. This combines the
useful Barefoot and ScriptC maintenance ideas without changing Zero's language
contract or accepting runtime fallback execution.

A shared typed descriptor owns array mutation and inserted-argument facts used
by both effect propagation and alias checking. It consolidates facts that were
previously repeated; it does not replace Zero's existing effect graph.

`encodeURI`/`encodeURIComponent` accept one string in pure evaluation and compiled
handlers. PHP uses the audited ts2php reserved-character restoration approach,
with corrected component punctuation and malformed UTF-8 refusal. Pinned vectors
run against Node, the Rust evaluator and generated PHP. Notices travel with both
the runtime and copied test material. Existing differential tests require a
completed, nonempty Node case map and distinguish expected CLI application-error
exits from unexpected process failures.

`examples/recipes/zero/seo.ts` demonstrates reusable, pure field composition. It uses
existing helpers/spreads and presentation metadata, without introducing another
plugin lifecycle or changing what the config's `plugins` map means.

## Every reviewed project and its disposition

- [ts2php](https://github.com/searchfe/ts2php/tree/104b497d558d112c5b80cd370b7bcc0f43a29d51):
  adapt the small URI table and four vector inputs; retain MIT notices. Generate
  expectations from Node. Other runtime mappings were not sound enough to adopt.
- [Elephize](https://github.com/VKCOM/elephize/tree/c428ebc6cdfd6ac68ea838d41c069fd830474e93):
  adopt watcher edit/error/recovery scenarios and explicit native-boundary design
  in the follow-up requirements below. Do not adopt its emitter, rendering scope
  or dead-call elimination rules for backend effects.
- [CCXT](https://github.com/ccxt/ccxt/tree/a1bd1dd550c67db735107447b698a34a34c2efa6):
  keep handwritten runtime helpers and independent behavioral expectations. Parse
  unknown external payloads at their boundary when adding an integration. Decimal
  strings/GMP belong to an explicit commerce contract, not ordinary JS numbers.
- [Payload](https://github.com/payloadcms/payload/tree/ec351643011603cf75dc91db5d03f80ff120f1e9):
  preserve presentation independently of stored paths; improve lossless imports
  and pure config recipes. Aggregate validation has its own requirements below.
  No Node/Next runtime or UI implementation is imported.
- [BarefootJS](https://github.com/piconic-ai/barefootjs/tree/9615fb9a14e1c40e8fc02fed82042a2a139b2b9f):
  implement a limitation/evidence join, generated support documentation and
  nonempty oracle checks. Keep Zero's runtime and current explicit divergences.
- [ACF Composer](https://github.com/Log1x/acf-composer/tree/0bb270e8ffd7ff896bb22a4336bf1a2fb8986cce):
  borrow field authoring conventions and explicit precedence. Its MIT code and
  GPL ACF Builder dependency are separate license scopes; no dependency added.
- [ACF Builder](https://github.com/StoutLogic/acf-builder/tree/8dd954c89b96f862523b7e5c6f893b09eaa36334):
  independently test nested/reused field scenarios and stable keys. Do not copy
  its GPL tests onto the MIT side or silently rename persisted keys.
- [Carbon Fields](https://github.com/htmlburger/carbon-fields/tree/0aaf57b2ae946a3bac6fa5602a4d14cd8156aa5e):
  adopt the label/help/width authoring idea. Keep SCF and Zero's existing write,
  access and transaction pipeline. No GPL-2.0-only source is copied.
- [WPGraphQL](https://github.com/wp-graphql/wp-graphql/tree/01b8c3a4e230d9bff22679b620bca0e1f86956d8):
  request-scoped batching is conditional on measured repeated reads. Zero already
  primes postmeta. Any GraphQL adapter must enforce all Zero row/field access and
  mutation rules; no adapter or GPLv3 code is introduced here.
- [Gutenberg](https://github.com/WordPress/gutenberg/tree/877af6a88c1ea197aaa96226ae4299e93fd7e715):
  retain standard block metadata and asset-dependency conventions in the separate
  Blocks design/work. SCF `.blocks()` remains flexible content. Use WordPress's
  existing editor/React packages in the optional admin.
- [Playground/wp-env](https://github.com/WordPress/wordpress-playground/tree/a4dbcd0bf65a82e10a5d3821f5023aeee81097e6):
  acquisition/install/checksum conventions already exist in Zero. The useful new
  surface is reproducible demo export; retain real-MySQL verification.
- [Acorn](https://github.com/roots/acorn/tree/5417cfde2cc315038a7dff5bf15e7d457fc8aae1):
  require contextual missing-dependency errors and coexistence with another
  plugin's exception handling. Do not add Laravel/container/provider discovery.
  Sage was context for this review, not another complete source audit.
- [ScriptC](https://github.com/vercel-labs/scriptc/tree/94f4df20931d3e90355f52dd2d9bdbec6fb4d8fc):
  port diagnostics/grouping, explicit builtin facts and honest test-outcome ideas
  to Rust. Typed PHP adapters and cache verification follow below. Its native/WASM
  backend, C runtime, GC contracts and Node islands solve different target needs.
  No Apache-2.0 implementation or separately licensed Test262 source is copied.

## Follow-up implementation requirements

These are separate features, not functionality claimed by this PR.

A development watcher should begin with debounced full rebuilds over discovered
local modules, include missing-import candidates for recovery, and ignore all
emitted artifacts. Test edits, new/deleted imports, syntax/type errors, recovery,
annotation-only changes and source changes during a build. Keep the last valid
artifact. Decide migration generation explicitly before rebuilding schema edits
on every save. WordPress's Docker harness bind-mounts the plugins directory;
replacing its parent tree can leave the container on an old inode. Publication
and remount behavior must be proven together before adding `zero dev --watch`.
The integration lane now builds a fresh disposable source copy before staging
that artifact, preventing stale ignored migrations from changing its initial
ledger. Existing fixture migration files are preserved.

Aggregate validation must preserve the existing first error's code/pointer and
add optional structured errors. Collect only independent built-in shape/type/rule
failures. Authorization, application hooks and custom validators retain their
current order and fail-fast behavior; never execute additional effectful callbacks
to populate an error array. Prove rollback and field redaction remain correct.

Registered PHP capabilities need one real integration first. Define versioned TS
signatures, PHP symbols, availability/plugin requirements and effect metadata;
validate declarations against the actual binding and fingerprint the exact loaded
bytes. Effects run only in compiled runtime handlers. Runtime Extensions and
pinned plugin artifacts already exist. Arbitrary PHP imports, Node islands and
build-time native execution are outside the proposal.

A Playground exporter should consume the already-built WordPress artifact and
its pinned manifest. Specify portable plugin resources, checksums and required
platform versions, then prove a clean demo boots with the same schema. Local
filesystem URLs cannot masquerade as shareable resources. Keep arbitrary Blueprint
execution outside pure evaluation and keep Docker/MySQL as the storage oracle.

Add independent standards fixtures only where Zero's contract agrees with their
premises. Pin provenance, distinguish native PHP results from fallback execution,
classify compiler/harness/runtime failures, bound child processes and require
completion. Preserve NaN/signed-zero comparison behavior. The existing parity
suite already normalizes undefined/null and adapts astral-string indexing.

Persistent compiler caches follow a working watcher and a profile establishing
benefit. Include compiler/runtime/config/target/transitive input identity, verify
cached bytes, exclude generated outputs and install atomically. Compare full
per-case results, diagnostics and emitted artifacts between uncached and warm
runs. Plugin-download caching is already implemented. Validate any future
serialized lowered IR at the load boundary and reject corrupted fixtures; do not
rewrite the compiler solely to manufacture that boundary.

## Provenance and checks

The only externally adapted implementation in this change is the MIT ts2php URI
table plus four vector inputs. Exact revision/file links and notices are in
`runtime/Zero/URI-ENCODING-NOTICE.txt` and `tests/differential/URI-NOTICE.txt`.
Other changes are original implementations of the design lessons. Upstream test
suites and performance benchmarks were not run; no comparative speed or conformance
percentage is claimed.

Run the repository checks in `CONTRIBUTING.md`. The focused evidence is
`cargo test --test compiler_contracts`, `cargo test --test config_migrate`,
`cargo test --test compiler compiled_php_matches_node_on_every_differential_case`,
`tsc -p types/zero/tests` and `python3 scripts/compiler-contracts.py --check`.
