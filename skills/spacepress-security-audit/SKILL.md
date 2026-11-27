---
name: spacepress-security-audit
description: "Use when auditing or hardening a SpacePress project's authorization and safety: checking collection/table access rules, field-level .access(), viewer-scoped db.<kind> vs db.system.<kind>, HTTP route access rules, and WordPress Abilities readonly/destructive annotations."
compatibility: "Targets SpacePress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `spacepress` CLI and Node.js 22+."
---

# Audit authorization and security

## When to use

- Before deploying a new app or after adding kinds, actions, or HTTP routes.
- When checking for data leaks, missing ownership filters, or unsafe write permissions.

## Inputs required

- The project's full surface from the `schema` tool of the `spacepress` MCP server (or `AGENTS.md`).
- Who should be allowed to read and mutate each kind, field, action, and route.

## Procedure

1. Inspect every kind's `access` matrix in `schema` (`read`, `create`, `update`, `delete`):
   - Flag unintended `"anyone"` write rules (`create`, `update`, `delete`).
   - Verify multi-tenant or per-user kinds return a row-level filter (for example `{ ownerId: user.id }`) rather than only checking `Boolean(user)`.
   - Verify private fields (emails, tokens, internal notes) declare field-level `.access()` so REST, pages, and clients strip them automatically.

2. Audit every `sp/app/**/page.tsx` and `sp/app/**/route.ts`:
   - Confirm visitor-facing reads use viewer-scoped `db.<kind>` (which enforces `.access()` rules) instead of bypassing them with `db.system.<kind>`.
   - Confirm custom `route.ts` handlers export an explicit `access` rule (or verify webhook signatures before mutating data).

3. Audit every `query()`, `mutation()`, and `job()`:
   - Confirm `access` matches the least-privileged role needed and never trusts a client-supplied `userId` for ownership checks.
   - Use `query()` for read-only operations. Set `destructive: true` on mutations that delete or overwrite data. Set `agents: false` to keep internal operations off the MCP endpoint.

   ```ts
   // sp/security-example.ts
   import { table, f, mutation } from "spacepress";
   import { HttpError } from "spacepress/server";

   export const privateNotes = table({
     ownerId: f.integer(),
     body: f.text().min(1).max(2000),
     secretNote: f.text().optional().access({ read: "admin" }),
   }, {
     access: {
       read: ({ user }) => (user ? { ownerId: user.id } : false),
       create: "authenticated",
       update: ({ user }) => (user ? { ownerId: user.id } : false),
       delete: ({ user }) => (user ? { ownerId: user.id } : false),
     },
   });

   export const deletePrivateNote = mutation(
     { access: "authenticated", destructive: true },
     async ({ db, user }, { id }: { id: number }) => {
       if (!user) throw new HttpError(401, "unauthorized", "Sign in required");
       const existing = await db.privateNotes.get({ id, ownerId: user.id });
       if (!existing) throw new HttpError(404, "not_found", "Note not found");
       const row = await db.privateNotes.delete(existing.id);
       return { deleted: row.id };
     },
   );
   ```

4. Check `defineConfig({ sealed: true })` and `sp/_generated/wp-plugins.lock.json` for production deployments that require locked third-party plugins.

## Verification

Run `spacepress check` and `spacepress doctor` to confirm every updated rule and route compiles with zero diagnostics.

## Failure modes / debugging

- **Empty query results for signed-out visitors:** Confirm the kind's `access.read` permits `"anyone"` when public pages read from `db.<kind>`.
- **Field missing in API response:** Check whether a field-level `.access()` rule restricts it for the caller's role.

## Escalation

Read `www/content/docs/core/queries-and-access.md` and `www/content/docs/operations/mcp-and-agents.md` via `docs_read`. If ownership rules or public visibility are ambiguous, ask the user before relaxing any permission.
