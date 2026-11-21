# Install TypedPress

The commands below work once the npm packages and the matching GitHub release are published (see [Maintainer release steps](#maintainer-release-steps)). Node.js 22+ and npm are required; end users do not need Rust or Docker.

## Create an app

After publication:

```sh
npm create typedpress@0.3.0 my-app
cd my-app
npm run dev
```

The creator installs the matching `typedpress` version and TypeScript. The compiler package downloads the exact version for your operating system and CPU and verifies the archive's SHA-256. `typedpress dev` uses pinned WordPress Studio CLI 2.2.0 to supply native PHP, WordPress and SQLite.

Open the **Website** URL printed in the terminal. The homepage, the **Notes** list, and each note are rendered by WordPress from `tp/app/`. WordPress imports the sample entries in `content/notes/` on first start. **Account** uses the local WordPress login printed in the terminal.

Start by editing `tp/app/page.tsx`. Wait for the rebuild and refresh your browser. Edit `typedpress.config.ts` to change the note fields or site settings. The starter's README shows where to edit layouts, styles, and actions. [Starter source](https://github.com/spacefast/zero/tree/main/packages/create-typedpress/template)

```sh
npm run check
npm run typecheck
npm run build
npm run dev -- --port 9123
npm run wp -- core version
npm run stop
```

The site answers on `http://localhost:<port>` only. To open it from another machine, either put a proxy in front and name its address with `npm run dev -- --url https://box.example.ts.net:8443` (WordPress writes that address into its pages; the proxy points at the localhost one), or listen on one of this machine's addresses with `npm run dev -- --host 10.0.0.24`. Anyone who can reach that address can sign in as the local administrator, so use it on a network you trust. Reload on save and the error overlay work at that address too: the page reads them from the site itself, so the proxy needs no second port.

Stopping preserves your local SQLite content. Commit generated migrations and client files; keep `.tp/`, dependencies and secrets out of Git. The emitted deployment artifact is `tp/dist/wp-content`, not the local Studio database. Production provisioning and data migration require the deployment lifecycle for your target WordPress site.

Use `npm create typedpress@0.3.0 my-app -- --no-install` to scaffold without installing dependencies. Choose a new directory: existing empty directories, populated directories and symbolic links are all refused. An installation failure preserves the newly created app for a retry.

## Install the command separately

After publication:

```sh
npm install --global typedpress@0.3.0
typedpress --help
```

Prebuilt targets are macOS arm64/x64 and glibc 2.39+ Linux arm64/x64 (Ubuntu 24.04 or newer). Windows, older glibc and musl Linux need a compiler you provide. There is no automatic Cargo build or search for another `typedpress` executable.

| Setting | Effect |
| --- | --- |
| `TP_BIN=/absolute/path/to/typedpress` | Use your explicitly provided executable, without downloading. Relative paths and missing/non-executable files fail. |
| `TP_CACHE_DIR=/absolute/cache` | Store version/target-specific compiler downloads here. The default is `$XDG_CACHE_HOME/tp/npm`, or `~/.cache/tp/npm`. |
| `TP_OFFLINE=1` | Use only the verified cache or `TP_BIN`. A missing cached version fails with a next step. |
| `TP_RELEASE_BASE_URL=https://mirror/releases/v0.3.0/` | Read the exact archive and checksum from a release mirror. `file://` and loopback HTTP are supported for local maintainer tests. |

Every release needs `typedpress-vVERSION-RUST_TARGET.tar.gz` and its `.sha256` file. The checksum file contains the lowercase SHA-256, two spaces and the exact archive basename. Downloads fail clearly if either asset is missing, malformed or corrupt. Cached executables are checked against their installation receipt before reuse. SHA-256 establishes integrity of the downloaded archive; it is not a publisher signature.

## Homebrew

The workflow generates `homebrew/Formula/typedpress.rb` from all four real archives after verifying each checksum. It never substitutes placeholder hashes. Maintainers must publish those exact archives and create or select a public tap before advertising a `brew install` command.

The formula installs the executable and original license notices, depends on Homebrew Node, and checks a real TypedPress config in `brew test`. Node supplies npm for `typedpress dev`. macOS signing and notarization are deferred to the signing team; the current archives explicitly declare themselves unsigned. No signing bypass is installed.

## Maintainer release steps

The repository publishes four npm packages: `typedpress` and `create-typedpress` (the Cargo
version, 0.3.0 today) and the independently versioned `@typedpress/astro` and
`@typedpress/blocks` (0.1.0). `CONTRIBUTING.md` describes the release workflow.

1. Make sure the npm account that publishes owns the unscoped names `typedpress` and
   `create-typedpress` (both unpublished) and the `@typedpress` scope. Do not overwrite the
   older `@spacefast/zero` package.
2. For a compiler release, set one new version in root `Cargo.toml` and both CLI package
   manifests; `node scripts/release/version.mjs VERSION` rejects mismatches. Merge it, then push
   an immutable `vVERSION` tag on that commit.
3. The tag runs the release workflow. It builds seven native archives and `typedpress.wasm`,
   smoke-checks each binary, packs and content-checks all four npm packages, installs the packed
   CLI from the archives, runs the packed starter end to end, generates the Homebrew formula and
   attaches the archives, `.sha256` files, wasm, `compiler-assets.json`, the exact source archive
   and the four npm tarballs to the GitHub release. The release assets must be publicly
   downloadable (the repository public) before the npm launcher can install anonymously.
4. Check the published release from a machine without GitHub credentials:
   `TP_CACHE_DIR=$(mktemp -d) npx --yes ./typedpress-VERSION.tgz --version` and `check` on an
   example. Have the signing team sign/notarize payloads when ready, then regenerate archive
   checksums and the formula from the final bytes. Never reuse pre-signing hashes.
5. Publish the tarballs attached to the release, in this order:
   `npm publish typedpress-VERSION.tgz`, then `create-typedpress-VERSION.tgz`, then
   `typedpress-astro-0.1.0.tgz` and `typedpress-blocks-0.1.0.tgz` (scoped packages publish public
   through their `publishConfig`). Do not rerun `npm pack` from installed tarballs: the prepack
   scripts run from the source repository.
6. Copy the generated formula to the chosen public tap's `Formula/typedpress.rb`, run
   `brew install` and `brew test typedpress` on supported machines, then publish the tap commit.
   Verify the public npm create command before announcing it.

### Test an unpublished release locally

Use a private target directory and a new evidence directory. No command below publishes anything.

```sh
CARGO_TARGET_DIR=/tmp/typedpress-setup-target cargo build --release --locked
TP_SETUP_BINARY=/tmp/typedpress-setup-target/release/typedpress \
  TP_SETUP_EVIDENCE=/tmp/typedpress-framework-setup-local-test \
  node scripts/release/acceptance.mjs
```

The acceptance run creates a local archive and real checksum, packs and installs both npm packages into clean temporary projects, scaffolds with automatic dependency installation, checks generated client types, runs `npm run dev` on an available port, reads content created through native WordPress, and stops/deletes only its own site. Studio configuration, daemon, caches and SQLite files are isolated. Evidence and the scaffold remain under the requested `/tmp` directory; the disposable WordPress data is removed. This proves local Linux behavior when run on Linux; it does not prove macOS, arm64, public release delivery, Homebrew installation or signing.

For manual packaging, `node scripts/release/archive.mjs BINARY RUST_TARGET OUTPUT SOURCE_COMMIT` requires matching HEAD and committed compiler/runtime sources. `--working-tree` explicitly marks a local test artifact whose revision is only the base commit. `node scripts/release/homebrew.mjs OUTPUT NEW_FORMULA_PATH` requires all four real matching archives. Never publish local test artifacts labelled `local-working-tree-test`.
