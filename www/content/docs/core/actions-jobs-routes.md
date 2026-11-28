---
uid: zr_cafaa9320a72607c6f4f
title: Queries, Mutations, Jobs, Hooks & HTTP Routes
description: Server functions with query() and mutation(), Action Scheduler jobs, transactional hooks, custom routes, connectors, and file buckets.
order: 3
status: published
publishedAt: 2026-11-21T09:06:00.000Z
---
## Server functions

Export `query(options, handler)` for a function that reads and `mutation(options, handler)` for one that writes. The input is the handler's parameter type: the server validates it before the handler runs. Any `.ts` file under `sp/` outside the reserved folders (`app/`, `components/`, `wp-hooks/`, `content/`, `public/`, `dist/`, `_generated/`, `node_modules/`) can export them; `sp/server.ts` is the usual place.

```ts
// sp/server.ts
import { mutation, query } from "spacepress";
import { db, HttpError } from "spacepress/server";
import { tasks } from "./schema";

export const openTasks = query({ access: "authenticated" }, async ({ limit }: { limit?: number }) => {
  return await db.query.tasks.findMany({ where: { done: false }, limit: limit ?? 20 });
});

export const completeTask = mutation({ access: "authenticated", idempotent: true }, async ({ id }: { id: number }) => {
  const [row] = await db.update(tasks).set({ done: true }).where({ id }).returning();
  if (!row) throw new HttpError(404, "not_found", "Task not found");
  return row;
});
```

| Option | On | What it does |
|---|---|---|
| `access` | both | Who may call it. Default `"editor"`. A function rule can run read-only queries; see [access rules](/docs/core/queries-and-access#declarative-access-rules). |
| `rateLimit` | both | Calls per user (or per address when signed out), such as `"10/min"`. A mutation open to `"anyone"` defaults to `"30/min"`; `false` turns it off. |
| `agents` | both | Publish it as an Ability agents can discover. Default `true`. |
| `idempotent` | mutation | Safe to retry with the same input. |
| `destructive` | mutation | Deletes or overwrites data; agents confirm before calling it. |
| `signature` | mutation | Verify a signed webhook (`{ secret, header, scheme }`) instead of an access rule. |

A query may not write, in its own body or in anything it calls; the build refuses it. A mutation runs in one database transaction: a throw rolls back its writes, its queued jobs and its queued mail.

Every function is also a WordPress Ability, `<app>/<kebab-name>`. Islands and the typed client call it through `api.actions.<name>` and core's run route; see [Typed Clients](/docs/integrations/astro-and-clients#how-calls-reach-wordpress). A page form posts to it directly; see [Forms that post to an action](/docs/core/pages-and-islands#forms-that-post-to-an-action). Its HTTP endpoint on the app API is `POST /wp-json/spacepress/v1/actions/<name>` (a query also accepts `GET`).

## Node built-ins

Server handlers can import `node:buffer`, `node:crypto`, `node:events`, `node:path`, `node:querystring`, `node:string_decoder`, `node:util`, and `node:zlib`. The bare module names work too. Use `crypto.subtle` and `crypto.getRandomValues` for Web Crypto.

```ts
import { query } from "spacepress";
import { createHash } from "node:crypto";

export const checksum = query({}, ({ text }: { text: string }) => {
	return createHash("sha256").update(text).digest("hex") as string;
});
```

Module results are checked JavaScript values. Use a scalar assertion such as `as string` to check a value in typed code. Encode bytes as hex or base64 before returning them from a handler.

RSA-PSS and OAEP digests other than SHA-1 require PHP 8.5. The compatibility reference lists the supported operations, input limits, and differences from Node. [Tested compiler compatibility](/docs/reference/language-support#node-modules)

<Note title="action() and jobs are gone">
`action()` is refused: use `query()` when the function only reads and `mutation()` when it writes. `import { jobs } from "spacepress"` is refused too: queue a job through its own export, as below.
</Note>

## Background jobs

Export `job(options, handler)` and queue it with `theJob.enqueue(input, { delay, key })`:

```ts
import { cron, job, mutation } from "spacepress";
import { db, once } from "spacepress/server";
import { tasks } from "./schema";

export const summarize = job({ retries: 5 }, async ({ id }: { id: number }) => {
  await once(`summary:${id}`, async () => {
    const res = await fetch(`https://api.example.com/summaries/${id}`);
    return res.status;
  });
});

