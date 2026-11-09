# Offline source lab

The showcase launcher runs this builder automatically. To build it separately:

```sh
npm ci --prefix examples/showcase/code-tools
node examples/showcase/code-tools/build.mjs /absolute/path/to/public
```

The output directory receives `source-lab.js`, `source-lab.css`,
`source-compiler-worker.js`, `compiler.js`, and `code-notices.txt`. The compiler
wrapper is bundled from the canonical `site/src/lib/compiler.ts`; no second
implementation is maintained here. Runtime code and highlighting grammars are
bundled locally. Exact dependency versions are in `package-lock.json`.

The launcher also copies the current compiler's `first.wasm` and writes
`sources.json` alongside these files. Its manifest is:

```json
{
  "name": "showcase",
  "revision": "SHA-256 of the running source and migration inputs",
  "files": {"first.config.ts": "complete TypeScript", "pantry.ts": "complete TypeScript"},
  "output": {"schema.php": "exact generated PHP", "functions.php": "exact generated PHP"},
  "previous": null,
  "migrationFiles": []
}
```

`files` contains every authored compiler input; `output` is a flat map of exact
build artifacts, including client TypeScript and migrations when available.
`previous` is the running build's migration snapshot, and `migrationFiles` lists
its SQL migration filenames. The browser passes both through to the compiler to
preview a migration from the running schema. Browser previews execute no migration.
`revision` identifies the exact `{files, previous, migrationFiles}` input accepted
by the running demo build service.

Include `source-lab.css`, a section with `id="source-lab"`, and
`<script type="module" src="source-lab.js"></script>` in the showcase page.
The entry point creates its own accessible controls inside that section.

The textarea edits complete source files. Explicit **Compile preview** runs the
real WASM compiler in a dedicated worker with a 25-second timeout; timed-out or
failed workers are discarded. Compilation never updates WordPress or executes
PHP/SQL. The UI preserves drafts and located diagnostics, marks stale output,
shows exact generated files, and compares baseline/draft files in the same
language through the official `@pierre/diffs` File/FileDiff APIs. Source/output
pairing shows a translation rather than calling it a line diff.

Drafts use browser localStorage for the current source baseline. When that
baseline changes, the previous draft remains downloadable rather than being
silently applied to new code. Copy and downloads preserve original source and
compiler bytes; syntax highlighting does not format them.

## Apply to the running demo

**Apply to demo** is separate from **Compile preview**. It requires a WordPress
administrator account and the launcher-managed build service. It rebuilds the
running demo, including generated API and editor artifacts. Applying supports new
tables, nullable or defaulted fields, and action or metadata changes. Changes to
existing fields or storage are refused. A failed migration requires manual
inspection before another rebuild; the UI retains its message, log and draft.
The build panel reports service unavailability separately from missing administrator access. The sign-in link returns here.

The UI obtains the canonical WordPress REST nonce and calls the demo-only
`first-showcase/v1/control` and `first-showcase/v1/builds` endpoints. Source files
and the manifest revision are submitted together. Build logs remain plain text.
After success, **Reload updated demo** loads the new source and artifacts. A
stale revision is refused while the browser draft remains downloadable.

Before sending a build, the browser persists a unique submission ID, exact source
files and base revision in localStorage. Reload reconnects to that submission or
an active server build. Network failures never trigger an automatic repeated
POST: **Check build status** reconciles the same ID, and **Retry same submission**
explicitly retries that ID if the server has not registered it. The server owns
idempotency. Editing and compiling stay locked while a submission is active or
uncertain, so later edits cannot be mistaken for the submitted build. Terminal
failures retain the draft for correction. Applying is unavailable if browser
storage cannot preserve this recovery record; browser preview still works.
