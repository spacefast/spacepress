# Install First

First's npm installer and unsigned release workflow are ready for maintainers to publish. The package names and download commands below become usable after the matching npm packages and GitHub release assets exist. They have not been published by this change. Node.js 22+ and npm are required; end users do not need Rust or Docker.

## Create an app

After publication:

```sh
npm create @spacefast/first@0.3.0 my-app
cd my-app
npm run dev
```

The creator installs the matching `@spacefast/first-cli` version and TypeScript. The compiler package downloads the exact version for your operating system and CPU and verifies the archive's SHA-256. `first dev` uses pinned WordPress Studio CLI 2.2.0 to supply native PHP, WordPress and SQLite.

Open `/wp-content/plugins/first-app-my-app/public/index.html` on the WordPress URL printed in the terminal. Your public frontend, API, login and native WordPress admin share that origin. WordPress's theme retains its homepage. Add a note through “Write a note”; the example permits public reads and restricts writes to WordPress editors. Use the local admin credentials printed by First only for development.

Edit `public/` for the frontend and `first.config.ts` for the backend. First watches both. Refresh to see changes. The generated client in `first/_generated/client/` is ready for a TypeScript frontend, and `client.ts` demonstrates its types. A frontend framework is optional. Backend TypeScript compiles to PHP; unsupported language/library behavior fails compiler checks rather than becoming a Node.js service.

```sh
npm run check
npm run typecheck
npm run build
npm run dev -- --port 9123
npm run wp -- core version
npm run stop
```

Stopping preserves your local SQLite content. Commit generated migrations and client files; keep `.first/`, dependencies and secrets out of Git. The emitted deployment artifact is `first/dist/wp-content`, not the local Studio database. Production provisioning and data migration require the deployment lifecycle for your target WordPress site.

Use `npm create @spacefast/first@0.3.0 my-app -- --no-install` to scaffold without installing dependencies. Choose a new directory: existing empty directories, populated directories and symbolic links are all refused. An installation failure preserves the newly created app for a retry.

## Install the command separately

After publication:

```sh
npm install --global @spacefast/first-cli@0.3.0
first --help
```

Prebuilt targets are macOS arm64/x64 and glibc 2.39+ Linux arm64/x64 (Ubuntu 24.04 or newer). Windows, older glibc and musl Linux need a compiler you provide. There is no automatic Cargo build or search for another `first` executable.

| Setting | Effect |
| --- | --- |
| `FIRST_BIN=/absolute/path/to/first` | Use your explicitly provided executable, without downloading. Relative paths and missing/non-executable files fail. |
| `FIRST_CACHE_DIR=/absolute/cache` | Store version/target-specific compiler downloads here. The default is `$XDG_CACHE_HOME/first/npm`, or `~/.cache/first/npm`. |
| `FIRST_OFFLINE=1` | Use only the verified cache or `FIRST_BIN`. A missing cached version fails with a next step. |
| `FIRST_RELEASE_BASE_URL=https://mirror/releases/v0.3.0/` | Read the exact archive and checksum from a release mirror. `file://` and loopback HTTP are supported for local maintainer tests. |

Every release needs `first-vVERSION-RUST_TARGET.tar.gz` and its `.sha256` file. The checksum file contains the lowercase SHA-256, two spaces and the exact archive basename. Downloads fail clearly if either asset is missing, malformed or corrupt. Cached executables are checked against their installation receipt before reuse. SHA-256 establishes integrity of the downloaded archive; it is not a publisher signature.

## Homebrew

The workflow generates `homebrew/Formula/first.rb` from all four real archives after verifying each checksum. It never substitutes placeholder hashes. Maintainers must publish those exact archives and create or select a public tap before advertising a `brew install` command. A tap called `spacefast/tap` would conventionally expose `brew install spacefast/tap/first`; that tap's existence and permissions are not assumed here.

The formula installs the executable and original license notices, depends on Homebrew Node, and checks a real First config in `brew test`. Node supplies npm for `first dev`. macOS signing and notarization are deferred to the signing team; the current archives explicitly declare themselves unsigned. No signing bypass is installed.

## Maintainer release steps

1. Confirm npm scope ownership and package access for `@spacefast/first-cli` and `@spacefast/create-first`. Registry checks found no published package at either name; the unscoped `create-first` belongs to another publisher, and `@spacefast/zero` is an existing older package. Do not overwrite those packages.
2. Set one new version in root `Cargo.toml` and both package manifests. `node scripts/release/version.mjs VERSION` rejects mismatches. Check the npm version is unused and create an immutable `vVERSION` Git tag after review.
3. Run the unsigned release workflow for that version, or let the tag trigger it. It builds natively on four runners, smoke-checks each binary, packages runtime/upstream notices and source provenance, packs npm tarballs, verifies archives, and generates the formula. Its only upload is a workflow artifact; it does not publish a GitHub release, npm package or tap, and has no publication secrets.
4. Review `first-release-unsigned`. Run the packed-install acceptance below using a compiler built from the reviewed source. Have the signing team sign/notarize release payloads when ready, then regenerate archive checksums and the formula from the final bytes. Never reuse pre-signing hashes.
5. Publish an immutable public GitHub release at `spacefast/zero` tagged `vVERSION`, including each archive and matching `.sha256`, plus the exact source archive and notices. Then publish the reviewed npm tarballs using the authorized npm account (`npm publish PATH_TO_TARBALL --access public`). The CLI package must be available before the creator is advertised. Do not rerun `npm pack` from installed tarballs: maintainer preparation scripts run from the source repository.
6. Copy the generated formula to the chosen public tap's `Formula/first.rb`, run `brew install` and `brew test first` on supported machines, then publish the tap commit. Verify the public npm create command and unsigned/signed macOS install experience before announcing support.

### Test an unpublished release locally

Use a private target directory and a new evidence directory. No command below publishes anything.

```sh
CARGO_TARGET_DIR=/tmp/first-setup-target cargo build --release --locked
FIRST_SETUP_BINARY=/tmp/first-setup-target/release/first \
  FIRST_SETUP_EVIDENCE=/tmp/first-framework-setup-local-test \
  node scripts/release/acceptance.mjs
```

The acceptance run creates a local archive and real checksum, packs and installs both npm packages into clean temporary projects, scaffolds with automatic dependency installation, checks generated client types, runs `npm run dev` on an available port, reads content created through native WordPress, and stops/deletes only its own site. Studio configuration, daemon, caches and SQLite files are isolated. Evidence and the scaffold remain under the requested `/tmp` directory; the disposable WordPress data is removed. This proves local Linux behavior when run on Linux; it does not prove macOS, arm64, public release delivery, Homebrew installation or signing.

For manual packaging, `node scripts/release/archive.mjs BINARY RUST_TARGET OUTPUT SOURCE_COMMIT` requires matching HEAD and committed compiler/runtime sources. `--working-tree` explicitly marks a local test artifact whose revision is only the base commit. `node scripts/release/homebrew.mjs OUTPUT NEW_FORMULA_PATH` requires all four real matching archives. Never publish local test artifacts labelled `local-working-tree-test`.
