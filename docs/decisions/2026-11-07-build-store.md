# Builds live in an immutable store; a loader mounts one per request

A site needs to keep several compiled builds of its one Zero app and run exactly
one of them per request. A host with immutable versions (Spacefast) picks the
build per request; each version stays live on its own URL until it is deleted.
This is the only target for now; deploy and rollback on plain WordPress can use
the same store later (see below). Today the host compiles each version into its
own `.zero-compiled/` tree, with a full copy of the runtime (about 27 MB and
3,300 files) per version.

## Layout

The store root is a parameter. The host passes its own private directory.

```
<root>/runtime/<revision>/      zero-loader.php, zero-runtime/, zero-identity/,
                                zero-admin/
<root>/app/<hash>/              manifest.json, snapshot.json, migrations/, seed/,
                                client/, source-migrations/, plugins/zero-app-<name>/,
                                plugins/zero-pages-<name>/
<root>/build/<id>.json          {format, name, compiler, runtime, app, identity,
                                 admin, pages, snapshot, client}
<root>/baseline/<id>/           snapshot.json, migrations/, storage.json, hashes.json
<root>/ready/<id>.json          written after the build initialized on this site
<root>/.lock, <root>/.tmp/      writer lock and staging
```

Added 2026-11-14, unused by serving so far: each app tree also holds `storage.json`, what the build
stores and how (per kind and field its type, choices, nested shape, required, SQL default and where
it lives; each table's indexes; no access rules, UI, hooks, actions or pages; keys sorted). Each build
gets `baseline/<id>/`: a copy of its snapshot, migrations and `storage.json` with each file's SHA-256,
so the next compile's baseline survives without its app tree. The build manifest gains `baseline` (the
build it was compiled against), `storage`, `jobs` and `wordpress` (the oldest WordPress its runtime
supports). They are optional to read: a manifest without them still loads, and the loader checks only
the fields it names. `First\Loader\Loader::inspect()` reports what `initialize()` would run on the
site for the loaded build (system tables, the stored-name upgrade, the identity schema, migrations
with each file's hash, the runtime-schema comparison, refusals) without writing anything.

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

`runtime/wp-plugin/zero-loader.php` is one standalone file, shipped in every
runtime tree as `runtime/<revision>/zero-loader.php`. The host requires it and
calls `Zero\Loader\Loader::load($root, $build, $options)` before `init`. The loader
owns the order: check the manifest against its ID, `Env::isolate` the
variables, require the runtime autoloader, load the schema, then at
`plugins_loaded` priority 1 run the host's `beforeIdentity` hook and require
`zero-identity` when `users` is set or the app has an auth collection, call
`Runtime::mount`, and require the admin and pages plugins when the build has
them. `Loader::schema()` returns the loaded schema as soon as `load` returns.
Nothing compiles at request time. A second build in one request, or a site-wide
Zero plugin already loaded, is refused: the existing single-app rule.

A missing `variables` option means an empty scope, never host values.

The store is outside `WP_PLUGIN_DIR`, so `plugins_url()` for its files is wrong
by default. The `url` option maps them to the store's public base URL.

## Initializing

`Loader::initialize($root, $build)` replaces activation hooks:
`Runtime::initialize()` (system tables and the app's pending migrations, forward
only, under the existing locks), then identity's maintenance schedule, then the
seed, then the ready marker. It returns `{migrations, seed}` and stores the same
receipt as `ready/<id>.json`, so a second call returns it without seeding again.
The host initializes a candidate before it exposes the version, under its own
publication lock, and serves only builds with a ready marker. Rolling back is the
host selecting an older build again: no migrations run, and the older build runs
on the newer schema, as versions do today.

## Garbage collection

`store_gc` and `Zero\Loader\Store::gc($root, $keep, $dry = false)` keep exactly
the given build IDs, delete every other manifest and ready marker, and delete the
runtime and app directories no kept manifest references. They return what they
removed, and an unknown or tampered kept ID fails the call. They hold the store
lock, rename each directory into `.tmp/` before deleting it, and clear stale
staging.

The store never decides on its own what to collect. Only the host calls GC, and
it passes as `keep` the build of every version that is not deleted, including a
candidate it is still finalizing. A version stays live on its URL until it is
deleted, so a build is collected only after its version is deleted. That rule
answers both races: a request still running a build belongs to a version that
exists, so its trees are kept; and a candidate being initialized is in `keep`
because the host already recorded it. Running GC from the host's version-delete
path, under the same lock as publication, keeps it from running against a
half-recorded candidate.

## Later work

- Plain WordPress: a must-use mode of the same loader, a `current` pointer
  moved by `wp zero deploy <id>` and `wp zero rollback`, and `wp zero gc` keeping
  the current build and a short history. Those need a policy for when a build
  stops being served, which hosts with immutable versions do not.
- Hosts that ran several apps on one WordPress isolated each with a table
  prefix, a cache scope and copied salts. With one site per WordPress and one
  build per request, a host can drop that isolation; that removal lives in the
  host, not here.

## Alternatives

Keeping builds in MySQL would make them shareable between web nodes but would
put code in the database and defeat the opcode cache; the owner chose disk.
Copying the runtime per build is what we do today and costs 27 MB per version.
Hard links would save space without a manifest, but break on hosts whose
private storage spans filesystems and still need one directory per build.

## Host API

A host calls exactly these; nothing else in the store is a contract.

```rust
// zero::host
pub struct StoredBuild { pub build_id: String, pub runtime_revision: String, pub app_hash: String, pub manifest: BuildManifest }
pub fn compile_to_store(sources: &Path, root: &Path, assets: &Path, previous: Option<&str>) -> Result<StoredBuild, Diag>;
pub fn store_gc(root: &Path, keep: &[&str], dry_run: bool) -> Result<Vec<PathBuf>, Diag>;
```

```php
require "$root/runtime/{$manifest['runtime']}/zero-loader.php";
Zero\Loader\Loader::load($root, $build, [
    'variables' => $variables,          // array<string,string>; missing means none
    'users' => $users,                  // load zero-identity without an auth collection
    'beforeIdentity' => $installHooks,  // ?callable, runs just before zero-identity
    'url' => $publicBaseOfRoot,         // optional, for plugin asset URLs
]);
Zero\Loader\Loader::schema();                        // the loaded build's Zero\Schema
Zero\Loader\Loader::initialize($root, $build);       // ['migrations' => [...], 'seed' => counts|null]
Zero\Loader\Store::gc($root, $keep, $dry = false);   // removed paths
```

The host stores only the build ID per version. `zero compile-to-store <sources>
<store> <assets> [previous-build]` is the same compile from a shell.

## Measured

`examples/blog` (auth collection, synced posts, jobs), two versions that differ
in one action, release build on an Apple M-series laptop:

| | Per version before | Store, first version | Store, each later version |
|---|---|---|---|
| Bytes | 17,883,916 | 27,045,142 runtime + 198,493 app + 476 manifest | 198,511 app + 476 manifest |
| Files | 2,774 | 3,261 runtime + 23 app + 1 | 23 app + 1 |
| Compile, median of 5 | 8,907 ms | 7,819 ms | 181 ms |

The runtime tree is larger than one old version because it always holds
`zero-admin` and `zero-identity`, which the old tree wrote only when the app
used them; it is written once per runtime revision. Two versions take
27,443,098 bytes in 3,309 files, against 35,767,850 bytes in 5,548 files before.
