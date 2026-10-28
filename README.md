# Zero

A framework that takes a `zero.config.ts` (Drizzle-style collections, relations,
hooks, and actions) and compiles it with Rust into a plain PHP app. Rust runs only
at build time. At runtime it's all PHP, with no JS engine.

**Status: work in progress.** None of this is usable yet.

## How it works

1. **Parse.** [oxc](https://oxc.rs) parses `zero.config.ts` and the local files it imports.
2. **Lower.** The syntax tree is lowered into Zero's own IR. Anything outside the
   supported subset fails the build with `file:line:col` and a suggested fix.
3. **Evaluate.** The config runs in a small Rust evaluator over the IR, so
   composition works: helper functions, spreads, and shared field sets. The result
   is the schema as plain data.
4. **Compile.** Hooks and actions are carried through evaluation without being
   called, then compiled to PHP.
5. **Emit.** The output is migrations, `schema.php`, `functions.php`, and a
   hand-written PHP runtime (database access, REST API, hook pipeline, JS-semantics
   helpers).

## Docs

- [`docs/config-api.md`](docs/config-api.md): the `zero.config.ts` API and the
  enforced subset
- [`docs/runtime-contract.md`](docs/runtime-contract.md): the boundary between
  compiler output and the PHP runtime

## Example

[`examples/pantry`](examples/pantry) is a home pantry tracker: locations, items,
and a shopping list that fills itself when stock runs low.

## Layout

- `src/diag.rs`: located build errors
- `src/ir.rs`: the IR
- `src/lower.rs`: oxc AST → IR, enforcing the subset
- `src/loader.rs`: module graph and import rules
- `src/schema.rs`: the evaluated schema
- `src/num.rs`: JavaScript number formatting
