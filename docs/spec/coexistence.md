# Zero 0.8 and v2 side by side

Zero 0.8 and v2 both run on Spacefast while this spec is built. A Space runs
one of them at a time, never both in the same version.

## No 0.8 code in this repository

This repository carries no Zero 0.8 code and converts nothing. Apps already
running on 0.8 keep running unchanged: Spacefast serves and publishes them with
its own 0.8 compiler and runtime. New apps start on v2. An owner who wants a
0.8 app on v2 rewrites it on v2.

## Platform rules

The platform enforces these, and the spec work keeps them true:

1. **One generation per Space and version.** A Space is `none`, `legacy_0_8` or
   `v2`. A version never mixes them. A Space never goes back from `v2`. The control plane
   (`apps/control-plane/src/versions/zero-generation.ts`) and the engine
   (`runtime/tests/zero-v2-cordon.test.ts`) enforce this.
2. **Published versions don't change.** Each version runs the runtime revision
   it was built with, so a new `main` never changes how an existing version
   serves.
3. **Nothing box-wide changes for a Space that isn't serving v2.** Hardening,
   plugin activation, rewrite rules, link filters, cache headers and markdown
   negotiation live in the v2 app plugin's request path, or behind the engine's
   `zero_generation === 'v2'` check. Static, Functions, content-model and 0.8
   Spaces see no difference.
4. **0.8's paths stay 0.8's.** `/__zero/config`, `/__zero/run`, `/__zero/auth/*`
   and `/__zero/realtime/events` keep their 0.8 meaning on 0.8 versions. v2 adds
   `/__zero/api/v1/*`, `/__zero/client.js`, `/__zero/client.d.ts` and
   `/__zero/realtime.js`, and never reuses a 0.8 path with a different meaning.
5. **A root `zero.config.ts` means v2.** The spec's `zero/` and `app/` folders
   never make a project look like 0.8, or like another framework, to the CLI or
   the build pipeline.

## Suites that hold these rules

| Rule | Suite |
|---|---|
| 1 | monorepo `apps/control-plane/src/versions/zero-generation.test.ts`, `runtime/tests/zero-v2-cordon.test.ts` |
| 2 | monorepo `runtime/tests/zero-v2-hosted.test.ts`, `zero-v2-source.test.ts` |
| 3 | monorepo `runtime/tests/zero-runtime.test.ts` (0.8), the e2e wp.cloud runtime contract |
| 4 | monorepo `runtime/tests/zero-runtime.test.ts`, `legacy-zero-users.ts` |
| 5 | monorepo `packages/cli/src/zero-v2.test.ts`, `zero-v2-source-publish.test.ts` |

These are all monorepo suites. Where a rule has no behavior test yet, the
coexistence test lane adds one.
