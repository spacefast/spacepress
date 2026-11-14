# The application API: hooks, server functions, errors, routing and live data

Date: 2026-11-14. Status: accepted. Spec: [spec.md](../spec/spec.md) §2–§4,
[rendering.md](../spec/rendering.md) §1 and §4.4.

These rulings come after [the authoring-surface rulings](2026-11-11-authoring-surface.md) and replace the ones they
name. Work already open when they were made merges as it is. Each ruling below that changes code is
built as its own change on top of `main`, and that change deletes the form it replaces. There are no
compatibility forms: no released First project uses the old ones.

## Problem

First was compared with Convex, Supabase, EmDash, Astro and Payload, using what each system's own
documentation says it does:

| | Taken | Avoided |
|---|---|---|
| Convex | Read functions and write functions are separate, typed end to end, and reads can be subscribed to. A change trigger gets `{ operation, oldDoc, newDoc }`. Side effects are scheduled only if the write commits | Access checks written by hand in every function; triggers that writes from the dashboard skip |
| Supabase | Rules and triggers fire on every write path. Row rules filter; webhooks run after commit | Logic split between SQL, edge functions and the client |
| EmDash | The editor workflow: drafts, revisions, scheduling, preview, and plugins with declared capabilities | The database as the only schema source |
| Astro | Pages, endpoints named by their file, forms that work without JavaScript, per-page prerendering | No data layer |
| Payload | Hooks declared on the collection; access functions that return a filter | A server API that skips access rules unless told not to |

First compiles TypeScript, so it can derive validators and agent tool schemas from handler types.
It runs on WordPress, where the editor, core REST and other plugins also write. It serves through
PHP and Batcache, where a read that is known to be read-only can be cached. The rulings follow from
those three facts.

## Hooks

1. **`kind.on(event, handler)`, one handler per call.** It returns the kind, so calls chain. A kind
   may have several handlers for one event; they run in the order they were added. `.on()` may be
   called from any file that imports the kind, and a plugin package adds its hooks the same way.
   This replaces the object form `.on({ beforeCreate })`, ruling 18's limit to the declaring file,
   and `hooks` in `definePlugin`.

   ```ts
   export const posts = collection({ title: text().max(200), body: richText() })
     .on("beforeCreate", (data) => { data.title = data.title.trim(); })
     .on("change", async (c) => { await auditLog.system.create({ op: c.op, id: (c.after ?? c.before)!.id }); })
     .on("committed", async (c) => { if (c.op === "publish") await notifySubscribers.enqueue({ id: c.after!.id }); });
   ```

2. **Events.**

   | Event | Runs | May change data | A throw |
   |---|---|---|---|
   | `beforeCreate`, `beforeUpdate`, `beforeDelete` | before validation and the write | yes: mutate it or return a replacement | rejects the write |
   | `afterCreate`, `afterUpdate`, `afterDelete`, `afterPublish`, `afterUnpublish` | after the write, in its transaction | no | rolls the transaction back |
   | `change` | as the `after*` events, for every operation, with `{ op, before, after }` | no | rolls the transaction back |
   | `committed` | after commit, as an Action Scheduler action, retried | no | is retried; the write stays |

3. **Every write path runs every hook.** That includes the WordPress editor's saves, which today run
   only the `after*` hooks, and core's REST routes for First's kinds.

4. **Hooks run as the caller.** A hook's reads and writes apply the caller's access rules, like every
   other server function. `.system` is the only way to skip them.

   Today the answer depends on the API a hook calls. `db.*` is trusted: it sees every status and
   applies no access rules, in hooks and actions alike. The kind API (`posts.create`) runs as the
   caller, as ruling 17 of the authoring-surface record says. So rewriting `db.insert(...)` as
   `posts.create(...)` changes who the write runs as. The change that builds this ruling therefore,
   in order:

   1. lists every `db.*` call by where it runs: hook, action, page or job;
   2. rewrites hook and action bodies to `kind.system.*`, unless the code plainly meant the
      caller's rights;
   3. tests each rewritten hook as a signed-out visitor and as a subscriber;
   4. deletes `db.*` and the "trusted" wording together.

   A 0.3.0 capture keeps `db.*` trusted under the old reading (ruling 23 of the authoring-surface
   record), or a recompiled stored Space would change behaviour; `tests/zero_bundle.rs` proves it.

## Validation and errors

