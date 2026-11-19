# A managed build installs only when it is initialized, and says beforehand what it will install

Date: 2026-11-14. Status: accepted; the first half of First keeping its own deployments. The second
half (one live build, the closed state, `activate`, rollback) is not decided yet; nothing here
depends on how it is decided.

## Problem

First will keep its own builds and decide which one is live. For that, a deployment must be able to
read a candidate build and say what installing it would change before it changes anything, and a
build must not change the site just because a request ran it.

Neither held. A build mounted from the store (`First\Loader\Loader::load`, a "managed" site) wrote on
ordinary requests: identity's schema and password material, the runtime-schema capability on
administrators, Pages for `first/app/` routes and Markdown pages, the front-page options, the rewrite
rules and `.htaccess`, First Admin's rule, the upload namespace, three Action Scheduler schedules, the
search shape and its reindex jobs, private-file deny rules and their probe, and the 0.3 stored-name
upgrades. Reading the runtime schema could rewrite its option. The system-table fingerprint wrote
every PHP upgrade step as the same word, so a changed step changed nothing anyone could compare. The
migration ledger recorded which files ran, not what they said.

## Decision

**Install is explicit.** On a managed site, a request installs nothing. Everything above runs inside
`Loader::initialize`, which a host already calls once before exposing a build, in this order: identity
(its stored-name upgrade, schema, signing key, password material), the runtime's stored-name upgrade,
system tables, the app's migrations, then the install steps (schema capability, upload namespace,
schedules, private files, Pages, front page, search shape) and one rebuild of the rewrite rules at the
end. `initialize` re-reads the plan afterwards and fails if anything is left, so its receipt means
everything the build needs is installed. A site that installs First as ordinary plugins (what
`first build` writes) installs on boot and on its first requests exactly as before.

Registration is not installation: hooks, post types, REST routes, rewrite rules held in memory,
edit protection on Pages and schedule handlers are registered on every request. Ordinary serving
still writes derived data (the read index, caches, transients), and a rebuild WordPress starts itself
(permalinks saved, another plugin flushing) still happens on that request with the build's rules.

**Inspect, then decide.** `Loader::inspect()` reads a mounted build and the site and returns what
`initialize` would run, writing nothing. A build mounted with `inspect` registers none of the app's
compiled WordPress hooks, so none of the app's own code runs while it is read. The answer is one list,
`steps`, in the order they would run. Each step is `{kind, id, state}` plus its own detail:

| kind | id | when |
|---|---|---|
| `system-tables` | `system-tables` | the site recorded another set of system tables or step versions |
| `identity-schema` | `identity-schema` | identity's schema version is older than the runtime's |
| `migration` | `migration:<id>` | each pending migration file, with the hash of its SQL |
| `page.create`, `page.update`, `page.restore`, `page.trash`, `page.adopt`, `page.hide`, `page.adopt-hide` | `route:<id>` or `content:<route>` | a Page that would change |
| `front-page` | `front-page` | the front-page options would change |
| `search-shape` | `search-shape` | the searchable fields differ from the recorded ones |
| `rewrite-rules` | `rewrite-rules` | URL patterns, First's fingerprint or First Admin's rule are not the stored ones |

`state` is `pending`, or `started` for a step a previous run began and did not finish. The set of
kinds is open: a reader counts kinds it does not know. Data migrations written in code are an expected
future kind. A plan with no steps means the build installs nothing; the second half reads exactly that
to decide whether a deployment can switch without closing the site. Refusals (platform, the schema
check with its `--drop` confirmations, runtime-schema conflicts) are listed beside the steps, all at
once, never thrown.

What makes this comparable:
- Runtime-schema checks have a read-only path (`SchemaVersions::verify()`); the copy repair stays
  where it was.
- A guarded system step carries a version (`SystemTables::step(<version>, …)`). Version 1 is written
  the way the fingerprint wrote every step before, so sites that already ran today's steps run
  nothing again.
- The migration ledger records the SHA-256 of each file it applies. Rows from before have none and
  count by id only.
- Each build in the store keeps `storage.json` (what it stores and how, without access rules or UI)
  and `baseline/<build>/` (its snapshot, migrations and storage description, with their hashes).

## Kept sources

A First release may not refuse source an earlier release accepted for a managed site.
`tests/first_sources.rs` holds captures at the commit where the rule starts (there is no release
yet), each with the plan a recompile against its own baseline produces (empty) and its
`storage.json`. Until the first release is tagged, a change that deliberately alters what the
authoring surface accepts recaptures them and adds a row to the table of breaks in
`tests/fixtures/first-sources/README.md`; from the first release on, each release adds captures
that are never recaptured.

`storage.json` leaves out the indexes the compiler infers from the code's queries
(`<field>_queried`): they follow the code, so adding a filter changes no storage description. An
ordinary deployment that adds or drops one still has a migration step, and with the second half that
step will close the site while it runs. Running those steps with the site open (both directions are
safe for the old code and the new) is open: it is the first narrowing to design before the second
half.

## The interim limit

Today a host may still select a build per request (`docs/host-contract.md`, Lifecycle). A request
never installs anything now, and `initialize` on a build that is already ready returns its receipt
and changes nothing. So the stored rewrite rules and the app's Pages stay those of the build
initialized last, until a new build initializes: builds selected per request must share URL patterns
and page records with the build initialized last. No host selects First builds per request today;
the second half removes that contract.

## Not built yet

- One live build per site, chosen by First, with every request on it.
- The closed state a deployment puts the site in while it changes storage, and `activate`.
- Rollback as a code-only deployment of earlier source.
- Data migrations written in code.
- The one-time import of a site that ran the 0.3 compiler.

## Cost

A managed build that has not been initialized does not work: nothing repairs it on a request any
more. A host that forgot `initialize` used to get a site that half-installed itself on its first
requests; now it gets a site that is missing its Pages, rules and schedules until it calls it. Every
host already calls it before exposing a build.
