# Zero 0.8 and v2 side by side

Zero 0.8 and v2 both run on Spacefast while this spec is built. A Space runs
one of them at a time, never both in the same version.

## Migration is opt-in and one command

- **Apps already on 0.8** keep running and publishing as 0.8. Nothing converts
  them without the owner asking.
- **When the owner asks,** one command moves the app to v2:
  `zero migrate app --from zero-0.8`, which the Spacefast CLI and MCP also expose.
  It converts the app to the current v2 surface and adopts the Space's existing
  tables, users and sessions, so no data is lost.
- **New apps** start on v2.

So the converter always targets `main`. A PR that changes an authoring API, a
route or a generated file that the converter emits or calls updates the
converter in the same PR. That includes the 0.8 client bridge, adopted tables
and the session upgrade.

## Platform rules

The platform enforces these, and the spec work keeps them true:

1. **One generation per Space and version.** A Space is `none`, `legacy_0_8` or
   `v2`. A version never mixes them. A `legacy_0_8` Space moves to `v2` only when
   a migrated version goes live, and never moves back. The control plane
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
5. **Adopted 0.8 tables are data, not schema to tidy.** The deploy-time schema
   check never alters or drops them without an explicit `--drop`.
6. **A root `zero.config.ts` means v2.** The spec's `zero/` and `app/` folders
   never make a project look like 0.8, or like another framework, to the CLI or
   the build pipeline.

## Suites that hold these rules

| Rule | Suite |
|---|---|
| 1 | monorepo `apps/control-plane/src/versions/zero-generation.test.ts`, `runtime/tests/zero-v2-cordon.test.ts` |
| 2 | monorepo `runtime/tests/zero-v2-hosted.test.ts`, `zero-v2-source.test.ts` |
| 3 | monorepo `runtime/tests/zero-runtime.test.ts` (0.8), the e2e wp.cloud runtime contract |
| 4 | monorepo `runtime/tests/zero-runtime.test.ts`, `legacy-zero-users.ts` |
| 5 | zero CI lane "Spacefast cross-prefix migration and session continuity" |
| 6 | monorepo `packages/cli/src/zero-v2.test.ts`, `zero-v2-source-publish.test.ts` |
| migration | zero `tests/app_migrate.rs`, `tests/config_migrate.rs`, CI lanes "Zero 0.8 census tool" and "Zero 0.8 site, app-user and application migrations"; monorepo `zero-generation.test.ts`, `packages/common/src/utils/zero-migration.test.ts` |

Where a rule has no behavior test yet, the
coexistence test lane adds one.