5. **One error shape.** A refused write answers `{ code, message, fields? }`, where `fields` maps a
   field name to its message. Field builders (`.max(200)`) and a kind's `check` produce it:

   ```ts
   collection({ ... }, { check: (row) => row.endsAt > row.startsAt ? null : { endsAt: "Ends before it starts" } })
   ```

   `check` runs on every write path, and the editor shows its messages on the fields.

## Server functions

6. **`query()` and `mutation()` replace `action()`.** Input types come from the handler's first
   parameter (ruling 15 stands). A `query` may only read: it can be cached, subscribed to, and is
   marked read-only for agents. A `mutation` runs in one transaction, accepts an idempotency key and
   purges the pages its writes changed. Default access stays `"editor"`. The client calls both by
   export name: `first.popular({ limit: 5 })`, `first.like({ id })`.

   ```ts
   export const popular = query({ access: "anyone" }, async ({ limit = 10 }: { limit?: number }) =>
     posts.list({ orderBy: { views: "desc" }, limit }));
   export const like = mutation({ access: "authenticated", rateLimit: "10/min" }, async ({ id }: { id: number }) => {
     const post = await posts.get(id);
     await posts.system.update(id, { views: post.views + 1 });
   });
   ```

7. **Forms.** A mutation can be a form's action and works without JavaScript:
   `<form action={first.createPost}>`. `useForm(first.createPost)` in a client component shows the
   field errors of ruling 5.

8. **Rate limits.** `rateLimit: "10/min"` on a mutation counts per user, or per address when signed
   out. A mutation open to `"anyone"` gets a default limit.

9. **One context.** Every server function, hook and route receives `ctx` with `user`,
   `can(op, kind, row?)`, `env`, and `request` in routes.

10. **Jobs and schedules.** `job(options, handler)` is queued with `digest.enqueue(input, { delay, key })`.
    `cron("0 3 * * *", handler)` and `job(options, handler)` with `every` repeat. All of them are
    Action Scheduler actions; First adds no queue runner. This replaces ruling 16's "calling a job
    enqueues it": a plain call reads as if it ran there and then.

11. **Old pages after a deploy.** A call to a function the new build removed or renamed answers
    `409 stale_client`, and the client reloads the page. `.was("oldName")` on a function keeps the
    old name answering for one release.

12. **Data migrations.** `export const backfill = migration(async () => { ... })` runs once per site,
    in Action Scheduler batches, and is recorded in the ledger. A deploy waits for it.

## Tools

13. **`first test`** runs an app's compiled PHP on SQLite WordPress, with `asUser(role)`, a clock the
    test sets, and a call that runs every queued job.
14. **`first logs [--fn name]`** reads the site's function logs, and the MCP server offers the same.

## Routing

15. **Pages stay as they are; endpoints may be files.** `page.tsx`, `layout.tsx`, `route.ts` and the
    folder rules stay: a file's name says what it does, and a route's folder holds everything for
    its URL. A file such as `app/feed.xml.ts` that exports `GET` also serves `/feed.xml`, without a
    `feed.xml/route.ts` folder.

## Live data

16. **One read API.** `posts.list(...)` in server code and pages, `first.posts.list(...)` in the
    browser, `first.popular(args).subscribe(fn)` and `useQuery(first.popular, args)` to keep a read
    current. A `"use client"` component's `useQuery` starts from the server render's data.

17. **The transport is the host's.** First keeps `registerRealtimeTransport` in the browser and
    `First\Realtime\Publisher` in PHP. Without a transport, subscriptions poll `_live`. A Spacefast
    Space uses Cast. That is not wired for First builds yet: see
    [the host checklist](../spacefast-host-checklist.md), item 7.

18. **Co-editing.** First's collections are post types, so the Gutenberg plugin's real-time
    collaboration covers them, and it is what co-editing uses first. A transport that carries it over
    Cast instead of HTTP polling comes later. This replaces spec decision 6's "co-editing is out of
    scope".

## What this replaces

| Ruling or form | Replaced by |
|---|---|
| `.on({ beforeCreate })`, ruling 18's same-file limit | ruling 1 |
| `hooks` in `definePlugin` | `kind.on()` in the plugin |
| Hooks are trusted; `db.*` skips access rules | ruling 4, after `db.*` call sites move to `kind.system.*` |
| `action({ input, handler })`, `action(options, handler)` | `query()` and `mutation()` |
| Calling a job enqueues it, ruling 16 | `x.enqueue()` |
| Spec decision 6, co-editing out of scope | ruling 18 |
