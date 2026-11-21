---
uid: zr_6ec3a08236a45b9f4e5f
title: Live updates
description: Reads that stay current without a reload.
order: 3
status: published
publishedAt: 2026-11-15T21:51:53.000Z
---
A page can keep a read current while other people write. Subscribe to it, and the callback gets
the result now and again each time it changes, always as the signed-in visitor reads it:

```ts
import { createClient } from "./tp/_generated/client/index.ts";

const first = createClient();
const stop = first.todos.list({ where: { done: false }, orderBy: { createdAt: "asc" } }).subscribe(
  (todos) => render(todos),
  (error) => report(error),
);
// later: stop();
```

Every read is a `Query`: `await` it for one answer, or `subscribe(onData, onError?)` to keep it
current. `list`, `paginate`, `get` and `count` all work the same way. A read is sent when it is
first awaited or subscribed to, not when it is made, so to run two at once, await them together
(`await Promise.all([first.posts.list(), first.authors.list()])`).

```ts
first.todos.count({ where: { done: false } }).subscribe((open) => badge(open));
first.todos.get(42).subscribe((todo) => show(todo), (error) => error.status === 404 && gone());
```

- A subscription refreshes after a write to its kind, to a kind it loads through `with`, or to a
  kind a relation filter in `where` looks into.
- Every subscription of a client travels in one request, however many there are. Two
  subscriptions to the same read share one.
- `onError` gets the problem of a read the server refuses, and network failures. The subscription
  continues. A `get` whose row is missing, or which the visitor may not read, is a 404.
- A write made through the same client (`create`, `update`, `delete`, an action) refreshes the
  subscriptions that read that kind as soon as it returns.
- A sign-in or sign-out refreshes every subscription, as the new visitor, also when another client
  on the same session storage made it. An answer to a request sent as the previous visitor is
  dropped.
- A subscriber whose callback (`onData` or `onError`) throws doesn't stop the others: the error is
  reported as uncaught (`reportError`), and the subscription continues.
- `paginate({ offset })` can be awaited but not subscribed to (`subscribe` throws): subscribe to a
  page by `cursor`.
- `first.todos.watch(query, onRows, onError?)` is `first.todos.list(query).subscribe(onRows, onError)`.

For a read that isn't a kind query, such as an action's result or a global, use the exported
`watch` helper with the kinds the read depends on. It re-runs the read itself:

```ts
import { createClient, watch } from "./tp/_generated/client/index.ts";

const first = createClient();
watch(first, ["todos"], () => first.actions.openCount(), (count) => badge(count));
```

## Optimistic updates

Show a write before the server has answered, and take it back if it fails:

```ts
const open = first.todos.list({ where: { done: false } });
const pending = open.optimistic((todos) => [...todos, { id: -1, title, done: false }]);
try {
  await first.todos.create({ title });
  pending.settle();   // kept until the server's next answer replaces it
} catch (error) {
  pending.rollback(); // subscribers get the server's data back
}
```

The update applies to what subscribers of that read are shown, and to the read's first answer
when it hasn't arrived yet. It changes nothing on the server, and it does nothing when no one is
subscribed to the read.

## How fresh

|                                        | Another visitor's write shows after    | Your own write shows after |
|----------------------------------------|----------------------------------------|----------------------------|
| No transport (plain WordPress hosting) | 2 to 30 seconds                        | one request                |
| A transport, live                      | the notice's delivery plus one request | one request                |
| A hidden tab                           | when it is shown again                 |                            |

Without a transport the client asks on an interval that adapts: 2 seconds after a change, half as
long again after each answer that changed nothing, up to 30 seconds, each wait jittered by 20%.
Errors double the wait. A hidden tab does not ask at all, and asks once when it is shown again.
That includes a page opened in a background tab or prerendered: a subscription made there sends
nothing until the page is shown (a seed is shown at once). A page restored from the back/forward
cache asks again, since it may have been frozen for a long time.

This is not a socket. On hosting without a push transport, another visitor's write never shows in
under about two seconds, and a quiet page can be 30 seconds behind. If you need updates faster
than that, your host has to supply a transport.

