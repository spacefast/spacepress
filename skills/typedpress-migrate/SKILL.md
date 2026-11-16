---
name: typedpress-migrate
description: "Use when moving an existing app to TypedPress: converting a Zero 0.8 app with `typedpress migrate app`, or importing the schema of another CMS (EmDash, Payload, Sanity) with `typedpress migrate config`. Covers running the conversion, reading its report, and what the conversion does not do."
compatibility: "Targets TypedPress 0.3 (WordPress 7.2-beta5+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Migrate from Zero 0.8 or another CMS

## When to use

- The source is a Zero 0.8 app (a capsule directory), or a schema from EmDash, Payload or Sanity.

Both commands are experimental. They convert source and schema. They do not copy content, users
or files: a converted project that compiles is a starting point, not a finished migration.

## Inputs required

- The source: the Zero 0.8 capsule directory, or the other CMS's config or schema export.
- A destination that does not exist yet. Neither command writes over the source or over an
  existing destination.

## Procedure

### A Zero 0.8 app

1. Preview first. `--dry-run` writes nothing:

   ```sh
   typedpress migrate app --from zero-0.8 <capsule-dir> --out <new-dir> --fresh --dry-run --json
   ```

   The schema needs a table mode: `--fresh` for a site with no Zero 0.8 tables, or
   `--space <space-id>` to adopt the tables of an existing Spacefast Space.

2. Read the report: `status` is `dry-run` or `refused`, `entries` lists what was converted, and
   `errors` lists each refusal with a `code` (`Z08_…`), the `file`, `line` and `column` in the
   source, and a `fix`. Exit status 1 means refused. Resolve each refusal in the source or note
   it for porting by hand. Do not delete code to make a refusal go away.

3. Convert: the same command without `--dry-run`. `status` is `written`, and `<new-dir>` holds a
   TypedPress project (`typedpress.config.ts` and `tp/`).

### Another CMS's schema

1. Run the import, naming the source system and a new file:

   ```sh
   typedpress migrate config --from payload <payload.config.ts> --out <new-dir>/typedpress.config.ts
   ```

   `--from` is `emdash`, `payload`, `sanity` or `zero`.

2. Read the JSON report it prints: one entry per part of the schema, with a `pointer` into the
   source, an `outcome` and a `reason`. `mapped` became a TypedPress field. Read every entry with
   another outcome (`review`, `metadata`): its `reason` says what to check or what was left out.

### Then, for both

1. In the new project run `typedpress check` and fix what it reports. Then `typedpress init` for the
   agent files.
2. Review every access rule. The converter maps what the source declares; it cannot know who
   should be allowed to do what.
3. Port behaviour the schema does not carry (hooks, custom endpoints, front-end code) by hand.
   Copying content and users is not part of either command.

## Verification

- `typedpress check` exits 0 in the new project.
- The report's `errors` is empty, and every entry that is not `mapped` has been read.
- `typedpress dev` starts the site, and the kinds appear in wp-admin with the expected fields.

## Failure modes / debugging

- `output already exists`: neither command writes over anything. Choose a destination that does
  not exist yet.
- `Z08_SPACE_REQUIRED`: pass `--fresh` or `--space <space-id>` (see above).
- The command prints only its usage: an argument is missing. `typedpress help migrate app` and
  `typedpress help migrate config` print the arguments.
- An entry is not `mapped`: TypedPress has no equivalent, or the source uses a custom type. Choose a
  TypedPress field by hand; `docs_search` finds the builders.
- The converted project does not compile: fix it in the new project; the diagnostic names the
  construct.

## Escalation

- Moving a live site's content or users is a separate, owner-approved operation. Stop after the
  source conversion and report what remains.
- Never run a migration command with `--site` against a production site on your own.

Reference: `docs/config-migration.md` (EmDash, Payload, Sanity), `docs/migrating-from-zero.md` and
`docs/zero-08-parity.md` (Zero 0.8; in the repository, not served by `docs_read`).
