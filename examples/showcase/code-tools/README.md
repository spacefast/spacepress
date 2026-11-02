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

The launcher also copies the current compiler's `zero.wasm` and writes
`sources.json` alongside these files. Its manifest is:

```json
{
  "name": "showcase",
  "files": {"zero.config.ts": "complete TypeScript", "pantry.ts": "complete TypeScript"},
  "output": {"schema.php": "exact generated PHP", "functions.php": "exact generated PHP"},
  "previous": null,
  "migrationFiles": []
}
```

`files` contains every authored compiler input; `output` is a flat map of exact
build artifacts, including client TypeScript and migrations when available.
`previous` is the running build's migration snapshot, and `migrationFiles` lists
its SQL migration filenames. The browser passes both through to the compiler to
preview a migration from the running schema. No migration is executed.

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
