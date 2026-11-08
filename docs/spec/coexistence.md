# Zero 0.8 and v2 side by side

Zero 0.8 and v2 both run on Spacefast while this spec is built. A Space runs
one of them at a time, never both in the same version.

## 0.8 support lives in zero-v0, not here

This repository's `main` drops Zero 0.8 code and any compatibility with it.
The code still on `main` is deleted by workstream 1's first PR; until then it is
unmaintained, and nothing new depends on it. Everything that reads or converts
0.8 apps is frozen on the `v0` branch, cut from `main` at `43d695e9`. That covers:

- the converter (`zero migrate app --from zero-0.8`);
- the runtime that adopts 0.8 tables, users and sessions (`runtime/Zero/Wp/Legacy/`);
- the 0.8 census;
- their tests and docs.

The `v0` branch builds the `zero-v0` binary and WebAssembly module. Spacefast's
CLI uses `zero-v0` for one thing: converting a 0.8 app when its owner publishes
it. The converted version is compiled by `zero-v0`, and it runs `zero-v0`'s
runtime revision from the build store.

Fixes to `v0` are for live 0.8 Spaces only. Nothing on `main` waits for `v0`,
and `main` never needs to stay compatible with what `v0` produces.

## Platform rules

The platform enforces these, and the spec work keeps them true:

1. **One generation per Space and version.** A Space is `none`, `legacy_0_8` or
   `v2`. A version never mixes them. A `legacy_0_8` Space moves to `v2` only by
   making a converted version live, and it never moves back. The control plane
   (`apps/control-plane/src/versions/zero-generation.ts`) and the engine
   (`runtime/tests/zero-v2-cordon.test.ts`) enforce this.
2. **Published versions don't change.** Each version runs the runtime revision
   it was built with, so a new `main` never changes how an existing version
   serves, including versions built by `zero-v0`.
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