export const addTask = mutation({ access: "authenticated" }, async ({ title, project }: { title: string; project: number }) => {
  const [row] = await db.insert(tasks).values({ title, project }).returning();
  if (row) await summarize.enqueue({ id: row.id }, { delay: 60, key: `summary-${row.id}` });
  return row;
});

export const nightly = cron("0 3 * * *", async () => {
  await summarize.enqueue({ id: 0 });
});
```

- Jobs run on WordPress Action Scheduler. `enqueue` joins the caller's transaction: the job runs after commit, and a rollback drops it.
- `delay` is in seconds. A `key` collapses duplicates that are still waiting.
- `retries` defaults to 3 (0 to 20). Wrap side effects in `once(key, fn)` so a retry doesn't repeat them.
- `every: "1h"` on a job also runs it on that schedule (s, m, h, d or w; at least a minute). `cron("0 3 * * *", handler)` runs a job on a five-field UTC schedule.
- `fetch()` in a job may take 60 seconds and read up to 16 MiB. In request handlers the limits are 10 seconds and 1 MiB.
- Jobs aren't Abilities unless you set `agents: true`.

## Transactional hooks & WordPress hooks

- Chain `.on({ beforeCreate, afterCreate, beforeUpdate, afterUpdate, beforeDelete, afterDelete, beforeRestore, afterRestore, beforePurge, afterPurge, afterPublish })` onto a collection or table. Hooks run inside the write's transaction; a throw aborts the request and rolls it back.
- Put typed WordPress core actions and filters in `sp/wp-hooks/<hook>.ts`, each default-exporting a `Handler<"<hook>">` from `"spacepress/server/wp"`.

## Custom HTTP routes

Create `sp/app/<path>/route.ts` exporting `GET`, `POST`, `PUT`, `PATCH` or `DELETE` handlers, plus `export const guard` (an access rule) or `export const signature` (a signed webhook):

```ts
// sp/app/api/schedule/route.ts
import { db } from "spacepress/server";
import type { RouteRequest, RouteResponse } from "spacepress/app";

export const guard = "anyone";

export async function GET(request: RouteRequest): Promise<RouteResponse> {
  const limit = Number(request.query.get("limit") ?? "10");
  const rows = await db.query.events.findMany({ where: { status: "published" }, limit });
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(rows) };
}
```

## Connectors

`connectors` from `"spacepress/server"` calls a tool the host manages, such as a Space's Slack or GitHub connection. Credentials stay with the host; the app names a role and a tool.

- `await connectors.call(role, tool, args?)` calls it now and returns its answer.
- `await connectors.enqueue(role, tool, args?, { key?, delay? })` queues the call in the current transaction. It runs after commit, outside any transaction, and retries with backoff. A queued call runs at least once and may repeat.

The host answers through the `sp_connectors_call` filter; see the [Host Contract](/docs/reference/host-contract). Without a host that handles it, a call fails with `503`.

## Private files

Define a private upload bucket with `files({ accept, maxBytes, access })`. Files live on local disk or in S3-compatible storage (`uploads: { backend: "s3", ... }` in `defineConfig()`).

```ts
import { files } from "spacepress";

export const attachments = files({
  accept: ["application/pdf", "image/*"],
  maxBytes: 10_000_000,
  access: { create: "authenticated", read: "authenticated" },
});
```

- Islands upload with [`uploadFile("attachments", file)`](/docs/core/pages-and-islands#upload-a-file-from-an-island); external clients use `client.files.attachments.upload(file)`.
- Loading a `file(bucket)` column through `with` gives a signed URL that lasts 5 minutes.
- Hooks, queries, mutations, routes and jobs read files directly: `await attachments.get(id)` returns the metadata and a signed URL (or `null`), `await attachments.readText(id)` the UTF-8 text, and `await attachments.readBase64(id)` the bytes as base64, up to 16 MiB. Access rules can't read files.
