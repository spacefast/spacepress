---
uid: zr_cafaa9320a72607c6f4f
title: Actions, Jobs, Hooks & HTTP Routes
description: Server RPC actions, Action Scheduler background jobs, transactional hooks, custom routes, and file buckets.
order: 3
status: published
publishedAt: 2026-11-21T09:06:00.000Z
---
## Server functions

Export `query(options, handler)` for reads and `mutation(options, handler)` for writes. Both accept validated input and are available to client code and WordPress Abilities.

```ts
import { mutation } from "spacepress";
import { HttpError } from "spacepress/server";
import { tasks } from "spacepress/server/db";

export const archiveTask = mutation({ access: "editor", idempotent: true }, async ({ id }: { id: number }) => {
  const row = await tasks.update(id, { done: true });
  if (!row) throw new HttpError(404, "not_found", "Task not found");
  return row;
});
```

Call the mutation at `POST /wp-json/spacepress/v1/actions/archiveTask`. Queries are marked read-only. Set `destructive: true` on destructive mutations or configure `signature` to verify a webhook.

## Background jobs

- Export `job(options, handler)` and call `myJob.enqueue(input, { delay, key })`, with optional delay and deduplication key. Jobs run in WordPress Action Scheduler with relaxed outbound `fetch()` limits (60s timeout and 16 MiB body cap vs. 10s / 1 MiB in HTTP handlers). Enqueueing commits with the enclosing database transaction. Use `retries` for retries and `once(key, fn)` to guard side effects. Set `every: "1h"` on a job or export `cron("0 3 * * *", handler)` for recurring work.

## Transactional hooks & WordPress hooks

- Chain `.on({ beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete, afterPublish })` onto any collection or table. Throwing aborts the request and rolls back the transaction.
- Place typed WordPress core filters/actions in `sp/wp-hooks/<hook>.ts` using `Handler<"...">` from `"spacepress/server/wp"`.

## Custom HTTP routes & private files

- Create `sp/app/<path>/route.ts` exporting `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` plus `export const guard`.
- Define private upload buckets with `files({ accept, maxBytes, access })` backed by local disk or S3-compatible storage (`uploads: { backend: "s3", ... }`). Loading a `file(bucket)` column via `with` yields a 5-minute signed URL. Server hooks, actions, routes, and background jobs can read files directly via `await bucket.get(id)`, `await bucket.readText(id)`, and `await bucket.readBase64(id)` (up to 16 MiB).
