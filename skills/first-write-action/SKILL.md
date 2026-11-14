---
name: first-write-action
description: "Use when adding server logic to a First project: an `action()` a client or agent calls (a mutation, a computed read), or a `job()` that runs in the background after a request (send mail, recompute, call another service)."
compatibility: "Targets First 0.3 (WordPress 7.2-beta5+, PHP 8.2+). Requires the `first` CLI and Node.js 22+."
---

# Write an action or a job

## When to use

- A client needs to do something a plain create, update or delete on a kind cannot express.
- Work should happen after the request returns, or be retried when it fails: a job.

## Inputs required

- The input fields and their types.
- Who may call it (an action's `access`).
- The kinds it reads and writes: the `schema` tool, or `AGENTS.md`.

## Procedure

1. Export the action or job from any file under `first/` (by convention `first/server/*.ts`). The
   export name is its name: the action `rate` is `POST /__first/api/v1/actions/rate`.

   ```ts
   // first/server/ratings.ts
   import { action, job, jobs, integer } from "first";
   import { ratings } from "first:db";

   export const rate = action({
     input: { recipe: integer(), stars: integer().min(1).max(5) },
     access: "subscriber",
     async handler({ recipe, stars }) {
       const row = await ratings.create({ recipe, stars });
       await jobs.verifyRating.enqueue({ id: row.id });
       return { id: row.id };
     },
   });

   export const verifyRating = job({
     input: { id: integer() },
     retries: 3,
     handler: async ({ id }) => {
       await ratings.system.update(id, { verified: true });
     },
   });
   ```

2. Declare `input` with the same field builders kinds use. First validates the input before the
   handler runs; the handler's return value is the response.

3. Import kinds from `"first:db"`. In an action they read and write as the caller, so the kind's
   access rules apply: `list`, `get`, `count`, `paginate`, `create`, `update`, `delete`. Use
   `<kind>.system.*` only where the caller's rights must not limit the work. A job has no caller
   and always runs as the system.

4. Set the options that describe the action to agents: `readonly: true` when it only reads,
   `destructive: true` when it deletes or overwrites, `idempotent: true` when a repeat with the
   same `Idempotency-Key` must not run twice. Every action is also a WordPress Ability and a tool on
   the site's MCP endpoint unless it sets `agents: false`.

5. Handlers compile to PHP. Write plain TypeScript: no Node.js APIs, no dynamic `require`. Run
   `first check` after each edit and fix what it reports before writing more.

6. `jobs.<name>.enqueue(input)` queues a job from an action or hook. It runs after the request
   commits, never inside it, and is retried up to `retries` times when the handler throws.

## Verification

- `first check` exits 0, and the `schema` tool lists the action with its endpoint and input.
- With the dev site running: `first action rate '{"recipe":1,"stars":5}'` answers `{"data":…}`.
- `first jobs list` shows queued jobs; `first wp action-scheduler run --hooks=first_job` runs
  them now.

## Failure modes / debugging

- `F4001`: the handler does not type-check or uses something outside the supported subset. The
  message names the construct; `docs_search` finds the supported form.
- `Unknown action` from `first action`: the dev site runs the last build. Start `first dev` (it
  rebuilds on save) or run `first build`.
- A 403 from the endpoint and none from `first action`: the command line is trusted; the endpoint
  applies `access`. Check the rule and who is signed in.

## Escalation

- An action that takes money, sends mail to real people or deletes data: confirm the access rule
  and the `destructive` flag with the owner before it ships.

Reference: `docs/config-api.md`, sections "Actions", "Jobs and webhooks", "Querying a kind" and
"The subset (enforced at build time)".
