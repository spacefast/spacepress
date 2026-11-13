---
name: first-add-kind
description: "Use when adding or changing data in a First project: a new kind (`collection()` or `table()`), a new field on a kind, a reference between kinds with `ref()`, an access rule, or a renamed or removed field."
compatibility: "Targets First 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `first` CLI and Node.js 22+."
---

# Add a kind or a field

## When to use

- The app needs to store something new, or an existing kind needs another field.
- A field or kind is renamed or removed, or who may read or write it changes.

## Inputs required

- What is stored, and whether editors write it in the WordPress editor (`collection()`) or the
  app writes rows itself (`table()`).
- Who may read, create, update and delete it.
- The project's current kinds: the `schema` tool of the `first` MCP server, or `AGENTS.md`.

## Procedure

1. Pick the builder. `collection()` is a WordPress post type: block editor, drafts, revisions.
   `table()` is a SQL table for rows the app owns (likes, orders, ratings).

2. Export the kind from a file under `first/` (by convention `first/schema.ts`). The export name is
   the kind's name everywhere: the API path, the typed client, `first:db`.

   ```ts
   // first/schema.ts
   import { collection, table, text, integer, boolean, richText, select, slug, ref } from "first";

   export const recipes = collection({
     title: text().max(160),
     slug: slug({ source: "title" }),
     body: richText().optional(),
     difficulty: select(["easy", "medium", "hard"]).default("easy"),
   }, { access: { read: "anyone", create: "author", update: "editor", delete: "editor" } });

   export const ratings = table({
     recipe: ref(recipes).onDelete("cascade"),
     stars: integer().min(1).max(5),
     verified: boolean().default(false),
   }, { access: { read: "anyone", create: "subscriber" } });
   ```

3. Follow the field rules:
   - A field is required unless it has `.optional()` or `.default(value)`.
   - Every kind has an integer `id`; do not declare one.
   - `ref(kind)` holds another kind's `id`. The field name is also the relation name:
     `with: { recipe: true }` loads the row.
   - An access rule is `"anyone"`, `"authenticated"`, a role (`"subscriber"`, `"author"`,
     `"editor"`, `"admin"`: that role or higher), or a function. Without `access`, anyone reads and
     an editor writes.

4. To add a field to a kind that already has rows, make it `.optional()` or give it a `.default()`.
   A new required field with no default is refused at deploy when rows lack it.

5. To rename a `table()` field keep its data with `.was("oldName")`. To remove a field or kind
   that holds rows, the deploy needs the row count: `first migrate --drop=<kind>=<rows>`. On the
   local dev site, `first dev --allow-destructive` passes it once.

6. Run `first check`, then `first build`. The build writes the SQL change to
   `first/_generated/migrations/` and the types to `first/_generated/db.d.ts`. Commit both; never
   edit them.

## Verification

- `first check` exits 0.
- The `schema` tool (or `first check --json`, under `indexes`) shows the kind and its fields.
- With the dev site running, `first find <kind>` answers `{"data":[…]}` for the new kind.

## Failure modes / debugging

- `F1221`: the export name is already a kind, action or job. Export names are unique in the app.
- `"first" has no export named …`: the builder or modifier is not one First has. Search the
  documentation with `docs_search` before guessing a name.
- `first dev` refuses a save with "Local data was preserved": the change would drop or narrow
  stored data. Check the change is intended, then restart once with `--allow-destructive`.
- A deploy answers `schema_refused`: read each refusal's `fix`; it names the exact `--drop` value.

## Escalation

- Never pass `--drop` or `--allow-destructive` to a site that is not a local dev site without
  the owner's explicit decision: it deletes rows.

Reference: `docs/config-api.md`, sections "Columns", "Collections, tables and user projections",
"Relations", "Access" and "Schema changes at deploy".
