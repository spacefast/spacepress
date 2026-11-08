# Zero 0.8 and v2 side by side

Zero 0.8 and v2 both run on Spacefast while this spec is built. A Space runs
one of them at a time, never both in the same version. Every workstream in
[build-plan.md](build-plan.md) keeps the rules below. A PR that breaks one is
not ready to merge, whatever else it does.

## Rules

1. **One generation per Space and version.** A Space is `none`, `legacy_0_8` or
   `v2` (`zero_generation` on the Space and on each version). A version never
   mixes the two. A `legacy_0_8` Space moves to `v2` only by making a migrated
   version live, and never moves back. Already enforced by the control plane
   (`apps/control-plane/src/versions/zero-generation.ts`) and the engine
   (`runtime/tests/zero-v2-cordon.test.ts`). The spec work doesn't change it.
2. **Published versions don't change.** Each version runs the runtime it was
   built with, from the build store. A new runtime never changes how an
   existing version serves.
3. **Nothing box-wide changes for a Space that isn't serving v2.** Hardening,
   plugin activation, rewrite rules, link filters, cache headers and markdown
   negotiation from this spec live in the v2 app plugin's request path, or
   behind the engine's `zero_generation === 'v2'` check. Static, Functions,
   content-model and 0.8 Spaces see no difference.
4. **The 0.8 converter always targets the current v2 surface.**
   `zero migrate app --from zero-0.8` (`src/config_migrate/`) emits code that
   compiles on current `main`. A PR that changes an authoring API, a route or a
   generated file that the converter emits or calls updates the converter in
   the same PR. That includes the 0.8 client bridge, which calls
   `/wp-json/zero/v1/actions/<name>` today.
5. **0.8's paths stay 0.8's.** `/__zero/config`, `/__zero/run`,
   `/__zero/auth/*` and `/__zero/realtime/events` keep their 0.8 meaning on 0.8
   versions. v2 adds `/__zero/api/v1/*`, `/__zero/client.js`,
   `/__zero/client.d.ts` and `/__zero/realtime.js`, and never reuses a 0.8 path
   with a different meaning.
6. **Adopted 0.8 tables are data, not schema to tidy.** A migrated Space's
   adopted tables (`-- zero-adopt`, `tables: "adopt"`) are never altered or
   dropped by the deploy-time schema check without an explicit `--drop`.
7. **Project detection stays unambiguous.** A project with `zero.config.ts` at
   its root is v2. The spec's `zero/` and `app/` folders never make a project
   look like 0.8, or like another framework, to the CLI or the build pipeline.

## Suites that hold these rules

Every workstream PR keeps these green:

| Rule | Suite |
|---|---|
| 1 | monorepo `apps/control-plane/src/versions/zero-generation.test.ts`, `runtime/tests/zero-v2-cordon.test.ts` |
| 2 | monorepo `runtime/tests/zero-v2-hosted.test.ts`, `zero-v2-source.test.ts` |
| 3 | monorepo `runtime/tests/zero-runtime.test.ts` (0.8), the e2e wp.cloud runtime contract |
| 4 | zero `tests/app_migrate.rs`, `tests/config_migrate.rs`, CI lanes "Zero 0.8 census tool" and "Zero 0.8 site, app-user and application migrations" |
| 5 | monorepo `runtime/tests/zero-runtime.test.ts`, `legacy-zero-users.ts` |
| 6 | zero CI lane "Spacefast cross-prefix migration and session continuity" |
| 7 | monorepo `packages/cli/src/zero-v2.test.ts`, `zero-v2-source-publish.test.ts` |

Where a rule has no behavior test yet, the coexistence workstream adds one
before the workstream that could break it merges.
