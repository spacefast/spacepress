---
name: typedpress-write-action
description: "Use when adding server logic to a TypedPress project: a `query()` or `mutation()` a client or agent calls (a computed read, a write), a `job()` that runs in the background after a request (send mail, recompute, call another service), or a `cron()` or repeating job."
compatibility: "Targets TypedPress 0.3 (WordPress 7.1+, PHP 8.2+). Requires the `typedpress` CLI and Node.js 22+."
---

# Write a query, a mutation or a job

## When to use

- A client needs to read or do something a plain list, create, update or delete on a kind cannot
  express: a `query()` when it only reads, a `mutation()` when it writes.
- Work should happen after the request returns, or be retried when it fails: a `job()`.
- Work should happen on a schedule: `cron("0 3 * * *", ...)` or `job({ every: "1h" }, ...)`.

## Inputs required

- The input fields and their types.
- Who may call it (`access`).
- The kinds it reads and writes: the `schema` tool, or `AGENTS.md`.

## Procedure

1. Export it from any file under `tp/` (by convention `tp/server/*.ts`). The export name is its
   name: the mutation `rate` is `POST /wp-json/typedpress/v1/actions/rate`, and the browser calls `rate()`.

   ```ts
   // tp/server/ratings.ts
   import { query, mutation, job, HttpError } from "typedpress";
   import { ratings } from "typedpress:db";

   export const rate = mutation({ access: "subscriber" },
     async ({ recipe, stars }: { recipe: number; stars: number }) => {
       if (stars < 1 || stars > 5) throw new HttpError(422, "invalid_input", "stars must be 1 to 5", "/stars");
       const row = await ratings.create({ recipe, stars });
       await verifyRating.enqueue({ id: row.id });
       return { id: row.id };
     });

   export const topRated = query({ access: "anyone" },
     async ({ limit = 10 }: { limit?: number }) =>
       await ratings.list({ orderBy: { stars: "desc" }, limit }));

   export const verifyRating = job({ retries: 3 }, async ({ id }: { id: number }) => {
     await ratings.system.update(id, { verified: true });
   });
   ```

2. The input is the handler's first parameter type. TypedPress validates the input against it,
   at every depth, before the handler runs: `number`, `string`, `boolean`, literal unions, and
   arrays and objects of those; `unknown` takes any JSON. An optional property (`limit?: number`)
   may be left out; give it a default in the destructuring. `T | null` must be sent. Checks beyond
   the type (a whole number: `Number.isInteger`, a length, a format) go in the handler: throw
   `new HttpError(422, "invalid_input", message, "/field")` so a form shows the message beside the
   field. The handler's return value is the response.

3. A `query()` may not write: the build refuses a write in it, or in anything it calls (a
   class, a WordPress function that writes, an ability that isn't read-only, a `fetch` that isn't
   a `GET`), at the line that writes. Its Ability is marked read-only, and no form posts to it. A
   `mutation()` runs in one transaction.

4. Import kinds from `"typedpress:db"`. In a query or mutation they read and write as the caller, so
   the kind's access rules apply: `list`, `get`, `count`, `paginate`, `create`, `update`, `delete`.
   Use `<kind>.system.*` only where the caller's rights must not limit the work. A job has no
   caller and always runs as the system.

5. Options: `access` (default `"editor"`), `rateLimit: "10/min"` (a mutation open to `"anyone"`
   gets `"30/min"` unless it says otherwise), `agents: false` to keep it off the site's MCP
   endpoint. A mutation also takes `destructive: true` when it deletes or overwrites, and
   `idempotent: true` when a repeat with the same `Idempotency-Key` must not run twice.

6. Handlers compile to PHP. Write plain TypeScript: no Node.js APIs, no dynamic `require`. Run
   `typedpress check` after each edit and fix what it reports before writing more.

7. `verifyRating.enqueue(input, { delay, key })` queues a job from a mutation, a hook or another
   job. It runs after the request commits, never inside it, and is retried up to `retries` times
   when the handler throws. `key` collapses duplicates that are still waiting. A `cron()` or
   `every` job runs on Action Scheduler on its schedule, with no input.

## Verification

- `typedpress check` exits 0, and the `schema` tool lists the function with its endpoint and input.
- With the dev site running: `typedpress action rate '{"recipe":1,"stars":5}'` answers `{"data":…}`.
- `typedpress jobs list` shows queued jobs; `typedpress wp action-scheduler run --hooks=tp_job` runs
  them now. Scheduled jobs are `tp_job_schedule` actions in Tools > Scheduled Actions.

## Failure modes / debugging

- `F4001`: the handler does not type-check or uses something outside the supported subset. The
  message names the construct; `docs_search` finds the supported form.
- "is a query, so it can't write": make it a `mutation()`, or move the write into a job.
- `Unknown action` from `typedpress action`: the dev site runs the last build. Start `typedpress dev`
  (it rebuilds on save) or run `typedpress build`.
- A 403 from the endpoint and none from `typedpress action`: the command line is trusted; the endpoint
  applies `access`. Check the rule and who is signed in. A 429 is the rate limit.

## Escalation

- A mutation that takes money, sends mail to real people or deletes data: confirm the access rule
  and the `destructive` flag with the owner before it ships.

Reference: `www/content/docs/core/actions-jobs-routes.md`, `www/content/docs/core/queries-and-access.md`, and
`www/content/docs/reference/language-support.md`.
