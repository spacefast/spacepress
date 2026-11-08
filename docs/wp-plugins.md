# WordPress plugin dependencies

Declare additional plugins in `zero.config.ts`. Rust fetches and validates their
archives during `zero build --target wp`; the deployed runtime stays PHP only.
`zero check` validates declarations and the dependency graph without network I/O.
Standalone builds validate the config but never acquire or emit these plugins.

```ts
import { defineConfig } from "zero";

export default defineConfig({
  name: "site",
  target: "wp",
  collections: {},
  plugins: {
    "classic-editor": "1.6.7",
  },
});
```

A runnable collection example is in `examples/wp-plugins/zero.config.ts`:

```sh
cargo run -- build examples/wp-plugins
```

Commit the generated `zero/wp-plugins.lock.json` with the config. For an exact
WordPress.org slug/version, the first successful build records the archive's
SHA-256; this first acquisition trusts the HTTPS response from WordPress.org.
Subsequent builds enforce that checksum even after deleting the download cache.
An authored `sha256` can pin the first acquisition too. Changing a version creates
a new pin; replacing bytes at the same source/version fails. To intentionally
repin that release, remove its lock entry and supply the new authored checksum.

Required platform plugins are supplied by Zero through the same resolver; users
need not list them. The current pins are SCF 6.9.7, Action Scheduler 4.2.0, MCP
Adapter 0.7.1, Akismet 5.7.2 and Two Factor 0.17.0, plus Polylang 3.9 when `locales`
is configured. Users cannot remove them. Explicit overrides
must satisfy the platform floor. `wp_plugins::version::at_least` owns comparison
using PHP `version_compare` ordering, including WordPress beta/RC/pl suffixes.
The exact header version is checked against the declaration; numeric trailing
zero differences are accepted (the Polylang 3.9 archive declares 3.9.0).

## Supported plugins

Zero doesn't support every WordPress plugin. The plugins and version ranges the
Zero team tests are listed in
[`src/wp_plugins/supported.json`](../src/wp_plugins/supported.json): a minimum
version (inclusive) and an optional `below` bound (exclusive), compared with PHP
`version_compare`. The platform pins above are always on that list.

Any other plugin or version still installs. `zero check` and `zero build` print a
warning for it, and the wasm compiler returns the same text in
`unsupportedPlugins`:

```text
warning: plugin hello-dolly 1.7.2 is not supported by the Zero team. Zero installs it, but doesn't test it; Zero doesn't support every WordPress plugin. To ask for support, open an issue: https://github.com/spacefast/zero/issues
```

To get a plugin supported, open an issue with its slug, the version you need,
and what you use it for.

## Resources and explicit dependencies

The package key is the sole installation identity. An exact version string uses
WordPress.org. A detailed entry can supply the Blueprint v1 resource explicitly:

```ts
{
  plugins: {
    "classic-editor": {
      version: "1.6.7",
      pluginData: {
        resource: "wordpress.org/plugins",
        slug: "classic-editor.1.6.7.zip",
      },
    },
  },
}
```

An explicit archive reference must agree with the declaration's slug and version.
Plugins use top-level key/value entries and require exact versions. Floating
versions, ranges, tags such as `latest`, and different package identities are
rejected. Exact versions begin with a digit and may contain ASCII letters,
digits, dots, underscores, plus signs, and hyphens.

For a URL ZIP, supply `pluginData: { resource: "url", url: "https://…" }` and a
64-character lowercase hexadecimal `sha256`. URLs require HTTPS, except HTTP
loopback fixture servers; credentials and fragments are rejected. The package key is
the destination directory identity; `version` must match the plugin header.
For example, this URL declaration installs the same pinned public package:

```ts
plugins: {
  "classic-editor": {
    version: "1.6.7",
    pluginData: {
      resource: "url",
      url: "https://downloads.wordpress.org/plugin/classic-editor.1.6.7.zip",
    },
    sha256: "4b2b45b19c61f627ff8730222692a691023dea3435b35b8db95a2418b45ece65",
  },
}
```

The archive must contain one root directory or root-level plugin files, with one
root PHP `Plugin Name` header. Vendor wrappers with additional nested directories
must be repackaged. Original plugin license/readme files are preserved.

`requires: ["other-plugin"]` declares build dependencies by slug. Each dependency
must have its own exact package entry or be supplied by the platform. A plugin's
`Requires Plugins` header must be covered by this list. Zero neither guesses
versions nor fetches undeclared transitive packages. Duplicate declarations,
missing dependencies, cycles, and reserved `zero-*` identities fail. Metadata is
ordered by dependency, then lexically for independent nodes; this is also usable
as a deployment activation order, though the build never activates plugins.

## Output and failure behavior

WordPress builds use `.zero/wp-content` (`--out` selects
the content root), containing `plugins/<dependency>` alongside the generated app
plugin. Acquired ZIPs live in `.zero/cache/plugins/<sha256>.zip`; locked archives
can be reused offline. A corrupt cache entry fails rather than trusting or
silently replacing it. The cache is disposable; the project lock is not.

All downloads, extraction, header checks, and generated PHP lint finish in staging
before publishing output. Failed downloads, bad hashes, invalid archives, and
output collisions leave the previous output and project lock intact. Existing
unrelated plugins remain. Existing dependency destinations are replaced only if
the previous project lock owns their unchanged tree. Local changes and unmanaged
collisions fail with an error; remove or move the conflicting directory explicitly.
Removing a declaration does not uninstall its existing output directory.

