# Live updates

A page can keep a list current while other people write. First tells the page
that something changed, and the page re-reads it through the normal API. The
change notice carries no row data, so a viewer only ever sees rows its own read
returns.

```ts
import { createClient } from "./first/_generated/client/index.ts";

const first = createClient();
const stop = first.todos.watch({ where: { done: false }, orderBy: { createdAt: "asc" } }, (todos) => render(todos));
// later: stop();
```

`watch(query, onRows, onError?)` runs `list(query)` at once. It runs it again
after every committed write to that collection, or to a collection the query
loads through `with`. Reads coalesce: a burst of notices during a read causes
one more read, not one per notice. `onError` receives the `FirstError` of a
failed read; watching continues.

For reads a collection `watch` can't express, such as an action's result, a
`get` or a global, use the exported `watch` helper with the collections the
read depends on:

```ts
import { createClient, watch } from "./first/_generated/client/index.ts";

const first = createClient();
watch(first, ["todos"], () => first.actions.openCount(), (count) => badge(count));
```

## Transports

First ships no realtime transport. Without one, watched reads poll every 30
seconds. A host delivers notices with a transport. While it is live, reads
refresh on notices plus a slow safety poll.

```ts
import { createClient, registerRealtimeTransport, type RealtimeTransport } from "./first/_generated/client/index.ts";

const transport: RealtimeTransport = {
  connect(deliver, status) {
    const socket = new WebSocket("wss://relay.example/first");
    socket.onopen = () => status("live");
    socket.onclose = () => status("down");
    socket.onmessage = (event) => deliver(JSON.parse(event.data));
    return () => socket.close();
  },
};

createClient({ realtime: { transport } });  // this client only
registerRealtimeTransport(transport);        // every client on the page, including ones created earlier
```

`realtime.pollMs` sets the polling interval while no transport is live; `false`
turns polling off. While the transport is live, watched reads still refresh about
once a minute (`realtime.livePollMs`, default 60000, jittered ±20%), so a notice
lost in transit costs at most that delay. `realtime.transport: false` turns the
transport off. A client connects its transport only while something is watched.
When the transport goes from down to live, watched reads refresh once to catch up.

[Spacefast](spacefast-deploy.md#live-updates) registers its Cast transport
automatically, so apps on Spacefast write no setup.

## Server side: the subscription endpoint

Polling without a transport does not repeat each read. One request, `POST /__first/api/v1/_live`,
carries every read a page is subscribed to with the token of the answer it last got, and answers
each with "not modified" or the fresh result, evaluated as the caller:

```http
POST /__first/api/v1/_live
{ "queries": [{ "kind": "todos", "op": "list", "args": { "where": { "done": false } }, "token": "…" }] }

{ "data": { "results": [{ "changed": false, "token": "…" }], "poll": { "minMs": 2000, "maxMs": 30000 } } }
```

`op` is `list`, `paginate`, `get` or `count`, with the arguments of that call on a kind. A result
is `{ changed: true, token, data }`, `{ changed: false, token }`, `{ error }` (the read's problem
document) or `{ pending: true }` (the request ran out of time; ask again). A request takes at most
20 queries. Tokens are opaque: keep the latest one per query and send it back.

First keeps a change counter per kind, written in the same transaction as every write through its
write path, including wp-admin and core REST saves of your kinds. A read whose kinds the caller
may read in full is answered from the counters without running. Any other read (a kind with a
field hidden from the caller, a rule that gives them only some rows) runs on each poll and is
compared with what the caller last got, so an answer never says that something changed which the
caller may not read. A write made outside First's write path, such as another plugin's SQL, is
seen within five minutes.

PHP code can ask the same question without HTTP, for example to render a read and hand its token
to the browser:

```php
$results = \First\Live\Module::evaluate($db, $viewer, [['kind' => 'todos', 'op' => 'list', 'args' => ['limit' => 20]]]);
// [['changed' => true, 'token' => '…', 'data' => …, 'json' => '…']]
```

The design, its measured cost and what it is not are in
[the decision record](decisions/2026-11-13-reactive-queries.md).

## Server side: the change hook

After a transaction commits, the runtime fires one WordPress action for the
whole transaction:

```php
add_action('first_realtime_changes', static function (array $notice): void {
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

A host can register a transport in PHP instead of hooking the action:

```php
\First\Realtime\Module::publish(new class implements \First\Realtime\Publisher {
    public function publish(array $notice): void { /* send it */ }
});
```

Publishers run after commit, on the request that wrote, so keep them fast and
bounded. A publisher that throws is logged and never fails the write. With no
publisher and no listener on the action, the runtime collects nothing.

### Shared rooms

A host that sends one notice to every viewer of a site should call
`\First\Realtime\Module::shared($notice)` first. It keeps ids only for
collections any visitor can list: read rule `anyone` and no drafts. For other
collections `ids` becomes `null`, so a viewer learns that the collection
changed, not which rows. Clients refresh the same way in both cases.
