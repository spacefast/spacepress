# TypedPress mechanical rename

The rename starts from `b0a512b54`, the merge of the completed-work consolidation
in #504. The framework website remains in `www/`.

| Contract | Current name |
|---|---|
| Product | `TypedPress` |
| CLI, crate and public authoring module | `typedpress` |
| Project configuration | `typedpress.config.ts` |
| Authored app files | `tp/` |
| Local state | `.tp/` |
| PHP namespace | `TypedPress\` |
| Internal keys and constants | `tp_` and `TP_` |
| Public API prefix | `/__tp` |
| npm CLI and starter | `typedpress` and `create-typedpress` |
| Binary packages | `@typedpress/bin-*` |

`first_name`, collection methods, third-party originals, decision history, the
repository name and legacy Zero converter inputs. The converted browser client's
target endpoint changes to `/__tp/api/v1`.

Public submodules receive literal name changes, including `typedpress/app`,
`typedpress/content` and `typedpress:db`. The module redesign, browser islands and
`agents` API changes remain deferred in #502. The website distinguishes those
proposals from the completed rename.

Generated PHP vendors, admin and identity bundles, the WordPress catalog, builtin
registry, clients and lockfiles are rebuilt from their sources. The WASM asset
script selects `typedpress.wasm` explicitly so a cached `first.wasm` cannot be
served accidentally.

The receipt fixture retains the historical object shape and reference graph from
`b7d5989d`, with serialized class and private-property namespaces adapted and byte
lengths updated. It verifies the old shape under the new namespace, not an upgrade
of a deployed First site's database. No First-to-TypedPress storage migration is
introduced here. The existing Zero migration retains its legacy inputs.

Verification covers native and WASM compiler behavior, PHP runtime suites, CLI and
starter behavior, generated clients, admin provenance and browser behavior, the
docs site, and the website on a dedicated local WordPress instance. Local `dev`
verification syncs the Markdown content and seeds featured examples before the
website browser suite. Pressable and Spacefast qualification remain #501 and
#503. No production deployment is included.

The shorter `tp_` post-type prefix permits collection names of 17 characters
(WordPress limit 20 minus prefix length 3). Compiler and runtime share corpus
cases accepting 17 and refusing 18; the runtime limit and docs match the compiler.

The live-region browser assertion allows repeated unchanged polls before a write
completes. It still verifies the first subscription, the changed response,
retained DOM nodes and input state; slower concurrent runs can cross a poll.

Plugin fixture digests are refreshed for renamed package paths and imports while
retaining their deliberate capability restrictions. The compiler-contract registry
checks that those packages are still refused when they exceed their grants.