Extraction rejects traversal/absolute paths, backslashes, control characters,
symlinks/special files, duplicate or case-colliding paths, file/directory conflicts,
and inconsistent local/central ZIP headers. Limits: 64 MiB downloaded, 256 MiB expanded, 20,000 ZIP entries,
60 seconds per acquisition, five redirects. Output trees containing symlinks or
special files are refused. Builds targeting the same project/output are serialized
by exclusive lock files; after a killed build, remove the named stale build lock
only when no build is running. Publication handles ordinary I/O errors with
rollback; abrupt process termination during directory renames is not a
crash-atomic deployment mechanism.

## Assembly integration

`src/wp_plugins` is independent of generated Zero plugin layout:

```text
resolve(&Config, required: &[Plugin]) -> Plan
Prepared::acquire(&Plan, lock_path, cache_path) -> Prepared
Prepared::trees() -> &[StagedPlugin]
Prepared::dependencies() -> iterator of Dependency
Prepared::lock_bytes() -> serialized project lock
Prepared::install_into(private_staged_plugins) -> collision-checked copies
```

Each staged result owns `directory`, `archive`, and dependency metadata:
`{slug, version, pluginData, sha256, requires, treeSha256}`. Keep `Prepared` alive
until copying finishes. The lock is `{version: 1, plugins: Dependency[]}` in stable
dependency order. `treeSha256` hashes sorted relative paths, entry kinds, and file
contents to detect changes before replacement; it is not a package signature.

The canonical assembler owns `zero-manifest.json`, generated plugin ZIPs, and
`--out`. Its order is: supply exact platform pins; resolve; acquire every tree;
copy existing output to private staging; install dependencies; emit/lint generated
`zero-runtime`, `zero-identity`, `zero-app-<name>` and, with `admin: true`,
`zero-admin`, plus their ZIPs; write its
manifest using resolved metadata; publish; persist the project lock. Preserve
unrelated plugins and serialize the project lock/output while publishing.

Every WordPress build now uses this assembler, including configurations without
`plugins`. The default output is `.zero/wp-content`; `--out` selects another
wp-content root. `zero dev` synchronizes its managed plugins into the
project’s persistent WordPress Studio site, retaining unrelated installed plugins.
Required platform pins come from `src/platform.rs`, checked against the PHP policy and
the shared platform fixture. `ZERO_WP_PLUGIN_CACHE` can select a shared download
cache; every cache hit is checked against its SHA-256 before extraction.

The identity plugin is currently a tree-shape placeholder. Its presence in an
artifact does not enable authentication; the site's `runtime.wp.identity`
reports whether a compatible identity implementation is actually available.

## Blueprint scope and provenance

Research used the official WordPress Playground repository at
[`3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb`](https://github.com/WordPress/wordpress-playground/tree/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb):

- [`resources.ts`](https://github.com/WordPress/wordpress-playground/blob/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb/packages/playground/blueprints/src/lib/v1/resources.ts): v1 resource discriminants and WordPress.org exact ZIP references.
- [`install-plugin.ts`](https://github.com/WordPress/wordpress-playground/blob/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb/packages/playground/blueprints/src/lib/steps/install-plugin.ts) and [`install-asset.ts`](https://github.com/WordPress/wordpress-playground/blob/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb/packages/playground/blueprints/src/lib/steps/install-asset.ts): acquire/stage, unwrap a single archive root, install under an explicit identity, ignore `__MACOSX` metadata, and handle collisions deliberately.
- The current [v2 declaration](https://github.com/WordPress/wordpress-playground/blob/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb/packages/playground/blueprints/src/lib/v2/wep-1-blueprint-v2-schema/appendix-A-blueprint-v2-schema.ts) and [data sources](https://github.com/WordPress/wordpress-playground/blob/3e0088b5cb6c56f5bcd260f83f13097d48d0fcbb/packages/playground/blueprints/src/lib/v2/wep-1-blueprint-v2-schema/appendix-B-data-sources.ts): declarative plugin lists and explicit sources rather than a browser lifecycle.

Zero supports this small resource/install subset, not full Blueprint documents.
It rejects steps, activation options, themes, literal/VFS/Git resources, raw PHP
plugins, database imports, browser networking features, Composer execution, and
arbitrary PHP/shell commands. `requires` and the checksum lock are Zero's explicit
build dependency contract, not a claim that Blueprint installPlugin performs
transitive dependency resolution.

Playground is GPL-2.0-licensed. No upstream implementation source is copied or
vendored here; the Rust implementation uses the compatible resource vocabulary
and documented installation behavior. ZIP parsing, decompression, and CRC checks
use the maintained MIT-licensed `zip` crate instead of porting Playground's
PHP/WASM extractor. HTTPS uses `ureq`/Rustls, hashes use `sha2`, temporary staging
uses `tempfile`, config/lock serialization uses `serde`, and URL validation uses
`url` (these direct dependencies are MIT OR Apache-2.0). Downloaded plugins retain
their own licenses; deployment/distribution must honor those licenses.

Module-owned tests live in `tests/wp_plugins.rs` and module unit tests. They run
the actual Rust CLI against local HTTP/ZIP fixtures and inspect emitted artifacts,
including a plugin that throws if PHP is executed.
A local HTTP acquisition test also exercises first-use WordPress.org checksum
locking, offline reuse, and corrupt-cache rejection. The existing compiler/runtime
suites retain ownership of standalone behavior.
