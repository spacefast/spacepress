---
name: typedpress-fix-diagnostic
description: "Use when `typedpress check`, `typedpress build` or `typedpress dev` reports a compiler diagnostic in a TypedPress project (an `F` code such as F1002 or F4001, or a message with `file:line:col`), or after any edit to `typedpress.config.ts` or `tp/`, to read the diagnostic and fix its cause."
compatibility: "Targets TypedPress 0.3 (WordPress 7.2-beta5+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Fix a TypedPress compiler diagnostic

## When to use

- `typedpress check`, `typedpress build` or `typedpress dev` printed an error.
- You edited `typedpress.config.ts` or a file under `tp/` and need to know it still compiles.

TypedPress compiles TypeScript to PHP. It accepts a documented subset, so code that type-checks in an
editor can still be refused. The diagnostic says what was refused and usually how to write it instead.

## Inputs required

- The project directory: the one that holds `typedpress.config.ts`.

## Procedure

1. Get the diagnostics as data. With the `typedpress` MCP server, call the `check` tool. Otherwise:

   ```sh
   typedpress check --json
   ```

   Exit status 0 means no diagnostics, 1 means at least one, 2 means the command line was wrong.

2. Read each entry of `diagnostics`:
   - `code`: the kind of problem. `F1001` is a syntax error, `F1002` a construct outside the
     supported subset, `F1003` an import that does not resolve, `F2001` a failure while the config
     was evaluated (an unknown builder or modifier is one), `F3001` an invalid schema (an unknown
     kind option, a field rule that cannot hold), `F4001` a handler that does not type-check or
     compile.
   - `message` and `help`: what is wrong, and the fix when the compiler knows one. Apply `help` first.
   - `location`: `file`, `line` and `column` (both one-based), relative to the project.
   - `groups` collects the same message at several locations: fix every site of a group the same way.

3. Open the file at the location and fix the cause, not the symptom:
   - A refused construct (`F1002`, or a more specific code): rewrite it in the supported subset. Look
     the code or the construct up with `docs_search`, or read `docs/language-support.md`.
   - An unknown builder or modifier (`F2001`, "\"typedpress\" has no export named …" or no method of
     that name) or an invalid kind option (`F3001`): TypedPress has no such API. Read
     `docs/config-api.md` for the builders and their modifiers.
   - `F1210`: a file under `tp/` imports from outside `tp/`. Move the imported file in.
   - `F1221`: two exports share a name, or a kind, action or job is a default export. Rename one.

4. Check again. Lowering reports every independent failure at once, but evaluation, schema
   extraction and type checking stop at their first error, so a fix can reveal the next diagnostic.
   Repeat until `ok` is `true`.

## Verification

```sh
typedpress check
```

It prints `ok:` with a count of what the project declares, and exits 0.

## Failure modes / debugging

- `no typedpress.config.ts in <dir>`: the command ran in the wrong directory. Pass the project directory:
  `typedpress check <dir>`.
- A diagnostic with `location: null` is about the project as a whole (a missing file, an old layout).
  Its `message` and `help` name the path to change.
- The same diagnostic after a fix: the edit went to a copy. `tp/_generated/` and `tp/dist/` are
  written by `typedpress build`; never edit them.
- An editor shows no error but TypedPress refuses the code: TypedPress's subset is narrower than TypeScript.
  The diagnostic is right; the editor checks types only.

## Escalation

- If the diagnostic names a construct the documentation lists as supported, or the message is an
  internal error, stop and report the code, the message and the smallest source that reproduces it.
- Do not work around a refusal by moving code into `tp/_generated/` or by disabling a check.

Reference: `docs/compiler-diagnostics.md` (the envelope and the codes), `docs/language-support.md`
(what the compiler accepts, with a fixture for each refusal).
