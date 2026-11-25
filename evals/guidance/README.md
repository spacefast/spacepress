# SpacePress Guidance Evals

Lightweight compiler-backed eval harness for measuring how reliably coding agents write SpacePress apps using `/start.md`, `/rules.md`, `AGENTS.md`, and `skills/*/SKILL.md`.

Because `spacepress check --json` compiles a full project in under 50 ms with zero cloud accounts, every prompt case can be verified deterministically.

## Layout

- `cases.json` — canonical scenarios covering collections, SQL tables, `.was()` safe renames, row/field `.access()`, server actions, Action Scheduler jobs, headful TSX pages + `"use client"` islands, WooCommerce storefronts, Markdown sync, and `capital_P_dangit` lint.
- `run.mjs` — writes each case's reference or candidate files to a temporary project and runs `spacepress check --json`.

## Running locally

```bash
# Verify the built-in reference solutions against the compiled Rust binary
node evals/guidance/run.mjs

# Or point to a specific binary
SPACEPRESS_BIN=./target/release/spacepress node evals/guidance/run.mjs
```

When an LLM fails a prompt in real use, add a minimal reproducer to `cases.json`, tighten `/rules.md` / `src/commands/init.rs` or the matching skill under `skills/`, and re-run.
