# Zero 0.8 and v2 side by side

Zero 0.8 and v2 both run on Spacefast while this spec is built. A Space runs
one of them at a time, never both in the same version.

## Migration happens on publish when nothing would be lost

- **Live 0.8 versions** keep running unchanged. Nothing touches a version that's
  already published.
- **Each new publish of a 0.8 app** from the Spacefast CLI, local MCP or a source
  build runs the converter (`typedpress migrate app --from zero-0.8`) and the publish
  checks. When neither refuses anything and the Space's runtime runs v2, the
  publish ships as v2: on an existing 0.8 Space it adopts that Space's tables, and
  on a new Space it starts with fresh ones.
- **Otherwise the publish ships as 0.8** and returns every refusal as
  `{ code, file, line, column, feature, v2, fix }`, so the owner or their agent
  can fix it and publish again. Until v2 publishing and the hosted data copy land,
  that includes every app with a frontend, pages, static files, posts, users or
  Functions (the monorepo's own `Z08_LOCAL_*` and `Z08_FUNCTIONS` refusals, not
  converter codes). A clean candidate on
  a 0.8 Space whose runtime doesn't run v2 yet also ships as 0.8, with status
  `waiting_on_runtime`; on a Space with no 0.8 app it's refused with the
  retryable `runtime_capabilities_pending`.
- **There is no flag** to opt in or out. Hosted MCP doesn't build Zero apps, and
  older CLIs and direct API publishes never run the converter: the API doesn't
  convert.
- **A new Space can still start on 0.8** until CLI 0.9.0 and TypedPress ship. New
  apps made with `sf typedpress init` start on v2.
- **The same command** runs on its own to preview the v2 candidate.

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
   Spaces see no difference, with two accepted exceptions:
   - The platform plugins TypedPress needs (Action Scheduler, the MCP Adapter) are
     installed on every box, so Action Scheduler's two post statuses
     (`in-progress`, `failed`) show up in every Space's REST index. They are
     labels only, with no routes or permissions.
   - `GET /__tp/realtime.js` is a reserved engine path on every Space. On a
     Space without live updates, which includes every non-v2 Space, it returns a
     one-line script comment and pages poll instead. No 0.8, Static, Functions
     or content-model page ever loads that path, so their visible behavior
     doesn't change.
4. **0.8's paths stay 0.8's.** `/__zero/config`, `/__zero/run`, `/__zero/auth/*`
   and `/__zero/realtime/events` keep their 0.8 meaning on 0.8 versions. v2 adds
   `/__tp/api/v1/*`, `/__tp/client.js`, `/__tp/client.d.ts` and
   `/__tp/realtime.js`, and never reuses a 0.8 path with a different meaning.
   0.8 never used `/__tp/realtime.js`; rule 3 covers why it answers on
   every version.
5. **Adopted 0.8 tables are data, not schema to tidy.** The deploy-time schema
   check never alters or drops them without an explicit `--drop`.
6. **A root `typedpress.config.ts` means v2.** The spec's `tp/` and `app/` folders
   never make a project look like 0.8, or like another framework, to the CLI or
   the build pipeline.

## Suites that hold these rules

| Rule | Suite |
|---|---|
| 1 | monorepo `apps/control-plane/src/versions/zero-generation.test.ts`, `runtime/tests/zero-v2-cordon.test.ts` |
| 2 | monorepo `runtime/tests/zero-v2-hosted.test.ts`, `runtime/tests/zero-v2-source.test.ts` |
| 3 | monorepo `runtime/tests/zero-runtime.test.ts` (0.8), the e2e wp.cloud runtime contract |
| 4 | monorepo `runtime/tests/zero-runtime.test.ts`, `legacy-zero-users.ts` |
| 5 | zero CI lane "Spacefast cross-prefix migration and session continuity" |
| 6 | monorepo `packages/cli/src/zero-v2.test.ts`, `packages/cli/src/zero-v2-source-publish.test.ts` |
| migration | zero `tests/app_migrate.rs`, `tests/config_migrate.rs`, CI lanes "Zero 0.8 census tool" and "Zero 0.8 site, app-user and application migrations"; monorepo `apps/control-plane/src/versions/zero-generation.test.ts`, `packages/common/src/utils/zero-migration.test.ts` |

Where a rule has no behavior test yet, the
coexistence test lane adds one.
