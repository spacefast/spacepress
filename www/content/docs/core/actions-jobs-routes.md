---
uid: zr_cafaa9320a72607c6f4f
title: Actions, Jobs, Hooks & HTTP Routes
description: Server RPC actions, Action Scheduler background jobs, transactional hooks, custom routes, and file buckets.
order: 3
status: published
publishedAt: 2026-11-21T09:06:00.000Z
---
## Server actions

Export an `action()` to mount a validated endpoint at `POST /__tp/api/v1/actions/<name>` (and expose it to `"use client"` components and the typed client):

```ts
import { action, integer, HttpError, db } from "typedpress";

export const archiveTask = action({
  input: { id: integer() },
  access: "editor",
  idempotent: true,
  async handler({ id }) {
    const [row] = await db.update(tasks).set({ done: true }).where({ id }).returning();
    if (!row) throw new HttpError(404, "not_found", "Task not found");
    return row;
  },
});
```

Set `readonly: true` or `destructive: true` to annotate the generated WordPress Ability for AI agents, or `signature` to verify incoming HMAC webhooks.

## Background jobs

Export a `job()` and enqueue it with `jobs.<name>.enqueue(input, { delay?, key? })`. Jobs run asynchronously on WordPress Action Scheduler, commit atomically with the enclosing database transaction, support automatic `retries`, and can guard non-idempotent side effects with `once(key, fn)`.

## Transactional hooks & WordPress hooks

- Chain `.on({ beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete, afterPublish })` onto any collection or table. Throwing aborts the request and rolls back the transaction.
- Place typed WordPress core filters/actions in `tp/wp-hooks/<hook>.ts` using `Handler<"...">` from `"php/wordpress"`.

## Custom HTTP routes & private files

- Create `tp/app/<path>/route.ts` exporting `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` plus `export const guard`.
- Define private upload buckets with `files({ accept, maxBytes, access })` backed by local disk or S3-compatible storage (`uploads: { backend: "s3", ... }`). Loading a `file(bucket)` column via `with` yields a 5-minute signed URL.