## React hooks, for a React frontend outside TypedPress

TypedPress's own pages (`tp/app/`) never run React: they compile to PHP and the Interactivity API,
and keep data live with `<Live>` and `useLive`. The hooks here are for a React app that runs
somewhere else and uses TypedPress as its backend: Next.js, TanStack Start, an Astro island, Vite.

`typedpress build` writes them to `tp/_generated/client/react.ts`. The file imports nothing from
`"react"`. You hand it your React, so a project that never imports it needs no React, and the
hooks use the React your app already bundles:

```tsx
// first.ts
import * as React from "react";
import { createClient } from "./tp/_generated/client/index.ts";
import { createHooks } from "./tp/_generated/client/react.ts";

export const first = createClient({ url: "https://example.com/wp-json/typedpress/v1" });
export const { useQuery, useMutation } = createHooks(React);
```

```tsx
function Todos() {
  const open = first.todos.list({ where: { done: false }, orderBy: { createdAt: "asc" } });
  const todos = useQuery(open);
  const add = useMutation((title: string) => first.todos.create({ title }), {
    optimistic: (apply, title) => apply(open, (rows) => [...rows, { id: -1, title, done: false }]),
  });

  if (todos.loading) return <p>Loading…</p>;
  if (todos.error) return <p>{todos.error.detail}</p>;
  return (
    <>
      <ul>{todos.data?.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
      <button disabled={add.pending} onClick={() => add.mutate("Buy milk")}>Add</button>
    </>
  );
}
```

- **`useQuery(read, options?)`** subscribes to a read and returns `{ data, error, loading }`. Build
  the read inline: it is re-subscribed only when the call or its arguments change. `data` is kept
  while a later refresh fails on the network, and cleared when the server refuses the read (401,
  403, 404), as after a sign-out. Pass `null`, or `{ enabled: false }`, to subscribe to nothing.
  `{ seed: { token, data } }` shows a server-rendered answer at once.
- **`useMutation(write, options?)`** returns `{ mutate, pending, error, reset }`. `optimistic` runs
  before the write is sent; each `apply(read, update)` changes what subscribers of that read are
  shown. When the write succeeds the change stays until the server's answer replaces it. When it
  fails the change is taken back and `mutate` rejects with the error.
- Every `useQuery` on a page shares one request to the server, and a render happens only when a
  result changed.
- React 18 and later. The hooks use `useSyncExternalStore`, so they are safe under concurrent
  rendering and render the seed, or the loading state, on the server.

Freshness is the client's: 2 to 30 seconds for another visitor's write without a push transport,
one request for your own.

## Transports

TypedPress ships no realtime transport. A host delivers change notices with one. While it is live, a
notice refreshes the subscriptions that read the kinds it names at once, and the interval becomes
a slow safety poll.

```ts
import { createClient, registerRealtimeTransport, type RealtimeTransport } from "./tp/_generated/client/index.ts";

const transport: RealtimeTransport = {
  connect(deliver, status) {
    const socket = new WebSocket("wss://relay.example/tp");
    socket.onopen = () => status("live");
    socket.onclose = () => status("down");
    socket.onmessage = (event) => deliver(JSON.parse(event.data));
    return () => socket.close();
  },
};

createClient({ realtime: { transport } });  // this client only
registerRealtimeTransport(transport);        // every client on the page, including ones created earlier
```

| Option                | Default             | Meaning                                                                                                                              |
|-----------------------|---------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `realtime.pollMs`     | adaptive, 2 to 30 s | `{ min, max }` sets the bounds in milliseconds, a number a fixed interval, `false` turns polling off                                 |
| `realtime.livePollMs` | 60000               | the safety poll while the transport is live, jittered ±20%; a notice lost in transit costs at most that delay; `false` turns it off |
| `realtime.transport`  | the registered one  | `false` turns the transport off                                                                                                      |

A client connects its transport only while something is subscribed. When the transport goes from
down to live, subscriptions refresh once to catch up. A notice only says which kinds to ask
about: the data always comes from the visitor's own read.

