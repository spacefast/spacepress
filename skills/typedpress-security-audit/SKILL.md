---
name: typedpress-security-audit
description: "Use when auditing or hardening a TypedPress project's authorization and safety: checking collection/table access rules, field-level .access(), visitor-scoped typedpress:db vs trusted db, HTTP route guards, and WordPress Abilities readonly/destructive annotations."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Audit authorization and security

## When to use

- Before deploying a new app or after adding kinds, actions, or HTTP routes.
- When checking for data leaks, missing ownership filters, or unsafe write permissions.

## Inputs required

- The project's full surface from the `schema` tool of the `typedpress` MCP server (or `AGENTS.md`).
- Who should be allowed to read and mutate each kind, field, action, and route.

## Procedure

1. Inspect every kind's `access` matrix in `schema` (`read`, `create`, `update`, `delete`):
   - Flag unintended `"anyone"` write rules (`create`, `update`, `delete`).
   - Verify multi-tenant or per-user kinds return a row-level filter (for example `{ ownerId: user.id }`) rather than only checking `Boolean(user)`.
   - Verify private fields (emails, tokens, internal notes) declare field-level `.access()` so REST, pages, and clients strip them automatically.

2. Audit every `tp/app/**/page.tsx` and `tp/app/**/route.ts`:
   - Confirm visitor-facing reads import kinds from `"typedpress:db"` (which enforces `.access()` rules) instead of bypassing them with trusted `db` from `"typedpress"`.
   - Confirm custom `route.ts` handlers export an explicit `guard` (or verify webhook signatures before mutating data).

3. Audit every `action()` and `job()`:
   - Confirm `access` matches the least-privileged role needed and never trusts a client-supplied `userId` for ownership checks.
   - Annotate non-mutating actions with `readonly: true` and destructive ones with `destructive: true` for WordPress Abilities safety checks, or set `agents: false` on internal-only operations.

   ```ts
   // tp/security-example.ts
   import { table, text, integer, action, db, HttpError } from "typedpress";

   export const privateNotes = table({
     ownerId: integer(),
     body: text().min(1).max(2000),
     secretNote: text().optional().access({ read: "admin" }),
   }, {
     access: {
       read: ({ user }) => (user ? { ownerId: user.id } : false),
       create: "authenticated",
       update: ({ user }) => (user ? { ownerId: user.id } : false),
       delete: ({ user }) => (user ? { ownerId: user.id } : false),
     },
   });

   export const deletePrivateNote = action({
     input: { id: integer() },
     access: "authenticated",
     destructive: true,
     async handler({ id }, { user }) {
       if (!user) throw new HttpError(401, "unauthorized", "Sign in required");
       const [row] = await db.delete(privateNotes).where({ id, ownerId: user.id }).returning();
       if (!row) throw new HttpError(404, "not_found", "Note not found");
       return { deleted: row.id };
     },
   });
   ```

4. Check `defineConfig({ sealed: true })` and `tp/_generated/wp-plugins.lock.json` for production deployments that require locked third-party plugins.

## Verification

Run `typedpress check` and `typedpress doctor` to confirm every updated rule and route compiles with zero diagnostics.

## Failure modes / debugging

- **Empty query results for signed-out visitors:** Confirm the kind's `access.read` permits `"anyone"` when public pages read from `"typedpress:db"`.
- **Field missing in API response:** Check whether a field-level `.access()` rule restricts it for the caller's role.

## Escalation

Read `www/content/docs/core/queries-and-access.md` and `www/content/docs/operations/mcp-and-agents.md` via `docs_read`. If ownership rules or public visibility are ambiguous, ask the user before relaxing any permission.
