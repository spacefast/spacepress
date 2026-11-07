# Builds live in an immutable store; a loader mounts one per request

A site needs to keep several compiled builds of its one Zero app and run exactly
one of them per request. A host with versions (Spacefast) picks the build per
request. A plain WordPress site deploys a build and can roll back to an earlier
one. Today the host compiles each version into its own `.zero-compiled/` tree,
with a full copy of the runtime (about 27 MB and 3,300 files) per version.

## Layout

The store root is a parameter. Plain WordPress uses `wp-content/zero/builds`
(or the `ZERO_BUILD_STORE` constant). A host passes its own private directory.

```
<root>/runtime/<revision>/      zero-runtime/, zero-identity/, zero-admin/
<root>/app/<hash>/              manifest.json, snapshot.json, migrations/, seed/,
                                client/, source-migrations/, plugins/zero-app-<name>/,
                                plugins/zero-pages-<name>/
<root>/build/<id>.json          {format, name, compiler, runtime, app, identity,
                                 admin, pages, snapshot, client}
<root>/ready/<id>.json          written after the build initialized on this site
<root>/current.json             {build, history}: plain WordPress only
<root>/.lock, <root>/.tmp/      writer lock and staging
```

- `<revision>` is the SHA-256 of the runtime tree's paths and bytes, not a Git
  revision. A vendored crate has no Git metadata, and two compiler revisions
  that ship the same runtime bytes then share one tree. A locally modified
  runtime gets its own tree instead of overwriting a published one.
- `<hash>` is the SHA-256 of the app tree's paths and bytes. The tree is what
  `compile_sources` writes today minus the three runtime plugins, so `previous`
  works as before: an app directory holds `snapshot.json` and `migrations/`.
- The build ID is the SHA-256 of its manifest bytes. The loader checks it, so a
  changed manifest is refused.

## Writing

`zero::host::compile_to_store(sources, root, assets, previous)` takes the store
lock (`flock` on `<root>/.lock`), compiles into `<root>/.tmp/`, hashes the app
tree and renames it into `app/<hash>/` unless that directory exists. The runtime
revision is hashed from the embedded files in memory; its tree is written and
renamed into place only when `runtime/<revision>/` is missing. The manifest is
written the same way. Nothing in the store is edited after the rename, so file
paths stay valid for the opcode cache. `previous` is a build ID; its app
directory is the migration baseline.

## Loading

`runtime/wp-plugin/zero-loader.php` is one standalone file. It is the plain
WordPress must-use plugin, and hosts require it with `ZERO_BUILD_HOST` defined
and call `Zero\Loader\Loader::load($root, $build, $options)` before
`plugins_loaded`. It reads and checks the manifest, requires the runtime's
autoloader, and at `plugins_loaded` priority 1 requires identity (when the app
has an auth collection), calls `Runtime::mount`, then requires the admin and
pages plugins when the build has them. Nothing compiles at request time. A
second build in one request, or a site-wide Zero plugin already active, is
refused: the existing single-app rule.

`Runtime::mount` gains one change: `variables` defaults to `null`, which keeps
standalone environment lookup (wp-config constants) for plain sites. Hosts that
pass an array still get isolation.

Plain WordPress selects, in order: the build named by `wp zero deploy <id>`, the
`ZERO_BUILD` constant, then `current.json`. Outside deploy the build must have
its ready marker. A missing or unready build leaves the site up without the app
and shows an admin notice; `Loader::load` throws for hosts instead.

## Initializing

`Loader::initialize()` replaces activation hooks: `Runtime::initialize()` (system
tables and the app's pending migrations, forward only, under the existing
locks), then identity's maintenance schedule, then the seed, then the ready
marker. `wp zero deploy <id>` runs it and then moves `current.json`, pushing the
old build onto `history`. `wp zero rollback [<id>]` moves the pointer back to a
ready build without running migrations: an older build runs on the newer schema,
as versions do today.

## Garbage collection

`Zero\Loader\Store::gc($root, $keep, $dry = false)` keeps the given build IDs and
the current build, deletes every other manifest and ready marker, and deletes the
runtime and app directories no kept manifest references. It returns what it
removed. It holds the store lock, renames each directory into `.tmp/` before
deleting it, and clears stale staging. `wp zero gc [--history=<n>]` keeps the
current build and the newest `n` history entries. The host must not collect a
build it has compiled but not yet recorded.

## Alternatives

Keeping builds in MySQL would make them shareable between web nodes but would
put code in the database and defeat the opcode cache; the owner chose disk.
Copying the runtime per build is what we do today and costs 27 MB per version.
Hard links would save space without a manifest, but break on hosts whose
private storage spans filesystems and still need one directory per build.

## Host API (settled 2026-11-08 with the Spacefast engine)

The engine calls exactly these; nothing else in the store is a contract.

```rust
// zero::host
pub struct StoredBuild { pub build_id: String, pub runtime_revision: String, pub app_hash: String, pub manifest: BuildManifest }
pub fn compile_to_store(sources: &Path, root: &Path, assets: &Path, previous: Option<&str>) -> Result<StoredBuild, Diag>;
pub fn store_gc(root: &Path, keep: &[&str], dry_run: bool) -> Result<Vec<PathBuf>, Diag>;
```

PHP: `Zero\Loader\Loader::load(string $root, string $build, array $options = []): void` (hosts, before
`plugins_loaded`), `Loader::initialize(string $root, string $build): void` (migrations, seed, ready marker),
`Zero\Loader\Store::gc(string $root, array $keep, bool $dry = false): array`. The engine keeps one resolver,
`_stattic_zero_v2_build()`, that returns `(root, build)` for the request, and stores only the build ID per version.
