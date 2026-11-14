# Connectors through the Space client, not a First provider

Date: 2026-11-13.

Owner ruling: a First app uses Spacefast Connectors v2 like any other Space. It declares roles in
the Spacefast config (`connectors` in `sf.jsonc` or `spacefast.config.ts`) and calls them from its
pages with `@spacefast/client`. First gets no connector API of its own: the `Zero\Connectors`
provider from the design lock is not built. Server code (`ctx.connectors`) stays unsupported.

## What follows

1. **The engine owns the route.** Spacefast answers `/__spacefast/connectors/<role>/<tool>` and
   `/__spacefast/client.js` before WordPress boots, behind the Space's own access check (monorepo
   `runtime/engine/runtime/serve.php`, the `connectors` and `space_client` control rows). First
   reserves `__spacefast` as a first segment. A root catch-all `route.ts` now leaves every reserved
   path to WordPress (`AppRouter::handlers`, as `claim()` already did), so the paths stay the host's
   on any host.
2. **The migrator carries capsule roles.** `first migrate app --from zero-0.8` writes each
   `capsule({ connectors })` role into the candidate's `sf.jsonc` exactly as Spacefast froze it for
   the 0.8 version (the monorepo's `capsuleConnectorRoles`): its connector, `owner` named
   `personal`, every tool, no pinned arguments, the default cache. Names don't change, so the
   Space's bindings and visitor connections, keyed by Space and role, keep serving them, and
   `connector-roles.json` still lists the same names for the host.
3. **What it can't carry it refuses.** A role declared without a connector took its binding's
   connector in 0.8 (`LEGACY_UNSPECIFIED_CONNECTOR`); the converter can't see bindings, and a config
   role needs a slug, so the role is refused with `Z08_OMITTED_CONNECTORS` and a fix naming the
   publish notice that holds the slug. A config file that already declares `connectors` keeps its
   own roles, which 0.8 served instead of the capsule's.
4. **Server calls get their own code.** `ctx.connectors` is refused with `Z08_CTX_CONNECTORS`,
   whose fix (the field a publish shows) says to call the role from the page.

## Cost

- A `"use client"` component under `first/app/` can't import `@spacefast/client` or the generated
  `spacefast.generated.ts`: client components take no package imports and no bundler runs. It calls
  the route with `window.fetch` instead and gets no generated types. Letting client components
  import `/__spacefast/client.js` is a later change.
- A role carried with `tools: "*"` exposes every tool the connection has, as it did on 0.8. The
  author narrows it after the move.
