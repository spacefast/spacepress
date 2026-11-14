# Compiler diagnostics

`first check [project-dir] --json` compiles in memory and writes one JSON object
to stdout. It writes no generated files, migrations or plugin downloads. Exit
status is 0 for a successful check, 1 for a compiler diagnostic, and 2 for invalid
CLI arguments. Argument errors remain human-readable on stderr.

```sh
first check examples/recipes --json
python3 scripts/compiler-contracts.py --check
```

The website's browser build of the compiler (`src/wasm.rs`) answers with the same
envelope under `check`, so an editor, the command line and the site report one shape.

The envelope has `schema: "first-diagnostics"`, `version: 1`, `compilerVersion`,
`ok`, `diagnostics` and `groups`. Both arrays are empty on success. Each
diagnostic has a code, category, severity, message, optional help, location and
group ID. Categories currently are `invalid-source`, `unsupported` and
`environment`; severity currently is `error`.

A location contains a project-relative file path where possible, zero-based
UTF-8 byte `start` and exclusive `end` offsets, and one-based `line`, `column`,
`endLine` and `endColumn` positions. Columns count UTF-16 code units for editor
integration. The envelope declares `offsetEncoding: "utf-8"` and
`positionEncoding: "utf-16"`. A diagnostic without a source location has
`location: null`. This encoding describes diagnostics, independently of runtime
string indexing.

Groups collect identical codes and messages with distinct source locations.
Their IDs are opaque hashes of the code/message; do not infer a diagnostic code
from the ID. IDs are independent of the project directory. Message changes can
change a group ID. Sites and groups retain deterministic module traversal order.
Repeated instantiation messages with different text are currently separate groups.

Parsing/lowering collects independent failures in top-level declarations and
imported modules. A failed declaration is discarded only for continued analysis;
if any failure occurred, the entire program is rejected before evaluation. No
partially lowered config or executable artifact is produced. A syntax failure
prevents lowering that module, while other imports already discovered in valid
modules can still be checked. Evaluation, extraction and PHP type checking still
stop at their first error. This is not a complete tolerant TypeScript checker.

The ordinary `first check` keeps its terminal output and first-error behavior.
The JSON form also fails on unsupported constructs; a report containing blockers
never exits successfully. It checks the WordPress compilation contract without requiring target flags. Nonfatal build hints are not currently included in the JSON
format.

## Codes

- `F0001`: general configuration error.
- `F1001`: TypeScript syntax error.
- `F1002`: unsupported syntax/lowering operation.
- `F1003`: module/file resolution or read failure.
- `F2001`: pure evaluation failure.
- `F3001`: schema extraction failure.
- `F4001`: handler type checking or PHP compilation failure.
- `F1201`: a plugin package imports the app's modules or another plugin's package.
- `F1210`: app source imports a file outside `first/` (`first.config.ts` and modules under `first/` load app code only from `first/`).
- `F1221`: an export name is taken twice (two exports, or an action named like a kind), one definition is exported under two names, or a kind, action or job is a default export.
- `F1222`: a kind, global, file bucket, action or job is built in `first.config.ts` or a module under `first/` but not exported, so it has no name.
- `F4201`: a plugin's compiled code needs a capability its `first/_generated/plugins.lock.json` entry doesn't grant.
- `F4301`: app or plugin code names, as a literal, a WordPress option the runtime guard protects (`runtime/First/Wp/guard.json`): writing or deleting a site setting that loads code, moves sign-in or decides roles, or reading one that holds a secret.

Specific, fixture-backed codes take precedence over phase codes. The growing
[tested compatibility inventory](language-support.md) lists those codes and
guidance. Add the diagnostic at its source, a rejection fixture and an inventory
entry together. Run `python3 scripts/compiler-contracts.py` after changing the
inventory; `cargo test --test compiler_contracts` verifies actual CLI outcomes
and rejects stale generated documentation.
