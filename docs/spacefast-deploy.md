# Zero on Spacefast

Zero compiles TypeScript to WordPress plugins on any host. Spacefast is an
optional host integration. Its finalize process compiles source bundles inside
the Atomic box; authors need neither PHP nor a Spacefast-specific Zero runtime.

| Decision | Mechanism |
| --- | --- |
| Upload | One `app.zero.json` and one `vendor.zero.json`, with a small `manifest.json`, under private `.zero-source/`, plus public assets. Bundles preserve original compiler-readable TS/JS, module paths, package exports/type metadata and canonical identities. They are deterministic JSON containers, not JavaScript bundler output or an expanded node_modules upload. App and vendor have independent SHA-256 identities. |
| Compile | The native finalizer invokes the engine release's pinned Zero executable through `compile-sources` and generates `.zero-compiled/` outside the public catalog. Sources, their hashes, compiler version and exact source revision remain with the version. There is no npm install, plugin download or author PHP execution. Both upload and finalize reject author PHP and the reserved output prefix. |
| Version selection | Resolve Space and version before WordPress boot. Mount that version's runtime and app only, from immutable paths. Saved-code restore and immutable URLs retain both trees. Engine/compiler upgrades never recompile an ordinary old-version request. A separate refresh publication may create a new version without changing the original. |
| Initialization | After platform plugins load, explicitly mount and initialize the candidate before readiness, without globally activating its plugins. Managed visitor requests never run migrations or rewrite schema hashes. Initialization and forward migration need a Space-scoped lock spanning baseline selection through readiness. |
| Database | Every version in an environment uses its latest configured schema. Migrations only go forward. Old code may break against the new schema. No historical database snapshots or downgrade framework. |
| Platform | Check actual WordPress/PHP and active plugin versions before readiness. SCF 6.9.7+, Action Scheduler 4.2.0+, MCP Adapter 0.7.1+, and Polylang 3.9+ for localized apps. Missing requirements block publication. |
| Browser client | Compose the version's generated app exports with the engine-owned shared exports at `/__spacefast/client.js` and `/__spacefast/client.d.ts`. The stable generated app companion `/__spacefast/zero/client.js` and its `client.d.ts` use the selected version. `loadSpacefastClient()` imports the canonical shared module on demand. Shared Access/connectors/collaboration remain engine-owned; never substitute a global latest app. JavaScript contains contracts, never visitor credentials. Local builds emit browser JavaScript and types from the same client source. HTML, React and Gutenberg consume the same contracts. Editor product work is separate. |
| Accounts | Spacefast Access, wp-admin login and session loading are optional bootstrap overlays. Zero core does not require Spacefast accounts. Reuse host admission/principal resolution and the existing WordPress role/session integration only after Space scope is established. |
| Background work | Unscoped cron/WP-CLI mounts no app. A job must carry an explicit Space, environment and version and enter the same database/cache/identity scope as its HTTP request. |
| Release | One `spacefast` npm release includes the 0.8 transition and direct `@spacefast/zero-bin-<platform>` optional dependencies. `packages/cli/zero-compiler.json` pins compiler source separately from the npm CLI version. No additional wrapper package. |

CAS deduplicates within a Space. An app-only edit changes the app blob; the
unchanged vendor blob is reused. The manifest changes only when its independent
hashes or metadata change. Source files and generated PHP are private, while
public assets use the usual public file catalog.

The app bundle also retains committed `zero/migrations` SQL and its snapshot as
private source metadata. The host archives those bytes outside the executable
plugin migrations. It generates executable plans from the compiled schema and
its own previous compiled version, so uploaded SQL never selects the database
baseline or executes during initialization.

## Shared MySQL binding

The host binds a Space to its own WordPress table prefix before normal plugins,
roles, sessions, Action Scheduler and Zero bootstrap. Core posts/options and
users/usermeta use that binding, as do Zero and Action Scheduler tables. The host
namespaces every object-cache group, including global user groups. Cache flushes
invalidate only the selected Space. Media and request origins reuse the existing
Spacefast content scope. Additional database environments are a later binding
overlay; immutable versions on the selected box share its latest MySQL schema.

A local WordPress 7.1.4/MariaDB proof publishes two versions and a second Space
into one installation. It checks independent options, posts, product rows, users,
job storage, cache groups and private-media bindings. Both immutable clients and
saved-code rollback retain their original code after the forward schema change.
Config-only publication takes the same migration lock as a source publication.
A migrated table must match the host's existing Space/collection ownership rule.

This does not qualify an Atomic installation. Its MU-plugin order and persistent
cache drop-in must meet the binding contract. Bootstrap refuses identity that
loaded too early and refuses multisite. Unscoped cron/WP-CLI loads no app;
site-wide async job spawning is disabled. Autonomous scoped job dispatch,
wp-admin/account overlays and Atomic SQLite are not implemented. Hosting remains
explicitly enabled until those deployment prerequisites are qualified.

## SQLite for staging and tests, design only

A database binding belongs to a Space environment, not an immutable version.
Otherwise rollback would silently switch data. Resolve an explicit environment
binding first, then the app's configured binding, then the host's environment
default. An explicit MySQL production binding must never fall back to SQLite.
Bind before WordPress constructs `$wpdb`; request-time switching is too late.

An SQLite binding owns a persistent private directory outside version artifacts,
for example `spaces/<space>/databases/<binding>/wordpress.sqlite`. Bindings are
server-validated identifiers, never author-supplied filesystem paths. Versions
share this environment file and its latest forward schema. Retention and deletion
follow the binding lifecycle, not version cleanup. Never upload, serve, or copy
this file into immutable public artifacts.

Use SQLite WAL only on a qualified local filesystem, bounded busy timeout,
short transactions and one migration writer per binding. Verify PDO SQLite,
locking across FPM workers, journal permissions, backup consistency and recovery
before enabling it. Export would use the SQLite backup API or a coordinated
checkpoint/snapshot, not copy a live database file. Future CLI access/export must
require the environment's database capability and an audited short-lived stream;
there is no implementation or live mutation in this change.

The inspected SQLite Database Integration 3.1.2 archive supplies `db.copy`,
which becomes the `db.php` drop-in. It selects `DB_ENGINE=sqlite`, requires
`pdo` and `pdo_sqlite`, and supports an explicit private `DB_PATH`. Local PHP
has PDO SQLite; that says nothing about Atomic. The drop-in must run before
WordPress database bootstrap. On Atomic, ownership of that drop-in, host database
bootstrap, available PDO extensions and filesystem policy must be qualified.
Installing a normal plugin after WordPress loads cannot select SQLite. Native
SQLite integration on Atomic remains unproven; do not advertise support.

Endpoint/page compilation remains a separate migration gap for 0.8 apps. Existing
PHP Functions accept uploaded PHP outside v2. Whether that exception remains is
an open user-policy decision; this work does not delete it.

The host engine carries a separate native compiler executable from the same
immutable source pin and verified artifacts as the CLI. Native runtime Cargo
builds have no private Git dependency. The compiler build checks out the pin with
a short-lived read token and records source identity and notices in its archive.
No npm or compiler release is published by this integration.

The separate 0.8 migration work must land before its adopted-table sources are
included in the compiler pin and exercised through hosted publication. Its
standalone acceptance does not establish the host's table ownership or retained
migration behavior. Endpoint/page compilation, legacy identity continuity and
realtime migration remain outside that accepted subset.