Spacefast's Cast transport does not register for TypedPress builds yet: its engine still runs the 0.3.0
compiler, and the names it uses are the 0.3.0 ones
(host checklist, item 7). Until that changes, subscriptions on
Spacefast poll like on any other host.

## Server side: the subscription endpoint

Polling without a transport does not repeat each read. One request, `POST /wp-json/typedpress/v1/_live`,
carries every read a page is subscribed to with the token of the answer it last got, and answers
each with "not modified" or the fresh result, evaluated as the caller:

```http
POST /wp-json/typedpress/v1/_live
{ "queries": [{ "kind": "todos", "op": "list", "args": { "where": { "done": false } }, "token": "…" }] }

{ "data": { "results": [{ "changed": false, "token": "…" }], "poll": { "minMs": 2000, "maxMs": 30000 } } }
```

`op` is `list`, `paginate`, `get` or `count`, with the arguments of that call on a kind. A result
is `{ changed: true, token, data }`, `{ changed: false, token }`, `{ error }` (the read's problem
document) or `{ pending: true }` (the request ran out of time; ask again). A request takes at most
20 queries. Tokens are opaque: keep the latest one per query and send it back.

TypedPress keeps a change counter per kind, written in the same transaction as every write through its
write path, including wp-admin and core REST saves of your kinds. A read whose kinds the caller
may read in full is answered from the counters without running. Any other read (a kind with a
field hidden from the caller, a rule that gives them only some rows) runs on each poll and is
compared with what the caller last got, so an answer never says that something changed which the
caller may not read. A write made outside TypedPress's write path, such as another plugin's SQL, is
seen within five minutes.

PHP code can ask the same question without HTTP, for example to render a read and hand its token
to the browser:

```php
$results = \TypedPress\Live\Module::evaluate($db, $viewer, [['kind' => 'todos', 'op' => 'list', 'args' => ['limit' => 20]]]);
// [['changed' => true, 'token' => '…', 'data' => …, 'json' => '…']]
```

The design, its measured cost and what it is not are in
the decision record.

## Server side: the change hook

After a transaction commits, the runtime fires one WordPress action for the
whole transaction:

```php
add_action('tp_realtime_changes', static function (array $notice): void {
    // ['id' => '…', 'at' => '2026-11-07T10:00:00.000Z', 'changes' => [
    //   ['collection' => 'todos', 'ops' => ['create', 'update'], 'ids' => [12, 13]],
    // ]]
});
```

Every pipeline write reports: REST and action writes, hooks, jobs, the CLI and
wp-admin saves. A rolled-back transaction reports nothing. `collection` is the
schema key the client uses (`client.<key>`). A collection's `ids` becomes `null`
when one transaction changes more than 100 of its rows, or any of its ids is longer
than 191 characters. A transaction touching more than 64 collections is announced
as several notices. Notices never carry row values.

WordPress comments on a kind with `comments` report as `wp:comments`, with
`ids: null`, when the approved thread changes: a comment approved, saved
approved, edited while approved, unapproved, spammed, trashed or deleted. A
comment held for moderation, or spam that was never approved, reports nothing.
`wp:comments` is not a collection key; `<Live>` regions that show a
`<Comments>` thread ask again on it.

A host can register a transport in PHP instead of hooking the action:

```php
\TypedPress\Realtime\Module::publish(new class implements \TypedPress\Realtime\Publisher {
    public function publish(array $notice): void { /* send it */ }
});
```

Publishers run after commit, on the request that wrote, so keep them fast and
bounded. A publisher that throws is logged and never fails the write. With no
publisher and no listener on the action, the runtime collects nothing.

### Shared rooms

A host that sends one notice to every viewer of a site should call
`\TypedPress\Realtime\Module::shared($notice)` first. It keeps ids only for
collections any visitor can list: read rule `anyone` and no drafts. For other
collections `ids` becomes `null`, so a viewer learns that the collection
changed, not which rows. Clients refresh the same way in both cases.
