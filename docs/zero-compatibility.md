# Zero compatibility and migration coverage

The migration baseline is `@spacefast/zero` and `@spacefast/zero-compile`
0.8.1. A successful source conversion proves that the candidate compiles.
Complete the data copy, access review, client changes, and runtime checks before
calling an application migrated.

Zero uses WordPress posts, metadata, attachments, users, revisions, and plugin
lifecycle. A generated plugin tree does not install WordPress or configure a
third-party plugin's external services. Check the deployed platform requirements
before activating an app.

## Spacefast migration coverage

| 0.8 capability | v2 migration behavior | Limit or required review |
| --- | --- | --- |
| Spacefast project root | Accepts `server/index.ts`, optional `sf.jsonc`, and `content/`; produces `zero.config.ts` and migration metadata | Resolve every refusal and review entry before publication |
| Application SQL tables | Adopts original physical tables with `existingTable`, preserving IDs and storage types | Requires the exact Space ID and expected columns, indexes, and foreign keys; IDs above JavaScript's safe integer range need a port |
| Typed queries, mutations, and actions | Converts supported handlers and static DB/index calls into named v2 actions | Update clients to v2 input, response, error, and route contracts; dynamic builders, pagination, and unsupported context services are refused |
| Native posts | A posts declaration or `content/posts/` adds a post-backed `posts` collection; scoped data copy preserves IDs, native body, authors, dates, and revisions | Custom native fields need a port; legacy sync declarations are dropped with a review hint |
| Content collections | Imports supported field declarations; scoped data copy maps collection tags, typed metadata, and revision fields to candidate storage | Rich blocks, multiple references, unsupported fields, and incompatible data need a port |
| Media | Copies attachment IDs, metadata, and parent links | File bytes must remain available through the host's media binding; the database command does not copy files |
| Users | Auth or Space Users adds a `members` user projection; copies user IDs, passwords, scoped role metadata, and verified primary email | Review permissions and legacy principal references; the converter does not invent owner IDs |
| Sessions | Copies imported sessions with markers; accepts the old cookie and upgrades a valid legacy hash once, preserving expiry | Requires original auth salt and an explicitly scoped cookie alias; native v2 rows never get legacy fallback |
| Google sign-in | Copies provider subject bindings to the same user IDs; host projects Google client values into managed identity configuration | Verify a fresh Google sign-in on the deployed host; never put provider secrets in source or reports |
| Connector roles | Emits `connector-roles.json`; maps `owner` to `personal` and retains `team` and `visitor` | The overlay grants no credentials or permissions; old connector calls require a port |
| REST endpoints and actions | Generated collection endpoints and `POST /wp-json/zero/v1/actions/<name>` work on Spacefast | Old custom method/path `endpoints` declarations are refused; port them to actions |
| Browser client | Generates v2 client contracts; Spacefast serves the selected version at `/__spacefast/client.js` | Replace old hooks, envelopes, and API calls |
| Realtime | Every committed write fires a change notice; Spacefast delivers it over Cast. Source conversion removes `realtime` and `ctx.invalidate` with a `mapped` entry | Replace `useQuery` subscriptions with [`watch`](realtime.md); notices name collections and ids, never rows |
| Pages, layouts, and islands | Old declarations and project directories are refused with pointers | Pages are not hosted on Spacefast yet; optional standalone [Zero Pages](pages.md) has its own compiler and limits |
| Content sync | Local `zero sync` supports v2 projects | Legacy sync is not retained; hosted collection edits do not rebuild a static frontend |
| Services and private storage | v2 has its own [services](services.md) and file contracts | Old service context calls, private file permissions, URLs, and credentials require an explicit port |
| Publication and rollback | Spacefast migration commits a one-way transition to v2 | 0.8 publication and promotion are refused after commit; immutable 0.8 URLs return `410 zero_legacy_retired`; older v2 code still shares the latest schema |

Follow [Migrate a Spacefast app](migrating-from-zero.md#migrate-a-spacefast-app)
for the procedure and recovery rules. The hosted operation runs through
`precheck`, `convert`, `fence`, `publish`, `data`, and `commit`. After data copy
starts, recovery retries forward while the Space stays fenced.

## Standalone WordPress migration

`zero migrate app --from zero-0.8` converts supported application source and
emits adoption SQL. It does not connect to a database. `zero migrate config
--from zero` imports supported content declarations, while `zero migrate site`
uses the original content-model release to migrate records in place.
`wp zero migrate-legacy-users` carries app users into a user projection.

These commands do not provide Spacefast's publication fence, cross-prefix
copy, managed provider configuration, or generation transition. Follow the
[standalone steps](migrating-from-zero.md#before-you-start) and review the
candidate's access rules. Keep a database backup; forward migrations have no
automatic downgrade.

## Other schema importers

| Source | Existing importer | Manual application work |
| --- | --- | --- |
| EmDash | Primitive seed schema declarations | Rich blocks, assets, taxonomies, menus, callbacks, and publication behavior |
| Payload | Primitive collection and field declarations | Hooks, access rules, relationships, uploads, Lexical content, authentication, and IDs |
| Sanity | Primitive document and field declarations | Portable Text, custom objects, references, validation, dataset export, assets, and live queries |

See [config migration](config-migration.md) for each importer's accepted subset.
An old content-model artifact is not a new `zero.config.ts`. The compiler refuses
unknown behavior instead of stripping it from a candidate.

## Executable acceptance

The coverage above has separate source and data owners:

- `cargo test --test app_migrate` compiles source candidates and checks refusals.
- `tests/wp/app-migrate/run.sh` adopts retained application tables on real
  WordPress/MariaDB and exercises the migrated actions and authentication.
- `tests/wp/legacy/run.sh` migrates content in place and checks native posts.
- `tests/wp/legacy/spacefast-run.sh` copies scoped content, users, provider
  identities, and sessions on real WordPress/MariaDB. It checks rollback,
  no-op retries, cookie authentication, hash upgrade, expiry, forgery rejection,
  and revocation.
- `tests/identity/run.sh` validates native identity behavior, provider callbacks
  against a local OpenID provider, OAuth flows, and concurrent credential changes.

Local acceptance does not qualify wp.cloud routing, persistent object-cache
ordering, or a real Google authorization exchange. Complete those deployment
checks on the actual host as described in the
[Spacefast deploy guide](spacefast-deploy.md#prepare-the-wordpress-host).
