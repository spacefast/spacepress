# Host filesystem ABI

Build with `cargo build --lib --no-default-features --profile wasm --target wasm32-unknown-unknown`.
`first_alloc`, `first_free` and `first_compile` retain their existing ABI. New exports
`first_sources`, `first_check`, `first_migrate_app` and `first_migrate_config` use the
same owned UTF-8 JSON request and length-prefixed JSON response buffers.

The module imports `host.read_file`, `host.stat`, `host.canonicalize` and
`host.read_dir`. Each receives a UTF-8 path pointer and length and returns a
length-prefixed JSON buffer allocated by `first_alloc`. Rust owns and frees it.
Return `{data: value}` or `{error: {kind: "ENOENT", message: "..."}}`. Values are
UTF-8 text, `{file, directory, symlink}` booleans, an absolute canonical path,
and absolute child paths respectively. `host-fs.mjs` is an executable reference
adapter. Browser memory-only consumers must provide these imports too; their
stubs may throw because memory operations never call them.

Requests take an absolute `project` and optionally `files`, a map of relative
paths to UTF-8 source. Omitting `files` selects the host filesystem. Sources
accepts `packages` (defaults to true for local capture; false on the Spacefast runtime).
It returns `{app, vendor, manifest, publicFiles}`; the first three values are
exact bundle JSON strings to write unchanged. `publicFiles` names paths relative
to the project, including `public/`. Failures return `{check, output: null}`.

Check returns `{check}`. App migration takes optional `space` and returns
`{report, files}`. Config migration takes `source` and `input` (relative to the
project, defaults to `capsule.ts`) and returns `{status, entries, errors, files}`.
Migration never writes files; the caller reviews errors before writing the
candidate map. Invalid requests return `{error: message}`.

Native finalizers use the `host` feature and call `first::host::sources` (relative
imports and `first` only), then `first::host::compile_sources`. These do not need
`cli`, `ureq`, `zip` or `tempfile`. Local installed npm sources are captured with
`first::bundle::sources` or the wasm sources export.

Run `node --test tests/wasm/host.test.mjs` after building wasm and the native debug
binary. `CARGO_TARGET_DIR` selects both build outputs.
